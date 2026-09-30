// Export: renders every frame through the same buildFrame → Compositor path as the preview,
// mixes audio in sample-aligned windows, and muxes with Mediabunny (MP4 H.264/AAC when available).
import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_VERY_HIGH,
  StreamTarget, WebMOutputFormat, canEncodeVideo, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { Limiter, LoudnessMeter, normalizeGain } from '../core/dsp';
import { buildFrame } from '../core/frame';
import { projectDuration } from '../core/timeline';
import type { Project, ProjectSettings } from '../core/types';
import { renderAudioWindow } from './audio';
import { Compositor } from './compositor';
import { MediaError, MediaPool } from './media';
import { resolveDrawables } from './render';
import { TextRasterizer } from './text';

export type Resolution = 720 | 1080 | 1440 | 2160;
export interface ExportOptions {
  resolution: Resolution; fps: number; quality: 'standard' | 'high';
  /** Normalize the mix to -14 LUFS with a -1 dBFS limiter (default on). */
  loudness?: boolean;
}
export interface ExportResult { blob: Blob; fileName: string; seconds: number }

const SAMPLE_RATE = 48000;
const AUDIO_WINDOW_S = 2;

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);
export const PLATFORM_LUFS = -14;
export const MAX_GIF_S = 30;
const GIF_FPS = 12;
const GIF_SIDE = 480;

const fileBase = (p: Project) => p.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'kadr';

/** Renders frames of a project into its own canvas through the preview's buildFrame → Compositor path. */
class FrameRenderer {
  readonly canvas = document.createElement('canvas');
  readonly pool: MediaPool;
  private readonly compositor: Compositor;
  private readonly text = new TextRasterizer();
  constructor(private readonly p: Project, readonly width: number, readonly height: number) {
    this.canvas.width = width;
    this.canvas.height = height;
    this.compositor = new Compositor(this.canvas, true);
    this.pool = new MediaPool(Math.max(width, height));
  }
  async draw(t: number): Promise<void> {
    const desc = buildFrame(this.p, Math.min(t, Math.max(0, projectDuration(this.p) - 1e-3)));
    this.compositor.draw(desc, await resolveDrawables(desc, this.pool, this.text, this.width, this.height));
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
  constructor(private readonly p: Project, private readonly pool: MediaPool, duration: number) {
    this.total = Math.round(duration * SAMPLE_RATE);
  }
  get finished(): boolean { return this.done >= this.total; }
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
    if (!this.limiter) return buf;
    let out = this.limiter.process([buf.getChannelData(0), buf.getChannelData(1)]);
    if (this.finished) {
      const tail = this.limiter.flush();
      out = out.map((c, i) => { const x = new Float32Array(c.length + tail[i].length); x.set(c); x.set(tail[i], c.length); return x; });
    }
    if (!out[0].length) return null;
    const res = new AudioBuffer({ length: out[0].length, numberOfChannels: 2, sampleRate: SAMPLE_RATE });
    out.forEach((c, i) => res.copyToChannel(c as Float32Array<ArrayBuffer>, i));
    return res;
  }
}

export function outputSize(s: ProjectSettings, resolution: Resolution): [number, number] {
  const k = resolution / Math.min(s.width, s.height);
  return [even(s.width * k), even(s.height * k)];
}

/** Resolutions this device can encode for the project (checked once per export sheet open). */
export async function supportedResolutions(s: ProjectSettings): Promise<Resolution[]> {
  const all: Resolution[] = [720, 1080, 1440, 2160];
  const ok = await Promise.all(all.map(async (r) => {
    const [width, height] = outputSize(s, r);
    return (await canEncodeVideo('avc', { width, height })) || (await canEncodeVideo('vp9', { width, height }));
  }));
  return all.filter((_, i) => ok[i]);
}

// MessageChannel instead of setTimeout: timers are throttled to ~1/s in background tabs, messages are not.
const yieldToUi = () => new Promise<void>((r) => { const ch = new MessageChannel(); ch.port1.onmessage = () => r(); ch.port2.postMessage(0); });

/**
 * Streams the file into the origin-private file system when possible, so long exports don't have to fit
 * in memory; falls back to an in-memory buffer (older Safari has no createWritable).
 */
async function openTarget(ext: string, type: string): Promise<{ target: BufferTarget | StreamTarget; result: () => Promise<Blob> }> {
  try {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) if (name.startsWith('export-')) await root.removeEntry(name).catch(() => undefined);
    const handle = await root.getFileHandle(`export-${Date.now()}.${ext}`, { create: true });
    if ('createWritable' in handle) {
      const writable = await handle.createWritable();
      // Some WebKit contexts open the stream but fail on the first write: probe before committing to it.
      await writable.write(new Uint8Array(1));
      await writable.truncate(0);
      return { target: new StreamTarget(writable, { chunked: true }), result: async () => new Blob([await handle.getFile()], { type }) };
    }
  } catch { /* OPFS unavailable (private mode, old browser) */ }
  const target = new BufferTarget();
  return {
    target,
    result: async () => {
      if (!target.buffer) throw new MediaError('Export produced no data');
      return new Blob([target.buffer], { type });
    },
  };
}

