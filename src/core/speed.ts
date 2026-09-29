// Speed curves (ramps). A curve gives a speed multiplier c(u) at evenly spaced positions u ∈ [0, 1] of the
// clip's SOURCE range (linear in between). Timeline time needed for source position u is proportional to
// F(u) = ∫₀ᵘ 1/c(x) dx, so with I = F(1): duration = sourceSpan · I / speed.

export const CURVE_POINTS = 7;
/** Density used when a curve is cut (split/trim) so its shape survives resampling. */
export const RESAMPLE_POINTS = 33;
export const MIN_RATE = 0.1;
export const MAX_RATE = 10;
const K = 256;

export interface CurvePreset { id: string; name: string; points: number[] }

export const CURVE_PRESETS: CurvePreset[] = [
  { id: 'hero', name: 'Hero moment', points: [1.6, 1.6, 0.35, 0.25, 0.35, 1.6, 1.6] },
  { id: 'bullet', name: 'Bullet time', points: [3, 3, 0.2, 0.2, 0.2, 3, 3] },
  { id: 'montage', name: 'Montage', points: [1, 3, 0.6, 3, 0.6, 3, 1] },
  { id: 'flashIn', name: 'Flash in', points: [5, 3.5, 2, 1, 1, 1, 1] },
  { id: 'flashOut', name: 'Flash out', points: [1, 1, 1, 1, 2, 3.5, 5] },
  { id: 'slowmo', name: 'Smooth slow-mo', points: [1, 0.7, 0.45, 0.35, 0.45, 0.7, 1] },
  { id: 'jump', name: 'Jump cut', points: [1, 1, 4, 4, 1, 1, 4] },
];

export const clampRate = (x: number): number => Math.min(MAX_RATE, Math.max(MIN_RATE, x));

/** Curve multiplier at source position u (flat outside [0, 1]). */
export function curveAt(points: number[], u: number): number {
  const n = points.length - 1;
  const x = Math.min(n, Math.max(0, u * n));
  const i = Math.min(n - 1, Math.floor(x));
  return points[i] + (points[i + 1] - points[i]) * (x - i);
}

const tables = new Map<string, Float64Array>();

/** Cumulative F at K+1 evenly spaced u (midpoint rule on K steps); cached per curve. */
function table(points: number[]): Float64Array {
  const key = points.join(',');
  let t = tables.get(key);
  if (!t) {
    t = new Float64Array(K + 1);
    for (let k = 0; k < K; k++) t[k + 1] = t[k] + 1 / K / clampRate(curveAt(points, (k + 0.5) / K));
    tables.set(key, t);
    if (tables.size > 64) tables.delete(tables.keys().next().value!);
  }
  return t;
}

/** I = ∫₀¹ 1/c: timeline duration per unit of source at speed 1. */
export const curveIntegral = (points: number[]): number => table(points)[K];

/** Fraction of the clip's duration elapsed when source position u is reached. */
export function uToTimeFraction(points: number[], u: number): number {
  const t = table(points);
  const x = Math.min(K, Math.max(0, u * K));
  const k = Math.min(K - 1, Math.floor(x));
  return (t[k] + (t[k + 1] - t[k]) * (x - k)) / t[K];
}

/** Source position u reached after fraction f of the clip's duration (inverse of uToTimeFraction). */
export function timeFractionToU(points: number[], f: number): number {
  const t = table(points);
  const target = Math.min(1, Math.max(0, f)) * t[K];
  let lo = 0, hi = K;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= target) lo = mid; else hi = mid; }
  const span = t[hi] - t[lo];
  return (lo + (span > 0 ? (target - t[lo]) / span : 0)) / K;
}

/** The part of a curve between source positions u0..u1 (may extend past 0..1, flat), resampled. */
export function subCurve(points: number[], u0: number, u1: number, n = CURVE_POINTS): number[] {
  return Array.from({ length: n }, (_, i) => Math.round(clampRate(curveAt(points, u0 + ((u1 - u0) * i) / (n - 1))) * 1000) / 1000);
}
