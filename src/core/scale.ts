// The Scale (DESIGN.md §1): one strip at the bottom of the screen sets any number. A white mark stands on the value it
// was (`rest`), the signal mark on the value it is now, and the whole strip is dragged under a fixed needle. This file is
// the maths of it, without the DOM: where a drag, a tap or a key takes the value, and what to draw.

export interface ScaleSpec {
  min: number;
  max: number;
  /** The value before the person touched it: where the white mark stands and where the strip holds for a moment. */
  rest: number;
  step: number;
  /** How far, in units, the finger travels on while the strip holds at `rest`. Nothing becomes unreachable: the travel
   *  is taken out of the way, not out of the range. */
  hold: number;
  pxPerUnit: number;
  /** Ticks: a short one every `minor` units, a long one every `major`. */
  minor: number;
  major: number;
}

const round = (v: number) => Math.round(v * 1e6) / 1e6 + 0; // + 0: never a negative zero

/** Onto the grid of steps and into the range. */
export function quantize(spec: ScaleSpec, v: number): number {
  const stepped = Math.round(v / spec.step) * spec.step;
  return round(Math.min(spec.max, Math.max(spec.min, stepped)));
}

/**
 * Where a drag of `dxPx` takes the value that was `from` when the finger came down. The strip moves with the finger and
 * the needle stands still, so dragging left raises the value. On the way through `rest` the strip holds: the next
 * `hold` units of travel change nothing, then the value goes on from `rest`.
 */
export function dragTo(spec: ScaleSpec, from: number, dxPx: number): { value: number; held: boolean } {
  const raw = from - dxPx / spec.pxPerUnit;
  const side = Math.sign(from - spec.rest);
  const passed = side === 0 ? Math.abs(raw - spec.rest) : (spec.rest - raw) * side;
  if (side !== 0 && passed < 0) return { value: quantize(spec, raw), held: false }; // has not reached `rest` yet
  if (passed <= spec.hold) return { value: quantize(spec, spec.rest), held: true };
  const direction = side === 0 ? Math.sign(raw - spec.rest) : -side;
  return { value: quantize(spec, spec.rest + direction * (passed - spec.hold)), held: false };
}

/** A tap on the strip `offsetPx` to the right of the needle (negative: to the left) brings that tick under the needle. */
export function tapTo(spec: ScaleSpec, value: number, offsetPx: number): number {
  return quantize(spec, value + offsetPx / spec.pxPerUnit);
}

/** The keyboard, as for any slider: arrows by a step, Page Up and Page Down by a long tick, Home and End to the ends. */
export function keyTo(spec: ScaleSpec, value: number, key: string): number | null {
  switch (key) {
    case 'ArrowRight': case 'ArrowUp': return quantize(spec, value + spec.step);
    case 'ArrowLeft': case 'ArrowDown': return quantize(spec, value - spec.step);
    case 'PageUp': return quantize(spec, value + spec.major);
    case 'PageDown': return quantize(spec, value - spec.major);
    case 'Home': return spec.min;
    case 'End': return spec.max;
    default: return null;
  }
}

/** How far a value stands from the start of the strip, in px. */
export const offsetPx = (spec: ScaleSpec, v: number) => round((v - spec.min) * spec.pxPerUnit);

/** Ticks from `min` to `max`. */
export function ticks(spec: ScaleSpec): { at: number; major: boolean }[] {
  const out: { at: number; major: boolean }[] = [];
  if (!(spec.minor > 0) || !(spec.major > 0)) return out;
  const first = Math.ceil(spec.min / spec.minor) * spec.minor;
  for (let v = first; v <= spec.max + 1e-9; v += spec.minor) {
    const at = round(v);
    out.push({ at, major: Math.abs(at / spec.major - Math.round(at / spec.major)) < 1e-6 });
  }
  return out;
}

/** The stretch between the mark of what was and the mark of what is, in px from the start of the strip. */
export function segment(spec: ScaleSpec, value: number): { left: number; width: number } {
  return { left: offsetPx(spec, Math.min(value, spec.rest)), width: round(Math.abs(value - spec.rest) * spec.pxPerUnit) };
}

/** What is wrong with a spec, in words; empty when it is sound. A Scale built on a wrong one misleads quietly: «Сбросить»
 *  that never goes grey, a mark between two steps. Checked by the unit tests of every screen that defines one. */
export function specProblems(spec: ScaleSpec): string[] {
  const out: string[] = [];
  const onStep = (v: number) => Math.abs(v / spec.step - Math.round(v / spec.step)) < 1e-6;
  if (!(spec.min < spec.max)) out.push('min is not below max');
  if (!(spec.step > 0)) out.push('step is not positive');
  else {
    if (!onStep(spec.min) || !onStep(spec.max)) out.push('an end of the range is not on a step');
    if (!onStep(spec.rest)) out.push('rest is not on a step');
  }
  if (spec.rest < spec.min || spec.rest > spec.max) out.push('rest is outside the range');
  if (!(spec.pxPerUnit > 0)) out.push('pxPerUnit is not positive');
  if (!(spec.minor > 0) || !(spec.major > 0)) out.push('a tick step is not positive');
  if (spec.hold < 0) out.push('hold is negative');
  return out;
}
