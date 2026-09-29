// Media access on top of Mediabunny/WebCodecs: probing, per-clip decoding streams, thumbnails, waveforms.
import {
  ALL_FORMATS, AudioBufferSink, BlobSource, CanvasSink, Input,
  type InputAudioTrack, type InputVideoTrack, type WrappedCanvas,
} from 'mediabunny';
import type { AssetKind } from '../core/types';
import { getBlob, getPeaks, putPeaks } from '../storage/db';

/** Error with a user-facing English message (a translation key); `vars` fill its {placeholders}. */
export class MediaError extends Error {
  constructor(message: string, readonly vars?: Record<string, string | number>) { super(message); }
}

export interface Probe { kind: AssetKind; duration: number; width: number; height: number; hasAudio: boolean }

const openInput = (blob: Blob) => new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });

export async function probe(file: Blob): Promise<Probe> {
  if (file.type.startsWith('image/')) {
    const bmp = await createImageBitmap(file).catch(() => { throw new MediaError('This image format is not supported'); });
    const r: Probe = { kind: 'image', duration: 0, width: bmp.width, height: bmp.height, hasAudio: false };
    bmp.close();
    return r;
  }
  const input = openInput(file);
  try {
    if (!(await input.canRead())) throw new MediaError('Unsupported file format');
    const video = await input.getPrimaryVideoTrack();
    const audio = await input.getPrimaryAudioTrack();
    if (video && !(await video.canDecode())) throw new MediaError('This browser cannot decode {codec} video. On iPhone, set Camera → Formats → Most Compatible.', { codec: (await video.getCodec()) ?? '?' });
    const hasAudio = !!audio && (await audio.canDecode());
    if (!video && !hasAudio) throw new MediaError('No playable video or audio found');
    const duration = await input.computeDuration();
    if (!(duration > 0)) throw new MediaError('The file has no duration');
    return {
      kind: video ? 'video' : 'audio',
      duration,
      width: video ? await video.getDisplayWidth() : 0,
      height: video ? await video.getDisplayHeight() : 0,
      hasAudio,
    };
  } finally {
    input.dispose();
  }
}

function fitSize(w: number, h: number, maxDim: number): [number, number] {
  const s = Math.min(1, maxDim / Math.max(w, h));
  return [Math.max(2, Math.round((w * s) / 2) * 2), Math.max(2, Math.round((h * s) / 2) * 2)];
}

/**
 * Sequential frame reader for one clip. Forward reads reuse the running decoder; backward or far
 * jumps restart it at the nearest keyframe. Calls are serialized, so concurrent callers are safe.
 */
class VideoStream {
  lastUsed = 0;
  private it: AsyncGenerator<WrappedCanvas, void, unknown> | null = null;
  private cur: WrappedCanvas | null = null;
  private nxt: WrappedCanvas | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;

  constructor(private sink: CanvasSink) {}

  frameAt(t: number): Promise<WrappedCanvas | null> {
    const run = this.queue.then(() => this.read(t));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async pull(): Promise<WrappedCanvas | null> {
    const r = await this.it!.next();
    return r.done ? null : r.value;
  }

  private async read(t: number): Promise<WrappedCanvas | null> {
    if (this.closed) return null;
    const cur = this.cur;
    if (!this.it || !cur || t < cur.timestamp - 1e-4 || t > cur.timestamp + 2.5) {
      await this.it?.return();
      this.it = this.sink.canvases(t);
      this.cur = await this.pull();
      this.nxt = this.cur ? await this.pull() : null;
    }
    while (this.nxt && this.nxt.timestamp <= t + 1e-4) {
      this.cur = this.nxt;
      this.nxt = await this.pull();
    }
    return this.cur;
  }

  close(): void {
    this.closed = true;
    void this.it?.return().catch(() => undefined);
    this.it = null;
  }
}

interface Handle { input: Input; video: InputVideoTrack | null; audio: InputAudioTrack | null }

/** Owns decoders for one consumer (preview or export). Dispose when done. */
export class MediaPool {
  private handles = new Map<string, Promise<Handle>>();
  private images = new Map<string, Promise<ImageBitmap>>();
  private streams = new Map<string, VideoStream>();
  private disposed = false;

  constructor(private maxDim: number) {}

  private handle(assetId: string): Promise<Handle> {
    let h = this.handles.get(assetId);
    if (!h) {
      h = (async () => {
        const blob = await getBlob(assetId);
        if (!blob) throw new MediaError('Media file is missing from this device');
        const input = openInput(blob);
        return { input, video: await input.getPrimaryVideoTrack(), audio: await input.getPrimaryAudioTrack() };
      })();
      h.catch(() => this.handles.delete(assetId));
      this.handles.set(assetId, h);
    }
    return h;
  }

  image(assetId: string): Promise<ImageBitmap> {
    let p = this.images.get(assetId);
    if (!p) {
      p = getBlob(assetId).then((b) => {
        if (!b) throw new MediaError('Image is missing from this device');
        return createImageBitmap(b);
      });
      p.catch(() => this.images.delete(assetId));
      this.images.set(assetId, p);
    }
    return p;
  }

