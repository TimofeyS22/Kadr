// Face detection for "Hide faces": MediaPipe BlazeFace (short range, ~230 KB, on device, self-hosted model).
import type { FaceDetector } from '@mediapipe/tasks-vision';
import type { Rect } from '../core/types';

let detector: Promise<FaceDetector> | null = null;

function getDetector(): Promise<FaceDetector> {
  detector ??= (async () => {
    const { FilesetResolver, FaceDetector } = await import('@mediapipe/tasks-vision');
    const base = new URL(import.meta.env.BASE_URL, location.origin).href;
    const files = await FilesetResolver.forVisionTasks(`${base}mediapipe`);
    const make = (delegate: 'GPU' | 'CPU') => FaceDetector.createFromOptions(files, {
      baseOptions: { modelAssetPath: `${base}models/blaze_face_short_range.tflite`, delegate },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.4,
    });
    // Same GPU → CPU fallback as the segmenter: GPU setup can stall on weak or busy devices.
    const gpu = make('GPU');
    try {
      const d = await Promise.race([gpu, new Promise<null>((r) => setTimeout(() => r(null), 8000))]);
      if (d) return d;
      void gpu.then((late) => late.close(), () => undefined);
    } catch { /* GPU unavailable */ }
    return make('CPU');
  })();
  detector.catch(() => { detector = null; });
  return detector;
}

export const warmFaces = (): Promise<unknown> => getDetector();

const cache = new Map<string, Rect[]>();
let scratch: HTMLCanvasElement | null = null;
const MAX_SIDE = 320;
const PAD = 0.25;

/** Face boxes in source-image UV space (0..1), padded by 25% so hair and chin are covered too. */
export async function faceBoxes(key: string, image: TexImageSource, w: number, h: number): Promise<Rect[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const det = await getDetector();
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  scratch ??= document.createElement('canvas');
  scratch.width = Math.max(1, Math.round(w * k));
  scratch.height = Math.max(1, Math.round(h * k));
  scratch.getContext('2d')!.drawImage(image as CanvasImageSource, 0, 0, scratch.width, scratch.height);
  const boxes = det.detect(scratch).detections.flatMap((d) => {
    const b = d.boundingBox;
    if (!b) return [];
    const bw = b.width / scratch!.width, bh = b.height / scratch!.height;
    return [{ x: b.originX / scratch!.width - bw * PAD, y: b.originY / scratch!.height - bh * PAD * 1.4, w: bw * (1 + 2 * PAD), h: bh * (1 + 2.4 * PAD) }];
  });
  cache.set(key, boxes);
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return boxes;
}
