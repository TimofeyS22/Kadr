// MediaPipe's runtime and models come from Kadr's own build, each with a hash in its name (docs/12 P2). A deploy
// keeps the files of earlier versions (scripts/keep-assets.mjs), so a tab opened before an update still gets the
// runtime its code was made for, and a cached copy can never be another version under the same name — as it could
// at /mediapipe/ and /models/, or with a model fetched from a "latest" URL.
import loader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import binary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
// The same runtime as an ES module that sets `globalThis.ModuleFactory` itself, for the worker: a module worker cannot
// `importScripts`, and the classic loader's `var ModuleFactory` stays inside a module ("ModuleFactory not set").
import moduleLoader from '@mediapipe/tasks-vision/vision_wasm_module_internal.js?url';
import moduleBinary from '@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url';
import faceModel from './mediapipe/blaze_face_short_range.tflite?url';
import segmenterModel from './mediapipe/selfie_segmenter.tflite?url';
import type { VisionFiles } from './visionCore';
import type { VisionAsk, VisionModel, VisionOut } from './vision.worker';

const abs = (url: string) => new URL(url, location.href).href;

/**
 * The runtime and model files (SIMD build: every browser Kadr supports has WebAssembly SIMD), as absolute URLs: the
 * page loads the classic runtime through a <script>, the worker the module one.
 */
export const visionFiles = (where: 'page' | 'worker'): VisionFiles => ({
  wasmLoaderPath: abs(where === 'page' ? loader : moduleLoader),
  wasmBinaryPath: abs(where === 'page' ? binary : moduleBinary),
  faceModel: abs(faceModel),
  segmenterModel: abs(segmenterModel),
});

/**
 * The vision workers (vision.worker.ts, audit V-167): the detector and the segmenter run there, not on the page's thread,
 * each model in a worker of its own. In one worker a frame with both waited for them in turn: a 30 s 1080p export with
 * Cutout and Hide faces spent 27 s on masks and 25 s on faces of its 63 s (WebKit, Mac), and 107 s on an iPhone 15
 * (SW-L-1). Each MediaPipe task has its own WebAssembly instance either way, so a second worker adds only a thread.
 * Null where a worker cannot run them (no Worker, OffscreenCanvas or createImageBitmap), or once that worker has
 * failed: the page then runs the same code (visionCore.ts), as it always did before.
 */
const workers = new Map<VisionModel, Worker | null>();
let nextId = 1;
const waiting = new Map<number, { worker: Worker; resolve: (o: VisionOut) => void; reject: (e: Error) => void }>();

export function visionWorker(model: VisionModel): Worker | null {
  const known = workers.get(model);
  if (known !== undefined) return known;
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof createImageBitmap === 'undefined') {
    workers.set(model, null);
    return null;
  }
  let worker: Worker;
  try {
    worker = new Worker(new URL('./vision.worker.ts', import.meta.url), { type: 'module' });
  } catch {
    workers.set(model, null);
    return null;
  }
  worker.onmessage = (e: MessageEvent<VisionOut>) => {
    const w = waiting.get(e.data.id);
    waiting.delete(e.data.id);
    if (!w) return;
    if ('error' in e.data) w.reject(new Error(e.data.error));
    else w.resolve(e.data);
  };
  // The worker's own code did not run (its file gone after a deploy, a browser that refuses it): what waits on it fails,
  // and the next request for its model runs on the page.
  worker.onerror = (e) => {
    e.preventDefault();
    worker.terminate();
    workers.set(model, null);
    for (const [id, w] of waiting) {
      if (w.worker !== worker) continue;
      waiting.delete(id);
      w.reject(new Error(e.message || 'The vision worker stopped'));
    }
  };
  workers.set(model, worker);
  return worker;
}

function sizeOf(image: TexImageSource): [number, number] {
  if ('displayWidth' in image) return [image.displayWidth, image.displayHeight]; // VideoFrame
  if ('videoWidth' in image) return [image.videoWidth, image.videoHeight];
  if ('naturalWidth' in image) return [image.naturalWidth, image.naturalHeight];
  return [image.width, image.height];
}

/** A copy of `image` for a worker, at most `side` on its long side (scaled on the page, where the GPU does it). */
export function bitmapAt(image: TexImageSource, side: number): Promise<ImageBitmap> {
  const [w, h] = sizeOf(image);
  const k = side / Math.max(w, h);
  if (!(k < 1)) return createImageBitmap(image as ImageBitmapSource);
  return createImageBitmap(image as ImageBitmapSource, { resizeWidth: Math.max(1, Math.round(w * k)), resizeHeight: Math.max(1, Math.round(h * k)), resizeQuality: 'medium' });
}

/** One request to the worker. `image` is handed over (transferred): the caller passes a copy it does not need. */
export function askVision(w: Worker, req: VisionAsk): Promise<VisionOut> {
  const id = nextId++;
  return new Promise<VisionOut>((resolve, reject) => {
    waiting.set(id, { worker: w, resolve, reject });
    w.postMessage({ ...req, id, files: visionFiles('worker') }, 'image' in req ? [req.image] : []);
  });
}
