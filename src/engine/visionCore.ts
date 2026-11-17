// MediaPipe's face detector and person segmenter: the same code in the vision worker and, where a worker cannot run
// them, on the page (audit V-167, F-07). Nothing here touches the document: canvases come from the caller.
import type { FaceDetector, ImageSegmenter, ImageSource } from '@mediapipe/tasks-vision';
import type { Rect } from '../core/types';
import { mergeBoxes, tileStarts } from '../core/faceTiles';

/** Absolute URLs of the runtime and the models, as the page's build names them (engine/vision.ts). */
export interface VisionFiles { wasmLoaderPath: string; wasmBinaryPath: string; faceModel: string; segmenterModel: string }
type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
const ctx2d = (c: AnyCanvas) => c.getContext('2d') as Ctx;

export async function loadDetector(files: VisionFiles): Promise<FaceDetector> {
  const { FaceDetector } = await import('@mediapipe/tasks-vision');
  // On the CPU (WASM): the model reads 128x128, so a GPU call is mostly upload and read-back, and a frame takes
  // several (the tiles below). A 6 s export with hidden faces, 22 passes a frame (Mac): GPU 32 s in WebKit and 60-72 s
  // in Chromium, CPU 17.7 s and 12 s; with the 9 passes used now, CPU 9.3 s and 7.6 s (one pass before: 4 s, 5.5-8 s).
  return FaceDetector.createFromOptions({ wasmLoaderPath: files.wasmLoaderPath, wasmBinaryPath: files.wasmBinaryPath }, {
    baseOptions: { modelAssetPath: files.faceModel, delegate: 'CPU' },
    runningMode: 'IMAGE',
    minDetectionConfidence: 0.4,
  });
}

export async function loadSegmenter(files: VisionFiles): Promise<ImageSegmenter> {
  const { ImageSegmenter } = await import('@mediapipe/tasks-vision');
  const make = (delegate: 'GPU' | 'CPU') => ImageSegmenter.createFromOptions({ wasmLoaderPath: files.wasmLoaderPath, wasmBinaryPath: files.wasmBinaryPath }, {
    baseOptions: { modelAssetPath: files.segmenterModel, delegate },
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
}

/** The frame is read once at most this big on its long side; every pass reads from that copy. */
const FRAME_SIDE = 1280;
/** Each pass draws its region at most this big; the model itself reads 128×128. */
const PASS_SIDE = 128;
/**
 * Tiles are this share of the frame's short side and overlap by half, so any face up to a third of the short side lies
 * whole in one. Alone, the whole-frame pass missed faces under ~150 px in a 720x1280 frame (420 of 435 faces of 100 px
 * left visible, audit V-221); with the tiles, faces of 60 and 80 px are all found (e2e, both engines). Smaller tiles
 * find smaller faces but cost a pass each: 0.5 took 22 passes a frame, 0.75 takes 9.
 */
const TILE_SHARE = 0.75;
const PAD = 0.25;
/**
 * A tile sees a quarter of the frame closely, so anything face-like there is a candidate: on a fractal with no face
 * (fixtures/photo.png) two tiles found «faces» at 0.41 and a quarter of the picture was blurred (SW-C-5). Real faces in
 * tiles scored 0.87–0.99; 0.42–0.63 were faces cut by a tile's edge, found whole by the overlapping tile next to it. The
 * whole-frame pass keeps the detector's own 0.4.
 */
const TILE_MIN_SCORE = 0.5;

/** Face boxes in source-image UV space (0..1), padded by 25% so hair and chin are covered too. */
export function detectFaces(det: FaceDetector, image: CanvasImageSource, w: number, h: number, frame: AnyCanvas, scratch: AnyCanvas): Rect[] {
  const k = Math.min(1, FRAME_SIDE / Math.max(w, h));
  const fw = Math.max(1, Math.round(w * k)), fh = Math.max(1, Math.round(h * k));
  frame.width = fw;
  frame.height = fh;
  ctx2d(frame).drawImage(image, 0, 0, fw, fh);
  const found: Rect[] = [];
  const pass = (sx: number, sy: number, sw: number, sh: number, minScore = 0) => {
    const s = Math.min(1, PASS_SIDE / Math.max(sw, sh));
    scratch.width = Math.max(1, Math.round(sw * s));
    scratch.height = Math.max(1, Math.round(sh * s));
    ctx2d(scratch).drawImage(frame, sx, sy, sw, sh, 0, 0, scratch.width, scratch.height);
    const kx = sw / scratch.width, ky = sh / scratch.height;
    for (const d of det.detect(scratch as ImageSource).detections) {
      const b = d.boundingBox;
      if (b && (d.categories[0]?.score ?? 0) >= minScore) found.push({ x: (sx + b.originX * kx) / fw, y: (sy + b.originY * ky) / fh, w: (b.width * kx) / fw, h: (b.height * ky) / fh });
    }
  };
  pass(0, 0, fw, fh); // large faces
  const t = Math.round(Math.min(fw, fh) * TILE_SHARE);
  if (t >= 96) for (const y of tileStarts(fh, t)) for (const x of tileStarts(fw, t)) pass(x, y, t, t, TILE_MIN_SCORE); // small ones
  return mergeBoxes(found).map((b) => ({ x: b.x - b.w * PAD, y: b.y - b.h * PAD * 1.4, w: b.w * (1 + 2 * PAD), h: b.h * (1 + 2.4 * PAD) }));
}

/** The person's confidence, 0..255 a pixel, at the model's size; null when the model gives no mask. */
export function personConfidence(seg: ImageSegmenter, image: TexImageSource): { data: Uint8Array; w: number; h: number } | null {
  const result = seg.segment(image as ImageSource);
  try {
    const masks = result.confidenceMasks ?? [];
    const m = masks.length > 1 ? masks[1] : masks[0]; // multi-class models put "person" at index 1
    if (!m) return null;
    const f = m.getAsFloat32Array();
    const data = new Uint8Array(f.length);
    for (let i = 0; i < f.length; i++) data[i] = Math.round(Math.min(1, Math.max(0, f[i])) * 255);
    return { data, w: m.width, h: m.height };
  } finally {
    result.close();
  }
}

/** Does the segmenter see a person covering at least 1% of this picture? */
export function personSeen(seg: ImageSegmenter, image: TexImageSource): boolean {
  const result = seg.segment(image as ImageSource);
  try {
    const masks = result.confidenceMasks ?? [];
    const m = masks.length > 1 ? masks[1] : masks[0];
    if (!m) return false;
    const f = m.getAsFloat32Array();
    let n = 0;
    for (let i = 0; i < f.length; i++) if (f[i] > 0.5) n++;
    return n > f.length * 0.01;
  } finally {
    result.close();
  }
}
