// "Hide faces" and "Cutout" off the main thread (audit V-167, F-07). The face detector makes nine passes a frame and the
// segmenter reads its mask back from the GPU; on the page both held up the interface and the preview frame by frame.
// Here they run in turn on pictures the page hands over (ImageBitmap, transferred), and only boxes and masks go back.
import type { FaceDetector, ImageSegmenter } from '@mediapipe/tasks-vision';
import type { Rect } from '../core/types';
import { detectFaces, loadDetector, loadSegmenter, personConfidence, personSeen, type VisionFiles } from './visionCore';

type VisionModel = 'faces' | 'segmenter';
/** What the page asks for. */
export type VisionAsk =
  | { op: 'warm'; model: VisionModel }
  | { op: 'faces'; image: ImageBitmap; w: number; h: number }
  | { op: 'mask'; image: ImageBitmap }
  | { op: 'person'; image: ImageBitmap };
/** Page → worker. Every request carries the files, so the worker never guesses a URL of the page's build. */
type VisionIn = { id: number; files: VisionFiles } & VisionAsk;
export type VisionOut =
  | { id: number; faces: Rect[] }
  | { id: number; mask: { data: Uint8Array; w: number; h: number } | null }
  | { id: number; person: boolean }
  | { id: number; ready: true }
  | { id: number; error: string };

// The page's CSP does not reach a worker, and GitHub Pages sends none for it: MediaPipe's own telemetry
// (odml.pa.googleapis.com, every 60 s), stopped on the page, went out from here. The worker talks to Kadr's origin only.
const own = (url: string) => new URL(url, self.location.href).origin === self.location.origin;
const nativeFetch = self.fetch.bind(self);
self.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input);
  return own(url) ? nativeFetch(input, init) : Promise.reject(new TypeError(`Kadr's vision worker does not connect to ${new URL(url, self.location.href).host}`));
};
const nativeOpen = XMLHttpRequest.prototype.open as (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) => void;
XMLHttpRequest.prototype.open = function (this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
  if (!own(String(url))) throw new TypeError(`Kadr's vision worker does not connect to ${new URL(String(url), self.location.href).host}`);
  nativeOpen.call(this, method, url, ...rest);
} as typeof XMLHttpRequest.prototype.open;

// A module worker has no `importScripts`, so MediaPipe imports its runtime (the ES module build, vision.ts) through
// `self.import` when there is one. It clears `self.ModuleFactory` after each task it makes, and a module runs only on its
// first import: the second task (the detector after the segmenter) found no factory. The factory is kept and set again.
const factories = new Map<string, unknown>();
(self as unknown as { import: (url: string) => Promise<void> }).import = async (url: string) => {
  if (!factories.has(url)) factories.set(url, ((await import(/* @vite-ignore */ url)) as { default: unknown }).default);
  (self as unknown as { ModuleFactory: unknown }).ModuleFactory = factories.get(url);
};

let detector: Promise<FaceDetector> | null = null;
let segmenter: Promise<ImageSegmenter> | null = null;
const getDetector = (files: VisionFiles) => {
  detector ??= loadDetector(files);
  detector.catch(() => { detector = null; }); // tried again on the next request
  return detector;
};
const getSegmenter = (files: VisionFiles) => {
  segmenter ??= loadSegmenter(files);
  segmenter.catch(() => { segmenter = null; });
  return segmenter;
};
const frame = new OffscreenCanvas(1, 1);
const scratch = new OffscreenCanvas(1, 1);

async function answer(m: VisionIn): Promise<VisionOut> {
  switch (m.op) {
    case 'warm':
      await (m.model === 'faces' ? getDetector(m.files) : getSegmenter(m.files));
      return { id: m.id, ready: true };
    case 'faces':
      return { id: m.id, faces: detectFaces(await getDetector(m.files), m.image, m.w, m.h, frame, scratch) };
    case 'mask':
      return { id: m.id, mask: personConfidence(await getSegmenter(m.files), m.image) };
    case 'person':
      return { id: m.id, person: personSeen(await getSegmenter(m.files), m.image) };
  }
}

self.onmessage = async (e: MessageEvent<VisionIn>) => {
  const m = e.data;
  let out: VisionOut;
  try {
    out = await answer(m);
  } catch (err) {
    out = { id: m.id, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if ('image' in m) m.image.close(); // the picture was handed over: nobody else frees it
  }
  (self as unknown as Worker).postMessage(out, 'mask' in out && out.mask ? [out.mask.data.buffer] : []);
};