export async function exportProject(
  p: Project, opts: ExportOptions, onProgress: (f: number) => void, signal: AbortSignal,
): Promise<ExportResult> {
  const started = performance.now();
  const duration = projectDuration(p);
  if (duration <= 0) throw new MediaError('The timeline is empty');
  const [width, height] = outputSize(p.settings, opts.resolution);
  const videoCodec = await getFirstEncodableVideoCodec(['avc', 'vp9', 'av1'], { width, height });
  if (!videoCodec) throw new MediaError('This device cannot encode {w}×{h} video. Try a lower resolution.', { w: width, h: height });
  const mp4 = videoCodec === 'avc';
  const audioCodec = await getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });

  const type = mp4 ? 'video/mp4' : 'video/webm';
  const { target, result } = await openTarget(mp4 ? 'mp4' : 'webm', type);
  const streaming = target instanceof StreamTarget;
  const output = new Output({
    format: mp4 ? new Mp4OutputFormat({ fastStart: streaming ? false : 'in-memory' }) : new WebMOutputFormat(),
    target,
  });
  const frames = new FrameRenderer(p, width, height);
  const video = new CanvasSource(frames.canvas, {
    codec: videoCodec, bitrate: opts.quality === 'high' ? QUALITY_VERY_HIGH : QUALITY_HIGH, keyFrameInterval: 2,
  });
  output.addVideoTrack(video, { frameRate: opts.fps });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  const mix = new MixStream(p, frames.pool, duration);
  // Loudness pre-pass takes the first 5% of the progress bar (audio renders far faster than video).
  const pre = audio && opts.loudness !== false ? 0.05 : 0;

  try {
    await output.start();
    if (pre) await mix.normalize(signal, (f) => onProgress(f * pre));
    const count = Math.max(1, Math.round(duration * opts.fps));
    const pumpAudio = async (untilS: number) => {
      while (audio && mix.due(untilS)) { const b = await mix.read(); if (b) await audio.add(b); }
    };
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / opts.fps;
      await pumpAudio(t + 1);
      await frames.draw(t);
      await video.add(t, 1 / opts.fps);
      onProgress(pre + ((i + 1) / count) * (1 - pre));
      if (i % 8 === 0) await yieldToUi();
    }
    await pumpAudio(Infinity);
    video.close();
    audio?.close();
    await output.finalize();
    const blob = await result();
    return { blob, fileName: `${fileBase(p)}.${mp4 ? 'mp4' : 'webm'}`, seconds: (performance.now() - started) / 1000 };
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    frames.dispose();
  }
}

/** The whole mix as an audio file: M4A (AAC) where available, else WebM (Opus). */
export async function exportAudio(p: Project, loudness: boolean, onProgress: (f: number) => void, signal: AbortSignal): Promise<ExportResult> {
  const started = performance.now();
  const duration = projectDuration(p);
  if (duration <= 0) throw new MediaError('The timeline is empty');
  const codec = await getFirstEncodableAudioCodec(['aac', 'opus'], { numberOfChannels: 2, sampleRate: SAMPLE_RATE });
  if (!codec) throw new MediaError('This browser cannot encode audio');
  const m4a = codec === 'aac';
  const output = new Output({ format: m4a ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  const audio = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH });
  output.addAudioTrack(audio);
  const pool = new MediaPool(16);
  const mix = new MixStream(p, pool, duration);
  const pre = loudness ? 0.4 : 0;
  try {
    await output.start();
    if (loudness) await mix.normalize(signal, (f) => onProgress(f * pre));
    while (!mix.finished) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const b = await mix.read();
      if (b) await audio.add(b);
      onProgress(pre + (mix.finished ? 1 : 0.99 * (1 - pre)));
      await yieldToUi();
    }
    audio.close();
    await output.finalize();
    const blob = new Blob([output.target.buffer!], { type: m4a ? 'audio/mp4' : 'audio/webm' });
    return { blob, fileName: `${fileBase(p)}.${m4a ? 'm4a' : 'webm'}`, seconds: (performance.now() - started) / 1000 };
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    pool.dispose();
  }
}

/** One frame at time `t` as a JPEG in the export resolution. */
export async function exportFrame(p: Project, t: number, resolution: Resolution): Promise<ExportResult> {
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

export const gifSize = (s: ProjectSettings): [number, number] => {
  const k = GIF_SIDE / Math.max(s.width, s.height);
  return [even(s.width * k), even(s.height * k)];
};

/** Animated GIF (looping, 12 fps, 480 px long side) with one palette sampled across the video: no flicker. */
export async function exportGif(p: Project, onProgress: (f: number) => void, signal: AbortSignal): Promise<ExportResult> {
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
    for (let i = 0; i < count; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const index = applyPalette(await pixels(i / GIF_FPS), palette, 'rgb565');
      gif.writeFrame(index, w, h, i === 0 ? { palette, delay: Math.round(1000 / GIF_FPS), repeat: 0 } : { delay: Math.round(1000 / GIF_FPS) });
      onProgress((i + 1) / count);
      if (i % 4 === 0) await yieldToUi();
    }
    gif.finish();
    return { blob: new Blob([gif.bytes() as Uint8Array<ArrayBuffer>], { type: 'image/gif' }), fileName: `${fileBase(p)}.gif`, seconds: (performance.now() - started) / 1000 };
  } finally {
    r.dispose();
  }
}

/** Opens the share sheet on phones (save to Photos/Files) or downloads on desktop. Call from a user gesture. */
export async function saveFile(blob: Blob, fileName: string): Promise<void> {
  const file = new File([blob], fileName, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
