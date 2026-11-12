// Export: renders every frame through the same buildFrame → Compositor path as the preview,
// mixes audio in sample-aligned windows, and muxes with Mediabunny (MP4 H.264/AAC when available).
import {
  AudioBufferSource, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_VERY_HIGH,
  StreamTarget, WebMOutputFormat, canEncodeVideo, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  type Quality,
} from 'mediabunny';
import { MemoryTarget } from './memTarget';
import { diskFile } from './opfs';
import { abandon } from './abandon';
import { encoderDelay } from './encoderDelay';
import { Limiter, LoudnessMeter, normalizeGain } from '../core/dsp';
import { buildFrame } from '../core/frame';
import { withoutGuides } from '../core/music';
import { avcBaseline } from '../core/avc';
import { soundEntries } from './audio';
import { clipEnd, projectDuration } from '../core/timeline';
import type { Project } from '../core/types';
import { renderAudioWindow } from './audio';
import { Compositor, GPU_LOST, slotOf } from './compositor';
import { MediaError, MediaPool } from './media';
import { resolveDrawables } from './render';
import { warmFaces } from './faces';
import { warmSegmenter } from './segment';
import { TextRasterizer } from './text';
import { matchStreamRange } from './videoRange';
import { MAX_GIF_S, gifDelayMs, gifSize, outputSize, type Resolution, GIF_FPS } from './exportSizes';
export type { Resolution } from './exportSizes';
import { filmFrames } from '../core/exportProgress';
import { within } from '../lib/limits';
import { track } from '../lib/telemetry';

export interface ExportOptions {
  resolution: Resolution; fps: number; quality: 'standard' | 'high';
  /** Normalize the mix to -14 LUFS with a -1 dBFS limiter (default on). */
  loudness?: boolean;
}
/**
 * A few frames of the file as it is made, for the sheet to show between its two marks (DESIGN.md, Progress): picture
 * `slot` of `frames`, spread over the film (core/exportProgress), handed over right after it is drawn, before the next one is.
 * Copying `frames` pictures costs the export nothing it would notice.
 */
export interface Film { frames: number; take(picture: HTMLCanvasElement, slot: number): void }

export interface ExportResult {
  blob: Blob; fileName: string; seconds: number;
  /** The project has sound, but this browser encodes none: the file is silent, and the person is told. */
  noSound?: boolean;
}

const SAMPLE_RATE = 48000;
const AUDIO_WINDOW_S = 2;
/** More than either encoder makes: AAC 47 packets a second, Opus 50. */
const AUDIO_PACKETS_PER_S = 60;

export const PLATFORM_LUFS = -14;

const fileBase = (p: Project) => p.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'kadr';

