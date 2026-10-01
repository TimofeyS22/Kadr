// Person segmentation for "Remove background": MediaPipe selfie segmenter (on device, ~250 KB model).
import type { ImageSegmenter, ImageSource } from '@mediapipe/tasks-vision';
import type { SegMask } from './text';

let segmenter: Promise<ImageSegmenter> | null = null;

function getSegmenter(): Promise<ImageSegmenter> {
  segmenter ??= (async () => {
    const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision');
    const base = new URL(import.meta.env.BASE_URL, location.origin).href; // works under a sub-path (GitHub Pages)
    const files = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
    const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}models/selfie_segmenter.tflite`, delegate },
      runningMode: 'IMAGE',
      outputCategoryMask: false,
      outputConfidenceMasks: true,
    });
    // GPU is fastest, but its setup can fail or stall on weak or busy devices: fall back to CPU after 8 s.
    const gpu = make('GPU');
    const timeout = new Promise<null>((r) => setTimeout(() => r(null), 8000));
    try {
      const seg = await Promise.race([gpu, timeout]);
      if (seg) return seg;
      void gpu.then((late) => late.close(), () => undefined);
    } catch { /* GPU unavailable */ }
    return make('CPU');
  })();
  segmenter.catch(() => { segmenter = null; });
  return segmenter;
}

/** Loads the model ahead of time (e.g. when the user turns the feature on). */
export const warmSegmenter = (): Promise<unknown> => getSegmenter();

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

/** Person mask for an image; `key` identifies the exact frame so paused previews don't recompute. */
export async function personMask(key: string, image: TexImageSource): Promise<SegMask | null> {
  const hit = cache.get(key);
  if (hit) return hit;
  const seg = await getSegmenter();
  const result = seg.segment(image as ImageSource);
  try {
    const masks = result.confidenceMasks ?? [];
    const m = masks.length > 1 ? masks[1] : masks[0]; // multi-class models put "person" at index 1
    if (!m) return null;
    const f = m.getAsFloat32Array();
    const data = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, f[i])) * 255);
    smoothInTime(key, data, m.width, m.height);
    const mask: SegMask = { data, w: m.width, h: m.height, key };
    cache.set(key, mask);
    if (cache.size > 12) cache.delete(cache.keys().next().value!);
    return mask;
  } finally {
    result.close();
  }
}