  async frame(clipId: string, assetId: string, t: number): Promise<WrappedCanvas | null> {
    let s = this.streams.get(clipId);
    if (!s) {
      const h = await this.handle(assetId);
      if (!h.video || this.disposed) return null;
      s = this.streams.get(clipId); // another caller may have created it meanwhile
      if (!s) {
        const [width, height] = fitSize(await h.video.getDisplayWidth(), await h.video.getDisplayHeight(), this.maxDim);
        s = new VideoStream(new CanvasSink(h.video, { width, height, fit: 'contain', poolSize: 3 }));
        this.streams.set(clipId, s);
      }
    }
    s.lastUsed = performance.now();
    return s.frameAt(t);
  }

  async audioSink(assetId: string): Promise<AudioBufferSink | null> {
    const h = await this.handle(assetId);
    return h.audio ? new AudioBufferSink(h.audio) : null;
  }

  /** Closes decoders of clips that were not used recently (hardware decoders are scarce on phones). */
  sweep(keep: Set<string>, idleMs = 1500): void {
    const now = performance.now();
    for (const [id, s] of this.streams) {
      if (!keep.has(id) && now - s.lastUsed > idleMs) { s.close(); this.streams.delete(id); }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const s of this.streams.values()) s.close();
    this.streams.clear();
    for (const h of this.handles.values()) h.then((x) => x.input.dispose(), () => undefined);
    this.handles.clear();
    for (const i of this.images.values()) i.then((b) => b.close(), () => undefined);
    this.images.clear();
  }
}

// ---- Timeline visuals (cached per asset for the session) ----

export interface Thumb { t: number; bmp: ImageBitmap }
const thumbCache = new Map<string, Promise<Thumb[]>>();

export function thumbnails(assetId: string, duration: number, height = 96): Promise<Thumb[]> {
  let p = thumbCache.get(assetId);
  if (!p) {
    p = (async () => {
      const blob = await getBlob(assetId);
      if (!blob) return [];
      if (blob.type.startsWith('image/')) {
        // Resize options are not supported everywhere (older Safari); fall back to full size.
        const bmp = await createImageBitmap(blob, { resizeHeight: height, resizeQuality: 'medium' }).catch(() => createImageBitmap(blob));
        return [{ t: 0, bmp }];
      }
      const input = openInput(blob);
      try {
        const video = await input.getPrimaryVideoTrack();
        if (!video) return [];
        const aspect = (await video.getDisplayWidth()) / (await video.getDisplayHeight());
        const sink = new CanvasSink(video, { width: Math.round(height * aspect), height, fit: 'cover' });
        const n = Math.min(40, Math.max(2, Math.ceil(duration / 1.5)));
        const times = Array.from({ length: n }, (_, i) => ((i + 0.5) * duration) / n);
        const out: Thumb[] = [];
        let i = 0;
        for await (const wc of sink.canvasesAtTimestamps(times)) {
          if (wc) out.push({ t: times[i], bmp: await createImageBitmap(wc.canvas) });
          i++;
        }
        return out;
      } finally {
        input.dispose();
      }
    })();
    p.catch(() => thumbCache.delete(assetId));
    thumbCache.set(assetId, p);
  }
  return p;
}

export const PEAKS_PER_SEC = 50;
const peakCache = new Map<string, Promise<Float32Array>>();

export function waveform(assetId: string): Promise<Float32Array> {
  let p = peakCache.get(assetId);
  if (!p) {
    p = (async () => {
      const stored = await getPeaks(assetId);
      if (stored) return stored;
      const blob = await getBlob(assetId);
      if (!blob) return new Float32Array();
      const input = openInput(blob);
      try {
        const audio = await input.getPrimaryAudioTrack();
        if (!audio) return new Float32Array();
        const duration = await input.computeDuration();
        const peaks = new Float32Array(Math.ceil(duration * PEAKS_PER_SEC) + 1);
        for await (const { buffer, timestamp } of new AudioBufferSink(audio).buffers()) {
          const data = buffer.getChannelData(0);
          const step = buffer.sampleRate / PEAKS_PER_SEC;
          for (let i = 0; i < data.length; i++) {
            const bin = Math.floor(timestamp * PEAKS_PER_SEC + i / step);
            const v = Math.abs(data[i]);
            if (bin < peaks.length && v > peaks[bin]) peaks[bin] = v;
          }
        }
        await putPeaks(assetId, peaks);
        return peaks;
      } finally {
        input.dispose();
      }
    })();
    p.catch(() => peakCache.delete(assetId));
    peakCache.set(assetId, p);
  }
  return p;
}

/** Full-resolution still of a video asset at source time `t`, as JPEG (for freeze frames). */
export async function captureFrame(assetId: string, t: number): Promise<Blob> {
  const pool = new MediaPool(4096);
  try {
    const f = await pool.frame('__capture', assetId, t);
    if (!f) throw new MediaError('Could not read this frame');
    const c = document.createElement('canvas');
    c.width = f.canvas.width;
    c.height = f.canvas.height;
    c.getContext('2d')!.drawImage(f.canvas, 0, 0);
    return await new Promise<Blob>((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new MediaError('Could not encode the frame'))), 'image/jpeg', 0.92));
  } finally {
    pool.dispose();
  }
}
