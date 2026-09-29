// Auto-reframe: turn subject positions sampled over a wide clip into a smooth pan for a narrower canvas.
import type { Keyframe } from './types';

/**
 * Scale (relative to "fit inside") at which a source of aspect `src` covers a canvas of aspect `canvas`.
 * For a wider source this is also the rendered width in canvas widths.
 */
export const coverScale = (src: number, canvas: number): number => (src > canvas ? src / canvas : canvas / src);

export interface SubjectSample { t: number; u: number | null }

/**
 * Keyframes for transform.x (canvas widths) that keep the subject centered: gaps are filled, positions are
 * smoothed, small moves are ignored (dead zone) and the pan never reveals the frame edge.
 */
export function reframeKeys(samples: SubjectSample[], width: number, deadZone = 0.04): Keyframe[] {
  if (!samples.length) return [];
  const known = samples.filter((s) => s.u !== null);
  const fallback = known.length ? known[0].u! : 0.5;
  let last = fallback;
  const filled = samples.map((s) => (last = s.u ?? last));
  const smooth = filled.map((_, i) => {
    const w = filled.slice(Math.max(0, i - 2), i + 3);
    return w.reduce((a, b) => a + b, 0) / w.length;
  });
  const limit = Math.max(0, (width - 1) / 2);
  const keys: Keyframe[] = [];
  let held = smooth[0];
  smooth.forEach((u, i) => {
    if (i > 0 && Math.abs(u - held) < deadZone && i < smooth.length - 1) return;
    held = u;
    const x = Math.max(-limit, Math.min(limit, -(u - 0.5) * width));
    const prev = keys[keys.length - 1];
    if (prev && Math.abs(prev.v - x) < 0.003) return;
    keys.push({ t: Math.round(samples[i].t * 1000) / 1000, v: Math.round(x * 10000) / 10000, e: 'inOut' });
  });
  return keys;
}

/** Horizontal center (0..1) of a person mask, or null when nobody is in the frame. */
export function maskCentroid(data: Uint8Array, w: number, h: number): number | null {
  let sum = 0, sx = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = data[y * w + x];
    if (v > 127) { sum += v; sx += v * x; }
  }
  return sum > w * h * 255 * 0.01 ? sx / sum / Math.max(1, w - 1) : null;
}

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'er', 'erm', 'hmm', 'mm', 'ah', 'эээ', 'ээ', 'э', 'эм', 'мм', 'ммм', 'ам']);
const norm = (w: string) => w.toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');

/** Indices of filler words and immediate repeats ("I I think") — candidates for "edit by text". */
export function fillerIndices(words: { text: string }[]): number[] {
  const out: number[] = [];
  words.forEach((w, i) => {
    const n = norm(w.text);
    if (!n) return;
    if (FILLERS.has(n) || (i + 1 < words.length && norm(words[i + 1].text) === n)) out.push(i);
  });
  return out;
}
