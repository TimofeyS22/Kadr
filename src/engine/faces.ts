// Face detection for "Hide faces": MediaPipe BlazeFace (short range, ~230 KB, on device, self-hosted model).
import type { FaceDetector } from '@mediapipe/tasks-vision';
import type { Rect } from '../core/types';
import { mergeBoxes, tileStarts } from '../core/faceTiles';
import { modelLoad } from './modelLoad';
import { FACE_MODEL, visionFiles } from './vision';

let detector: Promise<FaceDetector> | null = null;

function getDetector(): Promise<FaceDetector> {
  detector ??= modelLoad((async () => {
    const { FaceDetector } = await import('@mediapipe/tasks-vision');
    // On the CPU (WASM): the model reads 128x128, so a GPU call is mostly upload and read-back, and a frame takes
    // several (the tiles below). A 6 s export with hidden faces, 22 passes a frame (Mac): GPU 32 s in WebKit and 60-72 s
    // in Chromium, CPU 17.7 s and 12 s; with the 9 passes used now, CPU 9.3 s and 7.6 s (one pass before: 4 s, 5.5-8 s).
    return FaceDetector.createFromOptions(visionFiles(), {
      baseOptions: { modelAssetPath: FACE_MODEL(), delegate: 'CPU' },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.4,
    });
  })(), (late) => late.close());
  detector.catch(() => { detector = null; });
  return detector;
}

export const warmFaces = (): Promise<unknown> => getDetector();

const cache = new Map<string, Rect[]>();
let frameCanvas: HTMLCanvasElement | null = null;
let scratch: HTMLCanvasElement | null = null;
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

/** Face boxes in source-image UV space (0..1), padded by 25% so hair and chin are covered too. */
export async function faceBoxes(key: string, image: TexImageSource, w: number, h: number): Promise<Rect[]> {
  const hit = cache.get(key);
  if (hit) return hit;
  const det = await getDetector();
  const k = Math.min(1, FRAME_SIDE / Math.max(w, h));
  const fw = Math.max(1, Math.round(w * k)), fh = Math.max(1, Math.round(h * k));
  frameCanvas ??= document.createElement('canvas');
  scratch ??= document.createElement('canvas');
  frameCanvas.width = fw;
  frameCanvas.height = fh;
  frameCanvas.getContext('2d')!.drawImage(image as CanvasImageSource, 0, 0, fw, fh);
  const found: Rect[] = [];
  const pass = (sx: number, sy: number, sw: number, sh: number) => {
    const s = Math.min(1, PASS_SIDE / Math.max(sw, sh));
    scratch!.width = Math.max(1, Math.round(sw * s));
    scratch!.height = Math.max(1, Math.round(sh * s));
    scratch!.getContext('2d')!.drawImage(frameCanvas!, sx, sy, sw, sh, 0, 0, scratch!.width, scratch!.height);
    const kx = sw / scratch!.width, ky = sh / scratch!.height;
    for (const d of det.detect(scratch!).detections) {
      const b = d.boundingBox;
      if (b) found.push({ x: (sx + b.originX * kx) / fw, y: (sy + b.originY * ky) / fh, w: (b.width * kx) / fw, h: (b.height * ky) / fh });
    }
  };
  pass(0, 0, fw, fh); // large faces
  const t = Math.round(Math.min(fw, fh) * TILE_SHARE);
  if (t >= 96) for (const y of tileStarts(fh, t)) for (const x of tileStarts(fw, t)) pass(x, y, t, t); // small ones
  const boxes = mergeBoxes(found).map((b) => ({ x: b.x - b.w * PAD, y: b.y - b.h * PAD * 1.4, w: b.w * (1 + 2 * PAD), h: b.h * (1 + 2.4 * PAD) }));
  cache.set(key, boxes);
  if (cache.size > 30) cache.delete(cache.keys().next().value!);
  return boxes;
}
