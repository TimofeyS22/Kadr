// Face detection for "Hide faces": MediaPipe BlazeFace (short range, ~230 KB, on device, self-hosted model). It runs in
// the vision worker (audit V-167): nine passes a frame on the page held up the interface and the preview.
import type { FaceDetector } from '@mediapipe/tasks-vision';
import type { Rect } from '../core/types';
import { modelLoad } from './modelLoad';
import { askVision, runtimeBytes, visionFiles, visionWorker } from './vision';
import { detectFaces, loadDetector } from './visionCore';
import type { Got } from './watchedFetch';

/** On the page, where no worker can run it (vision.ts). */
let detector: Promise<FaceDetector> | null = null;
/** In the worker: loaded once, with the same time limit and offline message as on the page. */
let warmed: Promise<unknown> | null = null;
/** Who hears the runtime's download while the detector loads (SW-L-3); each piece also keeps the load alive. */
const ears = new Set<(g: Got) => void>();
const tell = (alive: () => void) => (g: Got) => { alive(); ears.forEach((f) => f(g)); };

function getDetector(): Promise<FaceDetector> {
  detector ??= modelLoad(async (alive) => loadDetector(visionFiles('page'), await runtimeBytes('page', tell(alive))), (late) => late.close());
  detector.catch(() => { detector = null; });
  return detector;
}

/** Loads the detector ahead of time; `progress` hears the runtime's download, if there is one. */
export function warmFaces(progress?: (g: Got) => void): Promise<unknown> {
  if (progress) ears.add(progress);
  const w = visionWorker('faces');
  let p: Promise<unknown>;
  if (!w) p = getDetector();
  else {
    // A model that arrives after the limit stays in the worker, ready for the next try.
    warmed ??= modelLoad(async (alive) => askVision(w, { op: 'warm', model: 'faces', runtime: await runtimeBytes('worker', tell(alive)) }), () => undefined);
    warmed.catch(() => { warmed = null; });
    p = warmed;
  }
  return progress ? p.finally(() => ears.delete(progress)) : p;
}

const cache = new Map<string, Rect[]>();
let frameCanvas: HTMLCanvasElement | null = null;
let scratch: HTMLCanvasElement | null = null;

async function detect(image: TexImageSource, w: number, h: number): Promise<Rect[]> {
  if (visionWorker('faces')) {
    await warmFaces();
    const ww = visionWorker('faces'); // the worker may have stopped meanwhile: the page takes over
    if (ww) {
      // The frame as it is: scaled to the detector's 1280 px on the page first, the export was no faster (SW-L-1).
      const out = await askVision(ww, { op: 'faces', image: await createImageBitmap(image as ImageBitmapSource), w, h });
      if ('faces' in out) return out.faces;
    }
  }
  const det = await getDetector();
  frameCanvas ??= document.createElement('canvas');
  scratch ??= document.createElement('canvas');
  return detectFaces(det, image as CanvasImageSource, w, h, frameCanvas, scratch);
}

/** Face boxes in source-image UV space (0..1), padded by 25% so hair and chin are covered too. */
export async function faceBoxes(key: string, image: TexImageSource, w: number, h: number): Promise<Rect[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const boxes = await detect(image, w, h);
  cache.set(key, boxes);
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return boxes;
}
