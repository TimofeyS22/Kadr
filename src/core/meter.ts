// Recording level meter ballistics (docs/09 Q5): the peak is held for a moment so the eye can read it, and a sample at
// full scale lights a clip mark that stays on long enough to be noticed. Pure: the recorder feeds peaks, the UI draws.

/** A sample at or above this is clipping (≈ −0.2 dBFS). */
export const CLIP_LEVEL = 0.98;
const HOLD_MS = 1000;
const CLIP_MS = 1500;

export interface MeterState { hold: number; holdAt: number; clipUntil: number }
export const METER_IDLE: MeterState = { hold: 0, holdAt: 0, clipUntil: 0 };

/** Next meter state after a block whose peak is `peak` (0..1) at time `now` (ms); `clip` says whether to show the mark. */
export function meterStep(s: MeterState, peak: number, now: number): MeterState & { clip: boolean } {
  let { hold, holdAt, clipUntil } = s;
  if (peak >= hold || now - holdAt > HOLD_MS) { hold = peak; holdAt = now; }
  if (peak >= CLIP_LEVEL) clipUntil = now + CLIP_MS;
  return { hold, holdAt, clipUntil, clip: now < clipUntil };
}
