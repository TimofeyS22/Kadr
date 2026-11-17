// Person segmentation for "Remove background": MediaPipe selfie segmenter (on device, ~250 KB model). It runs in the
// vision worker (audit V-167): the mask read back from the GPU held up the page's thread every frame.
import type { ImageSegmenter } from '@mediapipe/tasks-vision';
import type { SegMask } from './text';
import { modelLoad } from './modelLoad';
import { askVision, visionFiles, visionWorker } from './vision';
import { loadSegmenter, personConfidence, personSeen } from './visionCore';

/** On the page, where no worker can run it (vision.ts). */
let segmenter: Promise<ImageSegmenter> | null = null;
/** In the worker: loaded once, with the same time limit and offline message as on the page. */
let warmed: Promise<unknown> | null = null;

function getSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= modelLoad(loadSegmenter(visionFiles('page')), (late) => late.close());
  segmenter.catch(() => { segmenter = null; });
  return segmenter;
}

/** Loads the model ahead of time (e.g. when the user turns the feature on). */
export function warmSegmenter(): Promise<unknown> {
  const w = visionWorker();
  if (!w) return getSegmenter();
  // A model that arrives after the limit stays in the worker, ready for the next try.
  warmed ??= modelLoad(askVision(w, { op: 'warm', model: 'segmenter' }), () => undefined);
  warmed.catch(() => { warmed = null; });
  return warmed;
}

/** The worker's answer for a copy of `image`, or undefined when there is no worker (any more): the page answers then. */
async function inWorker(op: 'mask' | 'person', image: TexImageSource) {
  if (!visionWorker()) return undefined;
  await warmSegmenter();
  const w = visionWorker();
  return w ? askVision(w, { op, image: await createImageBitmap(image as ImageBitmapSource) }) : undefined;
}

const cache = new Map<string, SegMask>();
const previous = new Map<string, { t: number; w: number; h: number; data: Uint8Array }>();

/**
 * Video frames (keys `clipId:time:…`): blend with the previous frame's mask so the cut-out edge doesn't shimmer
 * (docs/05 M4). Only consecutive frames (≤ 0.1 s apart) blend, so a seek never drags in a stale mask; playback
 * and export both run frames in order, so they get the same result.
 */
function smoothInTime(key: string, data: Uint8Array, w: number, h: number): void {
  const [clip, ts] = key.split(':');
  const t = Number(ts);
  if (!clip || !Number.isFinite(t)) return;
  const p = previous.get(clip);
  if (p && p.w === w && p.h === h && t > p.t && t - p.t <= 0.1) {
    for (let i = 0; i < data.length; i++) data[i] = Math.round(data[i] * 0.65 + p.data[i] * 0.35);
  }
  previous.set(clip, { t, w, h, data });
  if (previous.size > 8) previous.delete(previous.keys().next().value!);
}

/** Does the segmenter see a person covering at least 1% of this picture? */
export async function hasPerson(image: TexImageSource): Promise<boolean> {
  const out = await inWorker('person', image);
  if (out && 'person' in out) return out.person;
  return personSeen(await getSegmenter(), image);
}

/** Person mask for an image; `key` identifies the exact frame so paused previews don't recompute. */
export async function personMask(key: string, image: TexImageSource): Promise<SegMask | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  const out = await inWorker('mask', image);
  const m = out && 'mask' in out ? out.mask : personConfidence(await getSegmenter(), image);
  if (!m) return null;
  smoothInTime(key, m.data, m.w, m.h);
  const mask: SegMask = { data: m.data, w: m.w, h: m.h, key };
  cache.set(key, mask);
  if (cache.size > 12) cache.delete(cache.keys().next().value!);
  return mask;
}
