// Offline sound processing into derived assets (noise reduction, pitch compensation for speed changes).
// A derived asset is played instead of the source, so preview and export hear exactly the same thing.
import {
  AudioBufferSource, BufferTarget, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, getFirstEncodableAudioCodec,
} from 'mediabunny';
import { Limiter, LoudnessMeter, normalizeGain, voiceChain } from '../core/dsp';
import { expectedAudioKey } from '../core/timeline';
import type { Asset, AudioClip, Project, SoundClip } from '../core/types';
import { renderAudioWindow } from './audio';
import { importFile } from './importer';
import { MediaError, MediaPool } from './media';

const SR = 48000;
const WINDOW_S = 10;

interface Processor {
  channels: 1 | 2;
  process(input: Float32Array[]): Float32Array[];
  flush(): Float32Array[];
  dispose(): void;
}

/** Renders an asset's sound in 10 s windows (mono = average of L and R) and hands each window to `fn`. */
async function eachWindow(
  p: Project, assetId: string, channels: 1 | 2, fn: (input: Float32Array[], done: number) => Promise<void> | void, signal: AbortSignal,
): Promise<void> {
  const src = p.assets[assetId];
  if (!src?.hasAudio) throw new MediaError('This clip has no sound');
  const clip: AudioClip = { kind: 'audio', id: '__fx', assetId, start: 0, duration: src.duration, in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
  const solo: Project = { ...p, tracks: [{ id: '__t', kind: 'audio', clips: [clip] }] };
  const pool = new MediaPool(16);
  const total = Math.round(src.duration * SR);
  try {
    for (let i = 0; i < total; i += SR * WINDOW_S) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const j = Math.min(total, i + SR * WINDOW_S);
      const mix = await renderAudioWindow(solo, pool, i / SR, j / SR, SR);
      const l = mix.getChannelData(0), r = mix.getChannelData(1);
      let input: Float32Array[];
      if (channels === 2) input = [l.slice(), r.slice()];
      else { const m = new Float32Array(l.length); for (let k = 0; k < l.length; k++) m[k] = (l[k] + r[k]) / 2; input = [m]; }
      await fn(input, j / total);
      await new Promise((res) => setTimeout(res, 0));
    }
  } finally {
    pool.dispose();
  }
}

async function processAssetAudio(
  p: Project, assetId: string, name: string, proc: Processor, onProgress: (f: number) => void, signal: AbortSignal,
): Promise<Asset> {
  const src = p.assets[assetId];
  if (!src?.hasAudio) throw new MediaError('This clip has no sound');
  const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: proc.channels, sampleRate: SR });
  if (!codec) throw new MediaError('This browser cannot encode audio');
  const mp4 = codec === 'aac';
  const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  const source = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH });
  output.addAudioTrack(source);
  const total = Math.round(src.duration * SR);
  let emitted = 0;
  const emit = async (chans: Float32Array[]) => {
    const n = Math.min(chans[0]?.length ?? 0, total - emitted);
    if (n <= 0) return;
    const buf = new AudioBuffer({ length: n, numberOfChannels: proc.channels, sampleRate: SR });
    chans.forEach((c, i) => buf.copyToChannel(c.subarray(0, n) as Float32Array<ArrayBuffer>, i));
    await source.add(buf);
    emitted += n;
  };
  try {
    await output.start();
    await eachWindow(p, assetId, proc.channels, async (input, done) => { await emit(proc.process(input)); onProgress(done); }, signal);
    await emit(proc.flush());
    if (emitted < total) await emit(Array.from({ length: proc.channels }, () => new Float32Array(total - emitted))); // keep exact length
    source.close();
    await output.finalize();
    const type = mp4 ? 'audio/mp4' : 'audio/webm';
    return await importFile(new Blob([output.target.buffer!], { type }), `${name}.${mp4 ? 'm4a' : 'webm'}`);
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    proc.dispose();
  }
}

export const VOICE_TARGET_LUFS = -16;

/**
 * "Enhance voice" on an already noise-reduced sound: voice EQ and compression, then loudness to -16 LUFS
 * with a -1 dBFS limiter. Two passes: the first measures the processed loudness, the second applies it.
 */
export async function enhanceAsset(p: Project, assetId: string, onProgress: (f: number) => void, signal: AbortSignal): Promise<Asset> {
  // Measured as heard: the mono voice plays on both stereo channels (dual mono is +3 dB vs one channel).
  const meter = new LoudnessMeter(2, SR);
  let chain = voiceChain(SR);
  await eachWindow(p, assetId, 1, ([m], done) => { chain(m); meter.push([m, m]); onProgress(done * 0.3); }, signal);
  onProgress(0.3);
  const gain = normalizeGain(meter.integrated(), VOICE_TARGET_LUFS, 18);
  chain = voiceChain(SR);
  const limiter = new Limiter(1, SR, gain, -1);
  const name = (p.assets[assetId]?.name ?? 'sound').replace(/ \(clean\)$/, '');
  return processAssetAudio(p, assetId, `${name} (enhanced)`, {
    channels: 1,
    process: ([m]) => { chain(m); return limiter.process([m]); },
    flush: () => limiter.flush(),
    dispose: () => undefined,
  }, (f) => onProgress(0.3 + f * 0.7), signal);
}

