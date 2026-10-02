// Media access on top of Mediabunny/WebCodecs: probing, per-clip decoding streams, thumbnails, waveforms.
import {
  ALL_FORMATS, AudioBufferSink, BlobSource, EncodedPacketSink, Input, VideoSampleSink,
  type InputAudioTrack, type InputVideoTrack, type VideoSample,
} from 'mediabunny';
import type { AssetKind } from '../core/types';
import { mark } from '../lib/perf';
import { renderThumbs, type ThumbJob, type ThumbReply } from './thumbs.worker';
import { getBlob, getPeaks, putPeaks } from '../storage/db';

/** Error with a user-facing English message (a translation key); `vars` fill its {placeholders}. */
export class MediaError extends Error {
  constructor(message: string, readonly vars?: Record<string, string | number>) { super(message); }
}

export interface Probe { kind: AssetKind; duration: number; width: number; height: number; hasAudio: boolean }

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));
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
/** A decoded frame ready to draw: a canvas in display orientation, reused by the stream. */
export interface StreamFrame { canvas: HTMLCanvasElement; timestamp: number; /** false: a keyframe shown while scrubbing */ exact: boolean }

/**
 * Sequential per-clip decoding (docs/04, H4). Frames the preview skips are closed without being drawn: only the
 * frame actually shown is converted to a canvas. Converting every decoded frame used to take ~90% of the main
 * thread during playback and made long projects play at ~1 fps.
 */
class VideoStream {
  lastUsed = 0;
  private it: AsyncGenerator<VideoSample, void, unknown> | null = null;
  private cur: VideoSample | null = null;
  private nxt: VideoSample | null = null;
  private queue: Promise<unknown> = Promise.resolve();
  private closed = false;
  // Two canvases alternate so a frame being uploaded is never overwritten by the next one.
  private readonly canvases: HTMLCanvasElement[];
  private flip = 0;
  private shown: StreamFrame | null = null;

  constructor(private sink: VideoSampleSink, private packets: EncodedPacketSink, width: number, height: number) {
    this.canvases = [0, 1].map(() => Object.assign(document.createElement('canvas'), { width, height }));
  }

