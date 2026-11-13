// The level of speech for the speech models (docs/20 ADR-С7).
//
// A recording made far from the speaker is quiet, and quiet speech is read worse: on the live sample turned down by
// 26 dB FastConformer went from 7.9% of words wrong to 13.9%, GigaAM from 7.3% to 7.9% (2026-11-13). The speech
// detector hears quiet speech as less likely to be speech, and the models' features sink towards their floor.
// So a quiet recording is lifted, as a whole, before speech is looked for in it. A recording at a normal level is
// left exactly as it was, sample for sample: what was measured before stays measured.
//
// Tried the same day and NOT here, both measured on the live samples:
// - bringing every stretch of speech to one level (RMS −22 dBFS) before the model: FastConformer got worse at a
//   normal level (7.9 → 8.5%, under music 43.6 → 44.8% and 15.6 → 18.2%);
// - a real low-pass before 48 → 16 kHz (windowed sinc, 95 taps, −70 dB from 9 kHz) in place of the mean of three
//   samples: nothing changed for FastConformer, one word for GigaAM (7.3 → 6.7%), which is the noise of the measure.

/** RMS of 50 ms frames, the loud ones: the 90th percentile. Speech, not the pauses between it. */
function loudLevel(audio: Float32Array, sr: number): number {
  const hop = Math.max(1, Math.round(sr * 0.05));
  const levels: number[] = [];
  for (let i = 0; i + hop <= audio.length; i += hop) {
    let e = 0;
    for (let k = i; k < i + hop; k++) e += audio[k] * audio[k];
    levels.push(Math.sqrt(e / hop));
  }
  if (!levels.length) return 0;
  levels.sort((x, y) => x - y);
  return levels[Math.min(levels.length - 1, Math.floor(levels.length * 0.9))];
}

/**
 * The gain that lifts a quiet recording before speech is looked for in it: its loud moments to −20 dBFS. Only up
 * (1 for a recording at a normal level), never more than ×16 (+24 dB: room noise is not made into speech) and
 * never into clipping. 1 for silence.
 */
export function liftGain(audio: Float32Array, sr: number): number {
  let peak = 0;
  for (let i = 0; i < audio.length; i++) { const a = audio[i] < 0 ? -audio[i] : audio[i]; if (a > peak) peak = a; }
  const loud = loudLevel(audio, sr);
  if (loud < 1e-5 || peak < 1e-4) return 1;
  return Math.max(1, Math.min(0.1 / loud, 16, 0.98 / peak));
}
