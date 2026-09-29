// Beat tracking: tempo by autocorrelation of an onset-strength envelope, then the best-aligned beat grid.

export interface BeatGrid { bpm: number; times: number[] }

/** Onset strength: positive change of log energy per hop (energies sampled every `hop` seconds). */
export function onsetEnvelope(energy: Float32Array): Float32Array {
  const out = new Float32Array(energy.length);
  let prev = Math.log10(energy[0] + 1e-9);
  for (let i = 1; i < energy.length; i++) {
    const cur = Math.log10(energy[i] + 1e-9);
    out[i] = Math.max(0, cur - prev);
    prev = cur;
  }
  return out;
}

/**
 * Tempo (60–200 BPM, gently preferring ~120) and beat times in seconds from an onset envelope.
 * Returns null when there is no clear pulse (speech, ambience, silence).
 */
export function estimateBeats(onset: Float32Array, hop: number, duration: number): BeatGrid | null {
  const n = onset.length;
  let mean = 0;
  for (const v of onset) mean += v;
  mean /= Math.max(1, n);
  if (n < 4 / hop || mean < 1e-4) return null;
  const x = onset.map((v) => v - mean);
  const ac = (lag: number) => {
    const l0 = Math.floor(lag), fr = lag - l0;
    let s = 0;
    for (let i = 0; i + l0 + 1 < n; i++) s += x[i] * (x[i + l0] * (1 - fr) + x[i + l0 + 1] * fr);
    return s / (n - l0);
  };
  let energy = 0;
  for (const v of x) energy += v * v;
  energy /= n;
  let bestBpm = 0, bestScore = -Infinity, bestRaw = 0;
  for (let bpm = 60; bpm <= 200; bpm += 0.5) {
    const raw = ac(60 / bpm / hop) + 0.5 * ac(120 / bpm / hop); // reward periodicity at the beat and the bar-half
    const prior = Math.exp(-0.5 * (Math.log2(bpm / 120) / 0.9) ** 2);
    if (raw * prior > bestScore) { bestScore = raw * prior; bestBpm = bpm; bestRaw = raw; }
  }
  if (bestRaw < energy * 0.15) return null;
  const period = 60 / bestBpm;
  let bestPhase = 0, bestPhaseScore = -Infinity;
  for (let phase = 0; phase < period; phase += hop) {
    let s = 0;
    for (let t = phase; t < duration; t += period) {
      const i = Math.round(t / hop);
      if (i < n) s += Math.max(onset[i], i > 0 ? onset[i - 1] : 0, i + 1 < n ? onset[i + 1] : 0);
    }
    if (s > bestPhaseScore) { bestPhaseScore = s; bestPhase = phase; }
  }
  const times: number[] = [];
  for (let t = bestPhase; t < duration; t += period) times.push(Math.round(t * 1000) / 1000);
  return { bpm: Math.round(bestBpm * 10) / 10, times };
}
