// Pause detection for "Remove pauses": finds the speech parts of a clip from its waveform peaks.

export interface PauseOptions {
  /** Peak amplitude (0..1) below which a bin counts as silence. */
  threshold: number;
  /** Shortest pause worth cutting, seconds. */
  minPause: number;
  /** Silence kept around speech so cuts don't clip words, seconds. */
  pad: number;
}

export const DEFAULT_PAUSES: PauseOptions = { threshold: 0.03, minPause: 0.45, pad: 0.12 };

/** Source-time ranges to keep inside [from, to), given peak amplitudes sampled at `pps` bins per second. */
export function speechRanges(peaks: Float32Array, pps: number, from: number, to: number, o: PauseOptions): [number, number][] {
  const b0 = Math.max(0, Math.floor(from * pps));
  const b1 = Math.min(peaks.length, Math.ceil(to * pps));
  const pauses: [number, number][] = [];
  let run = -1;
  for (let b = b0; b <= b1; b++) {
    const silent = b < b1 && peaks[b] < o.threshold;
    if (silent && run < 0) run = b;
    if (!silent && run >= 0) {
      const s = Math.max(from, run / pps), e = Math.min(to, b / pps);
      if (e - s >= o.minPause) pauses.push([s, e]);
      run = -1;
    }
  }
  const keep: [number, number][] = [];
  let cursor = from;
  for (const [s, e] of pauses) {
    // Keep `pad` of silence next to speech on every side (also at the clip edges) so words aren't clipped.
    const cutStart = s <= from + 1e-6 ? from : s + o.pad;
    const cutEnd = e >= to - 1e-6 ? to : e - o.pad;
    if (cutEnd - cutStart < 0.05) continue;
    if (cutStart > cursor) keep.push([cursor, cutStart]);
    cursor = cutEnd;
  }
  if (cursor < to) keep.push([cursor, to]);
  return keep.filter(([a, b]) => b - a >= 0.05);
}

/** Total seconds removed if only `keep` stays of [from, to). */
export const removedSeconds = (keep: [number, number][], from: number, to: number): number =>
  to - from - keep.reduce((n, [a, b]) => n + (b - a), 0);

/** Moves a cut point (source seconds) to the quietest moment within [lo, hi], so cuts fall between words. */
export function snapToQuiet(peaks: Float32Array, pps: number, s: number, lo = s - 0.12, hi = s + 0.12): number {
  const b0 = Math.max(0, Math.floor(lo * pps)), b1 = Math.min(peaks.length - 1, Math.ceil(hi * pps));
  let best = Math.round(s * pps), min = Infinity;
  for (let b = b0; b <= b1; b++) {
    const v = peaks[b] + Math.abs(b / pps - s) * 1e-3; // prefer the nearest of equal minima
    if (v < min) { min = v; best = b; }
  }
  return b1 >= b0 ? Math.min(hi, Math.max(lo, (best + 0.5) / pps)) : s;
}

/** Cut range for a word [t0, t1] (source seconds): each edge snaps to quiet on its own side of the word middle. */
export function wordCutRange(peaks: Float32Array, pps: number, t0: number, t1: number): [number, number] {
  // Search near the edges only: inside a word there are quiet consonants that must not attract the cut.
  const q = (t1 - t0) / 4;
  return [snapToQuiet(peaks, pps, t0, t0 - 0.3, t0 + q), snapToQuiet(peaks, pps, t1, t1 - q, t1 + 0.15)];
}
