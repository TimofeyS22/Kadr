// The ruler of the timeline (DESIGN.md §5): which seconds carry a number and which get a short tick, for a given zoom.
// A number every `step` seconds, where `step` is the first round interval that leaves at least `minGapPx` between two
// numbers (the same rule the timeline of v1.7.1 uses); short ticks between them only where they stay apart.

const STEPS = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
const MIN_TICK_GAP_PX = 8;

export function rulerStep(pxPerSecond: number, minGapPx = 64): number {
  return STEPS.find((s) => s * pxPerSecond >= minGapPx) ?? STEPS[STEPS.length - 1];
}

/** Marks from 0 to `duration`: `major` carries a number. */
export function rulerMarks(duration: number, pxPerSecond: number, minGapPx = 64): { at: number; major: boolean }[] {
  if (!(duration >= 0) || !(pxPerSecond > 0)) return [];
  const step = rulerStep(pxPerSecond, minGapPx);
  const parts = step === 0.5 ? 1 : step % 5 === 0 ? 5 : 2;
  const minor = step / parts;
  const showMinor = minor * pxPerSecond >= MIN_TICK_GAP_PX && parts > 1;
  const out: { at: number; major: boolean }[] = [];
  const n = Math.floor(duration / step + 1e-9);
  for (let i = 0; i <= n; i++) {
    out.push({ at: Math.round(i * step * 1000) / 1000, major: true });
    if (!showMinor) continue;
    for (let j = 1; j < parts; j++) {
      const at = Math.round((i * step + j * minor) * 1000) / 1000;
      if (at <= duration + 1e-9) out.push({ at, major: false });
    }
  }
  return out;
}
