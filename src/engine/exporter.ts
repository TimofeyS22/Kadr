// Export: renders every frame through the same buildFrame → Compositor path as the preview,
// mixes audio in sample-aligned windows, and muxes with Mediabunny (MP4 H.264/AAC when available).
import {
  AudioBufferSource, BufferTarget, CanvasSource, Mp4OutputFormat, Output, QUALITY_HIGH, QUALITY_VERY_HIGH,
  StreamTarget, WebMOutputFormat, canEncodeVideo, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
} from 'mediabunny';
import { buildFrame } from '../core/frame';
import { projectDuration } from '../core/timeline';
import type { Project, ProjectSettings } from '../core/types';
import { renderAudioWindow } from './audio';
import { Compositor } from './compositor';
import { MediaError, MediaPool } from './media';
import { resolveDrawables } from './render';
import { TextRasterizer } from './text';

export type Resolution = 720 | 1080 | 1440 | 2160;
export interface ExportOptions { resolution: Resolution; fps: number; quality: 'standard' | 'high' }
export interface ExportResult { blob: Blob; fileName: string; seconds: number }

const SAMPLE_RATE = 48000;
const AUDIO_WINDOW_S = 2;

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

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
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const compositor = new Compositor(canvas, true);
  const video = new CanvasSource(canvas, {
    codec: videoCodec, bitrate: opts.quality === 'high' ? QUALITY_VERY_HIGH : QUALITY_HIGH, keyFrameInterval: 2,
  });
  output.addVideoTrack(video, { frameRate: opts.fps });
  const audio = audioCodec ? new AudioBufferSource({ codec: audioCodec, bitrate: QUALITY_HIGH }) : null;
  if (audio) output.addAudioTrack(audio);
  const pool = new MediaPool(Math.max(width, height));
  const text = new TextRasterizer();

  try {
    await output.start();
    const frames = Math.max(1, Math.round(duration * opts.fps));
    const totalSamples = Math.round(duration * SAMPLE_RATE);
    let audioDone = 0;
    const pumpAudio = async (untilS: number) => {
      while (audio && audioDone < totalSamples && audioDone < untilS * SAMPLE_RATE) {
        const next = Math.min(totalSamples, audioDone + AUDIO_WINDOW_S * SAMPLE_RATE);
        await audio.add(await renderAudioWindow(p, pool, audioDone / SAMPLE_RATE, next / SAMPLE_RATE, SAMPLE_RATE));
        audioDone = next;
      }
    };
    for (let i = 0; i < frames; i++) {
      if (signal.aborted) throw new DOMException('Export cancelled', 'AbortError');
      const t = i / opts.fps;
      await pumpAudio(t + 1);
      const desc = buildFrame(p, Math.min(t, duration - 1e-3));
      compositor.draw(desc, await resolveDrawables(desc, pool, text, width, height));
      await video.add(t, 1 / opts.fps);
      onProgress((i + 1) / frames);
      if (i % 8 === 0) await yieldToUi();
    }
    await pumpAudio(Infinity);
    video.close();
    audio?.close();
    await output.finalize();
    const blob = await result();
    const ext = mp4 ? 'mp4' : 'webm';
    const safeName = p.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'kadr';
    return {
      blob,
      fileName: `${safeName}.${ext}`,
      seconds: (performance.now() - started) / 1000,
    };
  } catch (e) {
    await output.cancel().catch(() => undefined);
    throw e;
  } finally {
    pool.dispose();
    compositor.dispose(true);
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