/** Renders frames of a project into its own canvas through the preview's buildFrame → Compositor path. */
class FrameRenderer {
  readonly canvas = document.createElement('canvas');
  readonly pool: MediaPool;
  /** Frames where a video on screen gave no picture: black in the file, however "Ready" the screen says it is. */
  unread = 0;
  private readonly compositor: Compositor;
  private readonly text = new TextRasterizer();
  constructor(private readonly p: Project, readonly width: number, readonly height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.compositor = new Compositor(this.canvas, true);
    this.pool = new MediaPool(Math.max(width, height));
  }
  async draw(t: number): Promise<void> {
    const at = Math.min(t, Math.max(0, projectDuration(this.p) - 1e-3));
    const desc = buildFrame(this.p, at);
    const sources = await resolveDrawables(desc, this.pool, this.text, this.width, this.height, false, this.compositor.frameMax);
    this.check();
    for (const l of desc.layers) if (l.source.kind === 'video' && !sources.has(slotOf(l) ?? '')) this.unread++;
    this.compositor.draw(desc, sources);
    this.check();
    // The export only goes forward: a clip it has passed is never drawn again. Its decoder and frames lived to the end,
    // one decoder per clip (31 clips, 31 decoders and ~5 GB on a Mac), more than a phone has (audit V-171).
    this.pool.sweep(this.liveAt(at), 0);
    this.pool.trimImages(new Set(desc.layers.flatMap((l) => (l.source.kind === 'image' ? [l.source.assetId] : []))));
  }
  /** Video clips on screen at `t` or starting within half a second (opened ahead, as the preview does). */
  private liveAt(t: number): Set<string> {
    const keep = new Set<string>();
    for (const tr of this.p.tracks) for (const c of tr.clips) if (c.kind === 'video' && c.start <= t + 0.5 && clipEnd(c) > t - 0.05) keep.add(c.id);
    return keep;
  }
  /**
   * A lost WebGL context draws nothing, and a restored one has lost its textures: frames would be empty or wrong
   * (docs/12 §1.3 item 12). The export fails and says why instead.
   */
  check(): void {
    // A refused decoder frame left a layer out of this frame: the export starts again, its videos through canvases.
    if (this.compositor.everLost || this.compositor.isLost() || this.compositor.framesFailed) throw new MediaError(GPU_LOST);
  }
  dispose(): void {
    this.pool.dispose();
    this.compositor.dispose(true);
  }
}

/** The project mix in sample-exact windows, optionally loudness-normalized for social platforms. */
class MixStream {
  readonly total: number;
  private done = 0;
  private limiter: Limiter | null = null;
  /** `skip`: samples to drop at the start, where the encoder puts its priming (see engine/encoderDelay). */
  constructor(private readonly p: Project, private readonly pool: MediaPool, duration: number, private skip = 0) {
    this.total = Math.round(duration * SAMPLE_RATE);
  }

  /** The buffer without the samples still owed to the encoder's priming. */
  private trim(b: AudioBuffer): AudioBuffer | null {
    if (!this.skip) return b;
    const k = Math.min(this.skip, b.length);
    this.skip -= k;
    if (k === b.length) return null;
    const res = new AudioBuffer({ length: b.length - k, numberOfChannels: b.numberOfChannels, sampleRate: b.sampleRate });
    for (let c = 0; c < b.numberOfChannels; c++) res.copyToChannel(b.getChannelData(c).subarray(k) as Float32Array<ArrayBuffer>, c);
    return res;
  }
  get finished(): boolean { return this.done >= this.total; }
  get progress(): number { return this.total ? this.done / this.total : 1; }
  due(untilS: number): boolean { return !this.finished && this.done < untilS * SAMPLE_RATE; }

