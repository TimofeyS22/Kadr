// Auto-ducking: music is lowered smoothly while someone speaks in other clips.

export const DUCK_ATTACK = 0.15;
export const DUCK_RELEASE = 0.45;

/** Sorts and merges ranges that overlap or are closer than `gap` seconds. */
export function mergeRanges(ranges: [number, number][], gap = 0.35): [number, number][] {
  const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
  const out: [number, number][] = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + gap) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** Gain multiplier at time t: 1 outside speech, 1 − depth during it, linear attack before and release after. */
export function duckGain(t: number, ranges: [number, number][], depth: number): number {
  let g = 1;
  for (const [a, b] of ranges) {
    let x = 0;
    if (t >= a && t <= b) x = 1;
    else if (t < a && t > a - DUCK_ATTACK) x = (t - (a - DUCK_ATTACK)) / DUCK_ATTACK;
    else if (t > b && t < b + DUCK_RELEASE) x = 1 - (t - b) / DUCK_RELEASE;
    g = Math.min(g, 1 - depth * x);
  }
  return g;
}

/** Times inside (from, to) where the ducking envelope bends (for Web Audio automation). */
export function duckBreakpoints(ranges: [number, number][], from: number, to: number): number[] {
  return ranges.flatMap(([a, b]) => [a - DUCK_ATTACK, a, b, b + DUCK_RELEASE]).filter((x) => x > from && x < to);
}