/** Voice noise reduction with RNNoise (mono, 48 kHz, 480-sample frames). */
export async function denoiseAsset(p: Project, assetId: string, onProgress: (f: number) => void, signal: AbortSignal): Promise<Asset> {
  const { Rnnoise } = await import('@shiguredo/rnnoise-wasm');
  const rnnoise = await Rnnoise.load();
  const state = rnnoise.createDenoiseState();
  const N = rnnoise.frameSize;
  const frame = new Float32Array(N);
  let carry = new Float32Array(0);
  const run = (input: Float32Array): Float32Array => {
    const n = input.length - (input.length % N);
    const out = new Float32Array(n);
    for (let k = 0; k < n; k += N) {
      for (let m = 0; m < N; m++) frame[m] = input[k + m] * 32768; // RNNoise expects 16-bit range
      state.processFrame(frame);
      for (let m = 0; m < N; m++) out[k + m] = frame[m] / 32768;
    }
    carry = input.slice(n);
    return out;
  };
  return processAssetAudio(p, assetId, `${p.assets[assetId]?.name ?? 'sound'} (clean)`, {
    channels: 1,
    process: ([mono]) => {
      const input = new Float32Array(carry.length + mono.length);
      input.set(carry);
      input.set(mono, carry.length);
      return [run(input)];
    },
    flush: () => {
      if (!carry.length) return [new Float32Array(0)];
      const keep = carry.length;
      const tail = new Float32Array(N);
      tail.set(carry);
      return [run(tail).subarray(0, keep)];
    },
    dispose: () => state.destroy(),
  }, onProgress, signal);
}

/**
 * Pitch-shifts a sound by 1/speed without changing its length. Played back at `speed`, the pitch returns to
 * natural while the timing stays exactly what the timeline expects.
 */
export async function pitchCompensatedAsset(p: Project, assetId: string, speed: number, onProgress: (f: number) => void, signal: AbortSignal): Promise<Asset> {
  const { SoundTouch } = await import('@soundtouchjs/core');
  const st = new SoundTouch();
  st.pitch = 1 / speed;
  const drain = (): Float32Array[] => {
    const n = st.outputBuffer.frameCount;
    const inter = new Float32Array(n * 2);
    if (n) { st.outputBuffer.extract(inter, 0, n); st.outputBuffer.receive(n); }
    const l = new Float32Array(n), r = new Float32Array(n);
    for (let i = 0; i < n; i++) { l[i] = inter[2 * i]; r[i] = inter[2 * i + 1]; }
    return [l, r];
  };
  const push = (l: Float32Array, r: Float32Array) => {
    const inter = new Float32Array(l.length * 2);
    for (let i = 0; i < l.length; i++) { inter[2 * i] = l[i]; inter[2 * i + 1] = r[i]; }
    st.inputBuffer.putSamples(inter, 0, l.length);
    st.process();
  };
  return processAssetAudio(p, assetId, `${p.assets[assetId]?.name ?? 'sound'} (${speed}x)`, {
    channels: 2,
    process: ([l, r]) => { push(l, r); return drain(); },
    flush: () => { const z = new Float32Array(SR / 2); push(z, z); return drain(); },
    dispose: () => st.clear(),
  }, onProgress, signal);
}

export interface PreparedSound { key: string; assetId: string | null; created: Asset[]; derived: NonNullable<Asset['derived']> }

/**
 * Builds (or reuses) the processed sound a clip needs for its settings: noise reduction, then pitch
 * compensation. Returns the asset to attach and any new assets to add to the project.
 */
export async function prepareClipSound(p: Project, clip: SoundClip, onProgress: (f: number) => void, signal: AbortSignal): Promise<PreparedSound> {
  const key = expectedAudioKey(clip);
  const src = p.assets[clip.assetId];
  const derived = { denoise: src?.derived?.denoise, enhance: src?.derived?.enhance, pitch: { ...src?.derived?.pitch } };
  const created: Asset[] = [];
  if (!key || !src) return { key, assetId: null, created, derived };
  let proj = p;
  const add = (a: Asset) => { created.push(a); proj = { ...proj, assets: { ...proj.assets, [a.id]: a } }; };
  const needPitch = !!clip.keepPitch && clip.speed !== 1;
  const clean = !!clip.denoise || !!clip.enhance;
  const pk = `${clip.enhance ? 'e' : clip.denoise ? 'd' : ''}p${clip.speed}`;
  const has = (id: string | undefined) => !!id && !!proj.assets[id];
  // Progress is split evenly over the steps that actually have to run.
  const steps = [clean && !has(derived.denoise), !!clip.enhance && !has(derived.enhance), needPitch && !has(derived.pitch[pk])].filter(Boolean).length;
  let step = 0;
  const progress = (f: number) => onProgress(Math.min(1, (step + f) / Math.max(1, steps)));
  let base = clip.assetId;
  if (clean) {
    if (!has(derived.denoise)) {
      const a = await denoiseAsset(proj, clip.assetId, progress, signal);
      add(a);
      derived.denoise = a.id;
      step++;
    }
    base = derived.denoise!;
  }
  if (clip.enhance) {
    if (!has(derived.enhance)) {
      const a = await enhanceAsset(proj, base, progress, signal);
      add(a);
      derived.enhance = a.id;
      step++;
    }
    base = derived.enhance!;
  }
  if (needPitch) {
    if (!has(derived.pitch[pk])) {
      const a = await pitchCompensatedAsset(proj, base, clip.speed, progress, signal);
      add(a);
      derived.pitch[pk] = a.id;
    }
    base = derived.pitch[pk];
  }
  return { key, assetId: base, created, derived };
}