  /** Pre-pass: measures integrated loudness (BS.1770-4) and sets the gain for -14 LUFS. */
  async normalize(signal: AbortSignal, onProgress: (f: number) => void): Promise<void> {
    const meter = new LoudnessMeter(2, SAMPLE_RATE);
    for (let i = 0; i < this.total; i += 10 * SAMPLE_RATE) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const j = Math.min(this.total, i + 10 * SAMPLE_RATE);
      const b = await renderAudioWindow(this.p, this.pool, i / SAMPLE_RATE, j / SAMPLE_RATE, SAMPLE_RATE);
      meter.push([b.getChannelData(0), b.getChannelData(1)]);
      onProgress(j / this.total);
      await yieldToUi();
    }
    this.limiter = new Limiter(2, SAMPLE_RATE, normalizeGain(meter.integrated(), PLATFORM_LUFS, 12), -1);
  }

  /** Next window of audio; may be null for a window the limiter holds back entirely. */
  async read(): Promise<AudioBuffer | null> {
    const next = Math.min(this.total, this.done + AUDIO_WINDOW_S * SAMPLE_RATE);
    const buf = await renderAudioWindow(this.p, this.pool, this.done / SAMPLE_RATE, next / SAMPLE_RATE, SAMPLE_RATE);
    this.done = next;
    if (!this.limiter) return this.trim(buf);
    let out = this.limiter.process([buf.getChannelData(0), buf.getChannelData(1)]);
    if (this.finished) {
      const tail = this.limiter.flush();
      out = out.map((c, i) => { const x = new Float32Array(c.length + tail[i].length); x.set(c); x.set(tail[i], c.length); return x; });
    }
    if (!out[0].length) return null;
    const res = new AudioBuffer({ length: out[0].length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    out.forEach((c, i) => res.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return this.trim(res);
  }
}

// MessageChannel instead of setTimeout: timers are throttled to ~1/s in background tabs, messages are not.
const yieldToUi = () => new Promise<void>((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

type Target = { target: StreamTarget; result: () => Promise<Blob> };

/** The browser gets this long to say which codecs it can encode (docs/12 G2): a query that never answers is a failure. */
const CAPS_MS = 10_000;
const noAnswer = (): never => { throw new MediaError('This device did not say whether it can encode video. Restart the browser and try again.'); };

/** The file system gets this long to open the export file; then the export goes to memory (QA, docs/11 §1.6). */
const OPFS_MS = 5000;

/** No frame got through the encoder for this long while Kadr was on screen: it is stuck (the iOS Simulator's H.264
 * encoder stops after a few frames, docs/12) and the export says so instead of standing at the same percent forever. */
const STALL_MS = 20_000;
/** An export that failed gets this long to close its encoders before they are dropped. */
const ABANDON_MS = 5000;

/**
 * Fails the export once it makes no progress for STALL_MS (time in the background, a suspended page, does not count),
 * and at once on Cancel: a stuck encoder must not hold the Cancel button either.
 */
function stallGuard(signal: AbortSignal) {
  let last = performance.now();
  let stalled = false;
  let fail!: (e: Error) => void;
  const stop = new Promise<never>((_, reject) => { fail = reject; });
  stop.catch(() => undefined);
  const awake = () => { last = performance.now(); };
  const cancel = () => fail(new DOMException('Export cancelled', 'AbortError'));
  signal.addEventListener('abort', cancel);
  document.addEventListener('visibilitychange', awake);
  const timer = setInterval(() => {
    if (document.hidden) awake();
    else if (performance.now() - last > STALL_MS) {
      stalled = true;
      fail(new MediaError('The video encoder of this device stopped responding. Try a lower resolution or frame rate.'));
    }
  }, 1000);
  return {
    tick: awake,
    race: <T>(work: Promise<T>): Promise<T> => Promise.race([work, stop]),
    get stalled() { return stalled; },
    stop() { clearInterval(timer); signal.removeEventListener('abort', cancel); document.removeEventListener('visibilitychange', awake); },
  };
}

/**
 * Closes the WebCodecs encoders inside mediabunny's sources. A stuck one never finishes its flush, and mediabunny has
 * no public way to force it once closing has begun; closing it rejects the flush, which lets the frames and the file go.
 */
function closeEncoders(...sources: unknown[]) {
  for (const s of sources) {
    const encoder = (s as { _encoder?: { encoder?: VideoEncoder | AudioEncoder | null } } | null)?._encoder?.encoder;
    if (encoder && encoder.state !== 'closed') {
      try { encoder.close(); } catch { /* closing already */ }
    }
  }
}

/** Models the project's effects need, loaded before the stall guard starts: a first download is not a stuck encoder. */
async function warmModels(p: Project) {
  const clips = p.tracks.flatMap((t) => t.clips);
  await Promise.all([ // a failure shows per frame, as in the preview (render.ts)
    clips.some((c) => 'removeBg' in c && c.removeBg) ? warmSegmenter().catch(() => undefined) : undefined,
    clips.some((c) => 'privacy' in c && c.privacy?.faces) ? warmFaces().catch(() => undefined) : undefined,
  ]);
}

/** The export file in the origin-private file system, or null where it cannot be had. */
async function openStream(ext: string, type: string): Promise<(Target & { drop: () => void }) | null> {
  const disk = await diskFile('export', ext);
  if (!disk) return null; // OPFS unavailable (private mode, old browser)
  return {
    target: new StreamTarget(disk.writable, { chunked: true }),
    result: async () => new Blob([await disk.file()], { type }),
    drop: disk.drop,
  };
}

/**
 * Streams the file into the origin-private file system when possible, so long exports don't have to fit
 * in memory; falls back to an in-memory buffer (older Safari has no createWritable). A file system that does not
 * answer must not hold the export at 0%: after OPFS_MS the export goes to memory, and a stream that opens later is
 * let go so it holds no lock.
 */
async function openTarget(ext: string, type: string): Promise<Target> {
  const stream = openStream(ext, type);
  let timer = 0;
  const late = new Promise<null>((resolve) => { timer = self.setTimeout(() => resolve(null), OPFS_MS); });
  const got = await Promise.race([stream, late]).finally(() => clearTimeout(timer));
  if (got) return got;
  void stream.then((s) => s?.drop());
  const target = new MemoryTarget();
  return { target, result: async () => target.blob(type) };
}

/** A GPU reset during the export gets this many fresh starts; a device that keeps losing it is told so. */
const GPU_RETRIES = 1;
const UNREADABLE = 'Most of this video could not be read: the file may be damaged or cut short. Try exporting it again from the app that made it.';
const gpuLost = (e: unknown) => e instanceof MediaError && e.message === GPU_LOST;

/**
 * A WebGL context lost mid-export (the GPU process reset, a phone short of memory) is not an error the person has
 * to deal with: the export starts again with a fresh context, once (docs/12 rule 10). The progress bar goes back
 * to the start; the file is whole either way.
 */
async function withGpuRetry<T>(run: () => Promise<T>, onRestart: () => void, signal?: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (e) {
      if (!gpuLost(e) || attempt >= GPU_RETRIES || signal?.aborted) throw e;
      console.warn('the GPU was reset during the export; starting it again', e);
      onRestart();
      await new Promise((r) => setTimeout(r, 1000)); // the GPU process comes back first
      if (signal?.aborted) throw new DOMException('Export cancelled', 'AbortError'); // Cancel in the pause starts nothing
    }
  }
}

/** The video encoder gave no packet at all with a profile above Baseline, standing still (`stall`) or failing with an
 * error (`refused`), and the device says it encodes Baseline (`avc`, a codec string) at this size: worth one more start. */
class BaselineWorthTrying extends Error {
  constructor(readonly avc: string, readonly reason: 'stall' | 'refused', override readonly cause: unknown) { super('The video encoder failed above Baseline'); }
}

/** The Baseline codec string to start again with after `asked` failed, or null: it was Baseline, or the device has none. */
async function baselineFor(asked: string, width: number, height: number, quality: Quality, frameRate: number): Promise<string | null> {
  const avc = avcBaseline(asked);
  if (!avc) return null;
  const can = canEncodeVideo('avc', { width, height, quality, frameRate, fullCodecString: avc }).catch(() => false);
  return await within(can, CAPS_MS, () => false) ? avc : null;
}

/**
 * Some phones take an H.264 High configuration and then give nothing back, or refuse it, while their Constrained
 * Baseline encoder works: the person got no file at all, and a lower resolution stalled the same way (audit V-259).
 * That is not an error the person has to deal with either: the export starts again with Baseline, once, at the same
 * size and frame rate, and the progress bar goes back to the start. Baseline failing too is said as it is.
 * An encoder that gave packets and then stopped has shown that its profile works: it gets no second start, and the
 * person does not watch a percent stand still for STALL_MS twice.
 */
async function withBaselineRetry<T>(run: (avc?: string) => Promise<T>, onRestart: (reason: 'stall' | 'refused') => void): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (!(e instanceof BaselineWorthTrying)) throw e;
    console.warn(`the video encoder failed (${e.reason}); starting the export again with H.264 Baseline`, e.cause);
    onRestart(e.reason);
    return run(e.avc);
  }
}

/** Renders and encodes the project through the preview's render path (WYSIWYG), sound mixed in sample-aligned windows. */
export function exportProject(whole: Project, opts: ExportOptions, onProgress: (f: number) => void, signal: AbortSignal, film?: Film): Promise<ExportResult> {
  // Guide tracks are for editing only: one longer than the video wrote black and silence to the file (audit V-102).
  const p = withoutGuides(whole);
  const restart = () => onProgress(0);
  return withBaselineRetry(
    (avc) => withGpuRetry(() => exportOnce(p, opts, onProgress, signal, avc, film), restart, signal),
    (reason) => { track('export_baseline_fallback', { reason, resolution: opts.resolution, fps: opts.fps }); restart(); },
  );
}

/** `baseline`: the H.264 codec string to encode with instead of Mediabunny's choice (see withBaselineRetry). */
async function exportOnce(
  p: Project, opts: ExportOptions, onProgress: (f: number) => void, signal: AbortSignal, baseline?: string, film?: Film,
): Promise<ExportResult> {
  const started = performance.now();
  const duration = projectDuration(p);
  if (duration <= 0) throw new MediaError('The timeline is empty');
  const [width, height] = outputSize(p.settings, opts.resolution);
  const quality = opts.quality === 'high' ? QUALITY_VERY_HIGH : QUALITY_HIGH;
  // Asked as the encoder will be set up, frame rate included: an encoder has a ceiling of pixels a second, so one that
  // takes this size at 30 fps may refuse it at 60 while the next codec takes it. The sheet offers 60 by asking about
  // every codec at 60 (supportedResolutions); asked without the rate, the export took the first codec anyway (D-13).
  const videoCodec = await within(getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height, frameRate: opts.fps, quality }), CAPS_MS, noAnswer);
  if (!videoCodec) throw new MediaError('This device cannot encode {w}×{h} video. Try a lower resolution.', { w: width, h: height });
  const mp4 = videoCodec === 'avc';
  const audioCodec = await within(getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE }), CAPS_MS, noAnswer);

  const type = mp4 ? 'video/mp4' : 'video/webm';
  const { target, result } = await openTarget(mp4 ? 'mp4' : 'webm', type);
  const streaming = !(target instanceof MemoryTarget); // to the file system: the index goes at the end
  const output = new Output({
    // The index goes first in every file: at the end, a file cannot start playing until it has all arrived, and upload
    // sites ask for it at the start (audit V-237). On disk its room is kept ahead, from the number of packets to come.
    format: mp4 ? new Mp4OutputFormat({ fastStart: streaming ? 'reserve' : 'in-memory' }) : new WebMOutputFormat(),
    target,
  });
  const frames = new FrameRenderer(p, width, height);
  // What the video encoder was asked for, how many packets it gave, and whether the export was waiting for it when it
  // failed: together they say that the encoder never worked with this profile, and which codec string to try instead.
  const encoder = { asked: '', packets: 0, awaited: false };
  const video = new CanvasSource(frames.canvas, {
    codec: videoCodec, bitrate: quality, keyFrameInterval: 2,
    ...(mp4 && baseline ? { fullCodecString: baseline } : {}),
    onEncoderConfig: (config) => { encoder.asked = config.codec; },
    onEncodedPacket: (packet, meta) => { encoder.packets++; matchStreamRange(packet, meta); },
  });
  output.addVideoTrack(video, { frameRate: opts.fps, maximumPacketCount: Math.ceil(duration * opts.fps) + 8 });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio, { maximumPacketCount: Math.ceil(duration * AUDIO_PACKETS_PER_S) + 64 });
  // The encoder's priming is taken off the start so the sound meets the picture.
  const mix = new MixStream(p, frames.pool, duration, audioCodec ? await encoderDelay(audioCodec, 2, SAMPLE_RATE) : 0);
  // Loudness pre-pass takes the first 5% of the progress bar (audio renders far faster than video).
  const pre = audio && opts.loudness !== false ? 0.05 : 0;

  await warmModels(p);
  const guard = stallGuard(signal);
  // A frame handed over, or the end of the file: a stall or an error in here is the video encoder's.
  const encoding = async (work: Promise<void>) => { encoder.awaited = true; await guard.race(work); encoder.awaited = false; };
  try {
    await guard.race(output.start());
    if (pre) await guard.race(mix.normalize(signal, (f) => { guard.tick(); onProgress(f * pre); }));
    const count = Math.max(1, Math.round(duration * opts.fps));
    const shown = film ? filmFrames(count, film.frames) : null;
    const pumpAudio = async (untilS: number) => {
      while (audio && mix.due(untilS)) { const b = await mix.read(); if (b) await audio.add(b); }
    };
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / opts.fps;
      await guard.race(pumpAudio(t + 1));
      await guard.race(frames.draw(t));
      for (const k of shown?.get(i) ?? []) film!.take(frames.canvas, k);
      await encoding(video.add(t, 1 / opts.fps));
      guard.tick();
      onProgress(pre + ((i + 1) / count) * (1 - pre));
      if (i % 8 === 0) await yieldToUi();
    }
    await guard.race(pumpAudio(Infinity));
    frames.check(); // the last frame went to the encoder with the context it was drawn with
    if (frames.unread > count / 2) throw new MediaError(UNREADABLE); // audit V-161, V-168
    video.close();
    audio?.close();
    await encoding(output.finalize());
    const blob = await result();
    return { blob, fileName: `${fileBase(p)}.${mp4 ? 'mp4' : 'webm'}`, seconds: (performance.now() - started) / 1000, noSound: !audio && soundEntries(p).length > 0 };
  } catch (e) {
    // A stuck encoder holds a graceful end forever: after a stall, or a Cancel that cannot end within ABANDON_MS,
    // the encoders are closed outright.
    const ended = !guard.stalled && await Promise.race([
      abandon(output, signal, audio ? [video, audio] : [video]).then(() => true),
      new Promise<false>((r) => setTimeout(() => r(false), ABANDON_MS)),
    ]);
    if (!ended) {
      closeEncoders(video, audio);
      void output.cancel().catch(() => undefined);
    }
    // The export was waiting for the encoder, and it never gave a packet: this profile does not work here.
    const dead = !baseline && !signal.aborted && encoder.awaited && encoder.packets === 0;
    const avc = dead ? await baselineFor(encoder.asked, width, height, quality, opts.fps) : null;
    if (avc && !signal.aborted) throw new BaselineWorthTrying(avc, guard.stalled ? 'stall' : 'refused', e);
    throw e;
  } finally {
    guard.stop();
    frames.dispose();
  }
}

