// Timeline thumbnails off the main thread (docs/04, H2). Each thumbnail decodes only the keyframe nearest to its
// time: one frame instead of up to a whole GOP per seek, so a 1-minute clip costs ~40 decodes, not ~1200.
import { ALL_FORMATS, BlobSource, EncodedPacketSink, Input, VideoSampleSink } from 'mediabunny';

export interface ThumbJob { id: number; blob: Blob; duration: number; height: number; count: number }
export type ThumbReply = { id: number; t: number; bmp: ImageBitmap } | { id: number; done: true; error?: string };

export async function renderThumbs(job: ThumbJob, emit: (t: number, bmp: ImageBitmap) => void, canvas: OffscreenCanvas | HTMLCanvasElement): Promise<void> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(job.blob) });
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) return;
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
      sample.close();
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
  self.onmessage = (e: MessageEvent<ThumbJob>) => {
    const job = e.data;
    queue = queue.then(() => renderThumbs(job, (t, bmp) => postMessage({ id: job.id, t, bmp } satisfies ThumbReply, { transfer: [bmp] }), canvas)
      .then(() => postMessage({ id: job.id, done: true } satisfies ThumbReply))
      .catch((err: unknown) => postMessage({ id: job.id, done: true, error: String(err) } satisfies ThumbReply)));
  };
}
