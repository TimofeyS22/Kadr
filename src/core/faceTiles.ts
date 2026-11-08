// Tiles and box merging for face detection (engine/faces.ts): pure, so they are tested without a browser.
import type { Rect } from './types';

/** Overlapping boxes as one: their union, so a face found twice (whole frame and tile, two tiles) is covered whole. */
export function mergeBoxes(boxes: Rect[]): Rect[] {
  const out = boxes.map((b) => ({ ...b }));
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < out.length && !merged; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const a = out[i], b = out[j];
        const iw = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x), ih = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (iw <= 0 || ih <= 0 || iw * ih < 0.3 * Math.min(a.w * a.h, b.w * b.h)) continue;
        const x = Math.min(a.x, b.x), y = Math.min(a.y, b.y);
        out[i] = { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
        out.splice(j, 1);
        merged = true;
        break;
      }
    }
  }
  return out;
}

/** Where tiles of side `t` start along a side of `len`, overlapping by about half. */
export function tileStarts(len: number, t: number): number[] {
  if (t >= len) return [0];
  const n = Math.ceil((len - t) / (t / 2)) + 1;
  return Array.from({ length: n }, (_, i) => Math.round((i * (len - t)) / (n - 1)));
}
