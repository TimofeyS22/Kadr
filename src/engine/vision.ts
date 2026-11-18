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
import { watchedBlob, type Got } from './watchedFetch';
import type { VisionAsk, VisionModel, VisionOut } from './vision.worker';

const abs = (url: string) => new URL(url, location.href).href;

/**
 * The runtimes' own sizes in bytes, as the package ships them (vision.test.ts checks them against node_modules). A
 * server that compresses the file on the way says only the compressed length: the share downloaded is counted
 * against these (SW-L-3).
 */
export const RUNTIME_BYTES = { page: 11_756_954, worker: 11_756_972 } as const;

/**
 * The runtime and model files (SIMD build: every browser Kadr supports has WebAssembly SIMD), as absolute URLs: the
 * page loads the classic runtime through a <script>, the worker the module one.
 */
export const visionFiles = (where: 'page' | 'worker'): VisionFiles => ({
  wasmLoaderPath: abs(where === 'page' ? loader : moduleLoader),
  wasmBinaryPath: abs(where === 'page' ? binary : moduleBinary),
  wasmBytes: RUNTIME_BYTES[where],
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
  if (!workersPossible()) {
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

/**
 * The runtime's bytes (11.8 MB; 3.5 MB on the wire, gzipped), downloaded by the page and not by MediaPipe (SW-L-3).
 * MediaPipe's own fetch said nothing until it was done, and with a 60 s limit on the whole load a slow network on the
 * iPhone was told «the server did not answer». One download at a time for a runtime, whatever model or worker waits;
 * each `progress` hears it until it is in. The bytes are not kept: the next load reads them from the cache.
 */
const downloads = new Map<string, Promise<Blob>>();
const listeners = new Map<string, Set<(g: Got) => void>>();
/** Runtimes whose download failed in this page: the next try goes past the HTTP cache (watchedBlob). */
const failed = new Set<string>();
/** A runtime came whole in this page (it is in the cache now), or is coming for a preload: none is started again. */
let preloaded = false;

export function runtimeBytes(where: 'page' | 'worker', progress?: (g: Got) => void): Promise<Blob> {
  const { wasmBinaryPath: url, wasmBytes } = visionFiles(where);
  const ears = listeners.get(url) ?? new Set();
  listeners.set(url, ears);
  if (progress) ears.add(progress);
  let bytes = downloads.get(url);
  if (!bytes) {
    bytes = watchedBlob(url, wasmBytes, 'application/wasm', (g) => ears.forEach((f) => f(g)), { fresh: failed.has(url) })
      .then((b) => { preloaded = true; return b; }, (e: unknown) => { failed.add(url); throw e; })
      .finally(() => downloads.delete(url));
    downloads.set(url, bytes);
  }
  return progress ? bytes.finally(() => ears.delete(progress)) : bytes;
}

const workersPossible = () => typeof Worker !== 'undefined' && typeof OffscreenCanvas !== 'undefined' && typeof createImageBitmap !== 'undefined';

/**
 * The runtime downloaded ahead, when the person shows they may want it: the Hide faces sheet or the panel of all tools
 * opened, the ribbon scrolled to Cutout (SW-L-3, lead's decision: on intent, not on a picked clip — Safari says nothing
 * of a metered network, so a picked clip would cost every newcomer 3.5 MB). Between the sheet and the tap a few
 * seconds pass; a tap before the end joins this download and its overlay says how far it is. A failure is not said: the
 * tap tries again and says why. The bytes are not kept: the tap reads them from the cache.
 */
export function preloadVision(): void {
  if (preloaded || !navigator.onLine) return;
  preloaded = true;
  runtimeBytes(workersPossible() ? 'worker' : 'page').catch(() => { preloaded = false; });
}

/** One request to the worker. `image` is handed over (transferred): the caller passes a copy it does not need. */
export function askVision(w: Worker, req: VisionAsk): Promise<VisionOut> {
  const id = nextId++;
  return new Promise<VisionOut>((resolve, reject) => {
    waiting.set(id, { worker: w, resolve, reject });
    w.postMessage({ ...req, id, files: visionFiles('worker') }, 'image' in req ? [req.image] : []);
  });
}