/** The whole mix as an audio file: M4A (AAC) where available, else WebM (Opus). */
export async function exportAudio(whole: Project, loudness: boolean, onProgress: (f: number) => void, signal: AbortSignal): Promise<ExportResult> {
  const p = withoutGuides(whole);
  const started = performance.now();
  const duration = projectDuration(p);
  if (duration <= 0) throw new MediaError('The timeline is empty');
  const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  if (!codec) throw new MediaError('This browser cannot encode audio');
  const m4a = codec === 'aac';
  const output = new Output({ format: m4a ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new MemoryTarget() });
  const audio = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH });
  output.addAudioTrack(audio);
  const pool = new MediaPool(16);
  const mix = new MixStream(p, pool, duration, await encoderDelay(codec, 2, SAMPLE_RATE));
  const pre = loudness ? 0.4 : 0;
  try {
    await output.start();
    if (loudness) await mix.normalize(signal, (f) => onProgress(f * pre));
    while (!mix.finished) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const b = await mix.read();
      if (b) await audio.add(b);
      onProgress(pre + (1 - pre) * mix.progress);
      await yieldToUi();
    }
    audio.close();
    await output.finalize();
    const blob = output.target.blob(m4a ? 'audio/mp4' : 'audio/webm');
    return { blob, fileName: `${fileBase(p)}.${m4a ? 'm4a' : 'webm'}`, seconds: (performance.now() - started) / 1000 };
  } catch (e) {
    await abandon(output, signal, [audio]);
    throw e;
  } finally {
    pool.dispose();
  }
}