  frameAt(t: number, fast = false): Promise<StreamFrame | null> {
    const run = this.queue.then(() => this.readSafe(t, fast));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** The next decoded sample; null once the stream is closed (a sample that arrives late is closed, not kept). */
  private async pull(): Promise<VideoSample | null> {
    const it = this.it;
    if (!it || this.closed) return null;
    const r = await it.next();
    if (r.done) return null;
    if (this.closed || it !== this.it) { r.value.close(); return null; }
    return r.value;
  }

  /** Stops the running decoder and forgets its samples; the next read seeks afresh. */
  private async reset(): Promise<void> {
    const it = this.it;
    this.it = null;
    this.drop();
    await it?.return().catch(() => undefined);
  }

  /**
   * A sample can be closed under us: the browser reclaims a phone's hardware decoder, or Mediabunny's iterator closes
   * the last frame of a clip on cleanup. That used to surface as "VideoSample is closed"; now decoding restarts once.
   */
  private async readSafe(t: number, fast: boolean): Promise<StreamFrame | null> {
    try {
      return await this.read(t, fast);
    } catch (e) {
      if (this.closed) return null;
      if (!/closed/i.test(errorText(e))) throw e;
      await this.reset();
      return await this.read(t, fast);
    }
  }

  private drop(): void {
    this.cur?.close();
    this.nxt?.close();
    this.cur = this.nxt = null;
  }

  private show(s: VideoSample, exact: boolean): StreamFrame {
    if (this.shown?.timestamp !== s.timestamp || this.shown.exact !== exact) {
      const canvas = this.canvases[(this.flip ^= 1)];
      const ctx = canvas.getContext('2d')!;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      s.drawWithFit(ctx, { fit: 'contain' }); // applies the rotation of phone videos
      this.shown = { canvas, timestamp: s.timestamp, exact };
    }
    return this.shown;
  }

  private async read(t: number, fast: boolean): Promise<StreamFrame | null> {
    if (this.closed) return null;
    const cur = this.cur;
    const far = !this.it || !cur || t < cur.timestamp - 1e-4 || t > cur.timestamp + 2.5;
    if (far && fast) {
      // Scrubbing: show the nearest keyframe right away (one decode); the exact frame follows when asked.
      const key = await this.packets.getKeyPacket(t);
      const s = await this.sink.getSample(key?.timestamp ?? t);
      if (!s || this.closed) { s?.close(); return this.shown; }
      const f = this.show(s, false);
      s.close();
      return f;
    }
    if (far) {
      await this.reset();
      if (this.closed) return null;
      this.it = this.sink.samples(t);
      this.cur = await this.pull();
      this.nxt = this.cur ? await this.pull() : null;
    }
    while (this.nxt && this.nxt.timestamp <= t + 1e-4) {
      this.cur?.close(); // skipped: never drawn
      this.cur = this.nxt;
      this.nxt = null;
      this.nxt = await this.pull();
    }
    const c = this.cur;
    if (!c || this.closed) return null;
    return this.show(c, true);
  }

  close(): void {
    this.closed = true;
    void this.reset();
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

  async frame(clipId: string, assetId: string, t: number, fast = false): Promise<StreamFrame | null> {
    let s = this.streams.get(clipId);
    if (!s) {
      const h = await this.handle(assetId);
      if (!h.video || this.disposed) return null;
      s = this.streams.get(clipId); // another caller may have created it meanwhile
      if (!s) {
        const [width, height] = fitSize(await h.video.getDisplayWidth(), await h.video.getDisplayHeight(), this.maxDim);
        s = new VideoStream(new VideoSampleSink(h.video), new EncodedPacketSink(h.video), width, height);
        this.streams.set(clipId, s);
      }
    }
    s.lastUsed = performance.now();
    return s.frameAt(t, fast);
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

let thumbWorker: Worker | null | undefined;
let nextJob = 0;
const waiting = new Map<number, { out: Thumb[]; resolve: (t: Thumb[]) => void; reject: (e: Error) => void }>();

/** The shared thumbnail worker, or null where workers can't decode (then thumbnails render on this thread). */
function worker(): Worker | null {
  if (thumbWorker !== undefined) return thumbWorker;
  try {
    if (typeof OffscreenCanvas === 'undefined' || typeof VideoDecoder === 'undefined') throw new Error('no worker decoding');
    thumbWorker = new Worker(new URL('./thumbs.worker.ts', import.meta.url), { type: 'module' });
    thumbWorker.onmessage = (e: MessageEvent<ThumbReply>) => {
      const r = e.data, w = waiting.get(r.id);
      if (!w) return;
      if ('bmp' in r) w.out.push({ t: r.t, bmp: r.bmp });
      else { waiting.delete(r.id); if (r.error) w.reject(new Error(r.error)); else w.resolve(w.out); }
    };
    thumbWorker.onerror = () => { thumbWorker = null; for (const w of waiting.values()) w.reject(new Error('thumbnail worker failed')); waiting.clear(); };
  } catch {
    thumbWorker = null;
  }
  return thumbWorker;
}

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
      const job: ThumbJob = { id: ++nextJob, blob, duration, height, count: Math.min(40, Math.max(2, Math.ceil(duration / 1.5))) };
      const w = worker();
      const out = w
        ? await new Promise<Thumb[]>((resolve, reject) => { waiting.set(job.id, { out: [], resolve, reject }); w.postMessage(job); })
        : await (async () => { const list: Thumb[] = []; await renderThumbs(job, (t, bmp) => list.push({ t, bmp }), document.createElement('canvas')); return list; })();
      mark(`thumbs:${assetId}`);
      return out;
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
        mark(`wave:${assetId}`);
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
