// Timeline thumbnails off the main thread (docs/04, H2). Each thumbnail decodes only the keyframe nearest to its
// time: one frame instead of up to a whole GOP per seek, so a 1-minute clip costs ~40 decodes, not ~1200.
import { EncodedPacketSink, VideoSampleSink } from 'mediabunny';
import { correctPixels, decodedAs709, hdrTransfer, sdMatrix } from './hdr';
import { openInput } from './source';
import type { ChunkedMedia, StoredMedia } from '../storage/chunks';

/** `media`: on the main thread the stored file's reader itself; in the worker a stand-in that asks for its bytes. */
export interface ThumbJob { id: number; media: StoredMedia; duration: number; height: number; count: number }
/**
 * A job as the worker gets it: the file's size and type, never a Blob (docs/19 H8, ADR-М4). The worker asks the main
 * thread for each range it needs, and the main thread reads it through the door that replaces a Blob that stops
 * reading: a camera take's thumbnails are made right after its import, just as its pieces go (S-1-13).
 */
export type ThumbPost = Omit<ThumbJob, 'media'> & { size: number; type: string };
/** Main thread → worker: a job, or the bytes (or the error) of a range the worker asked for. */
export type ThumbIn = { job: ThumbPost } | { read: number; bytes?: ArrayBuffer; error?: string };
/** Worker → main thread: a thumbnail, the end of a job, or a range of the job's file to read. */
export type ThumbReply = { id: number; t: number; bmp: ImageBitmap } | { id: number; done: true; error?: string } | { id: number; read: number; start: number; end: number };

export async function renderThumbs(job: ThumbJob, emit: (t: number, bmp: ImageBitmap) => void, canvas: OffscreenCanvas | HTMLCanvasElement): Promise<void> {
  const input = openInput(job.media);
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return;
    const hdr = await hdrTransfer(track);
    const sd = await sdMatrix(track);
    const aspect = (await track.getDisplayWidth()) / (await track.getDisplayHeight());
    canvas.width = Math.max(2, Math.round(job.height * aspect));
    canvas.height = job.height;
    const ctx = canvas.getContext('2d') as OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;
    const packets = new EncodedPacketSink(track);
    const samples = new VideoSampleSink(track);
    const done = new Set<number>();
    for (let i = 0; i < job.count; i++) {
      const t = ((i + 0.5) * job.duration) / job.count;
      const key = await packets.getKeyPacket(t);
      const kt = key?.timestamp ?? 0;
      if (done.has(kt)) continue; // long GOPs: neighbours share a keyframe
      done.add(kt);
      const sample = await samples.getSample(kt);
      if (!sample) continue;
      sample.drawWithFit(ctx, { fit: 'cover' });
      const as601 = decodedAs709(sd, sample.colorSpace.matrix);
      sample.close();
      if (hdr || as601) {
        const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
        correctPixels(image.data, { hdr, as601 });
        ctx.putImageData(image, 0, 0);
      }
      emit(kt, await createImageBitmap(canvas));
    }
  } finally {
    input.dispose();
  }
}

// Worker entry (the module is also imported on the main thread as a fallback, where `self.document` exists).
if (typeof document === 'undefined') {
  const canvas = new OffscreenCanvas(2, 2);
  let queue = Promise.resolve();
  let nextRead = 0;
  const reads = new Map<number, { resolve: (b: Uint8Array<ArrayBuffer>) => void; reject: (e: Error) => void }>();
  const remote = ({ id, size, type }: ThumbPost): ChunkedMedia => ({
    size, type,
    read: (start, end) => new Promise((resolve, reject) => {
      const read = ++nextRead;
      reads.set(read, { resolve, reject });
      postMessage({ id, read, start, end } satisfies ThumbReply);
    }),
  });
  self.onmessage = (e: MessageEvent<ThumbIn>) => {
    const m = e.data;
    if ('read' in m) {
      const r = reads.get(m.read);
      reads.delete(m.read);
      if (m.bytes) r?.resolve(new Uint8Array(m.bytes));
      else r?.reject(new Error(m.error ?? 'The stored file could not be read'));
      return;
    }
    const job: ThumbJob = { ...m.job, media: remote(m.job) };
    queue = queue.then(() => renderThumbs(job, (t, bmp) => postMessage({ id: job.id, t, bmp } satisfies ThumbReply, { transfer: [bmp] }), canvas)
      .then(() => postMessage({ id: job.id, done: true } satisfies ThumbReply))
      .catch((err: unknown) => postMessage({ id: job.id, done: true, error: String(err) } satisfies ThumbReply)));
  };
}