/** One frame at time `t` as a JPEG in the export resolution. */
export function exportFrame(p: Project, t: number, resolution: Resolution): Promise<ExportResult> {
  return withGpuRetry(() => frameOnce(withoutGuides(p), t, resolution), () => undefined);
}

async function frameOnce(p: Project, t: number, resolution: Resolution): Promise<ExportResult> {
  const started = performance.now();
  const [width, height] = outputSize(p.settings, resolution);
  const r = new FrameRenderer(p, width, height);
  try {
    await r.draw(t);
    const blob = await new Promise<Blob | null>((res) => r.canvas.toBlob(res, 'image/jpeg', 0.92));
    if (!blob) throw new MediaError('Could not save the photo');
    return { blob, fileName: `${fileBase(p)}.jpg`, seconds: (performance.now() - started) / 1000 };
  } finally {
    r.dispose();
  }
}

/** Animated GIF (looping, 12 fps, 480 px long side) with one palette sampled across the video: no flicker. */
export function exportGif(p: Project, onProgress: (f: number) => void, signal: AbortSignal, film?: Film): Promise<ExportResult> {
  return withGpuRetry(() => gifOnce(withoutGuides(p), onProgress, signal, film), () => onProgress(0), signal);
}

async function gifOnce(p: Project, onProgress: (f: number) => void, signal: AbortSignal, film?: Film): Promise<ExportResult> {
  const started = performance.now();
  const duration = projectDuration(p);
  if (duration <= 0) throw new MediaError('The timeline is empty');
  if (duration > MAX_GIF_S + 0.05) throw new MediaError('GIF works for videos up to {n} s. Trim the project or export a video.', { n: MAX_GIF_S });
  const { GIFEncoder, quantize, applyPalette } = await import('gifenc');
  const [w, h] = gifSize(p.settings);
  const r = new FrameRenderer(p, w, h);
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
  ctx.canvas.width = w;
  ctx.canvas.height = h;
  const pixels = async (t: number) => { await r.draw(t); ctx.drawImage(r.canvas, 0, 0); return ctx.getImageData(0, 0, w, h).data; };
  try {
    const count = Math.max(1, Math.round(duration * GIF_FPS));
    const samples = Math.min(count, 6);
    const sampled = new Uint8Array(w * h * 4 * samples);
    for (let i = 0; i < samples; i++) sampled.set(await pixels(((i + 0.5) / samples) * duration), i * w * h * 4);
    const palette = quantize(sampled, 256, { format: 'rgb565' });
    const gif = GIFEncoder();
    const shown = film ? filmFrames(count, film.frames) : null;
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const frame = await pixels(i / GIF_FPS);
      for (const k of shown?.get(i) ?? []) film!.take(ctx.canvas, k);
      const index = applyPalette(frame, palette, 'rgb565');
      gif.writeFrame(index, w, h, i === 0 ? { palette, delay: gifDelayMs(i), repeat: 0 } : { delay: gifDelayMs(i) });
      onProgress((i + 1) / count);
      if (i % 4 === 0) await yieldToUi();
    }
    gif.finish();
    return { blob: new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), fileName: `${fileBase(p)}.gif`, seconds: (performance.now() - started) / 1000 };
  } finally {
    r.dispose();
  }
}
