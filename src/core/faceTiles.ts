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

type Rect4 = readonly [number, number, number, number];
/**
 * At most `n` hidden rectangles [cx, cy, w, h]: the shader has room for eight, and the ninth face stayed in view. Past
 * that, the two rectangles whose union adds the least area become one: more is hidden than asked, nothing less (audit V-163).
 */
export function fitRects(rects: readonly Rect4[], n: number): Rect4[] {
  const out = [...rects];
  const union = (a: Rect4, b: Rect4): Rect4 => {
    const x0 = Math.min(a[0] - a[2] / 2, b[0] - b[2] / 2), x1 = Math.max(a[0] + a[2] / 2, b[0] + b[2] / 2);
    const y0 = Math.min(a[1] - a[3] / 2, b[1] - b[3] / 2), y1 = Math.max(a[1] + a[3] / 2, b[1] + b[3] / 2);
    return [(x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0];
  };
  while (out.length > n) {
    let best = [0, 1], least = Infinity;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const u = union(out[i], out[j]), grow = u[2] * u[3] - out[i][2] * out[i][3] - out[j][2] * out[j][3];
        if (grow < least) { least = grow; best = [i, j]; }
      }
    }
    const merged = union(out[best[0]], out[best[1]]);
    out.splice(best[1], 1);
    out[best[0]] = merged;
  }
  return out;
}
