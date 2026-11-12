import { describe, expect, it } from 'vitest';
import { dragTo, keyTo, labelsFor, offsetPx, quantize, segment, specFor, specProblems, tapTo, ticks, type ScaleSpec } from './scale';

const colour: ScaleSpec = { min: -100, max: 100, rest: 0, step: 1, hold: 4, pxPerUnit: 2, minor: 5, major: 25 };
const speed: ScaleSpec = { min: 25, max: 400, rest: 100, step: 5, hold: 8, pxPerUnit: 1, minor: 25, major: 100 };

describe('the Scale: the maths of one strip for any number', () => {
  it('quantize keeps a value on its steps and inside the range', () => {
    expect(quantize(colour, 12.4)).toBe(12);
    expect(quantize(colour, 250)).toBe(100);
    expect(quantize(colour, -250)).toBe(-100);
    expect(quantize(speed, 163)).toBe(165);
    expect(quantize({ ...colour, step: 0.1 }, 0.30000000000000004)).toBe(0.3);
  });

  it('dragging left raises the value, dragging right lowers it', () => {
    expect(dragTo(colour, 40, -20).value).toBe(50);
    expect(dragTo(colour, 40, 20).value).toBe(30);
    expect(dragTo(speed, 200, -60).value).toBe(260);
  });

  it('the strip holds at the value it was, and then goes on from it', () => {
    // From +20 towards zero: 40 px bring it to zero, the next 8 px (4 units) change nothing.
    expect(dragTo(colour, 20, 38)).toEqual({ value: 1, held: false });
    expect(dragTo(colour, 20, 40)).toEqual({ value: 0, held: true });
    expect(dragTo(colour, 20, 48)).toEqual({ value: 0, held: true });
    expect(dragTo(colour, 20, 50)).toEqual({ value: -1, held: false });
    // Starting on the mark itself: the hold is spent first, in either direction.
    expect(dragTo(colour, 0, -8)).toEqual({ value: 0, held: true });
    expect(dragTo(colour, 0, -10)).toEqual({ value: 1, held: false });
    expect(dragTo(colour, 0, 10)).toEqual({ value: -1, held: false });
  });

  it('nothing next to the mark is out of reach: every step can be dragged to', () => {
    // A detent that swallows the values around zero would take ±1 … ±4 away from the finger (they are there today).
    const reached = new Set<number>();
    for (let dx = -60; dx <= 60; dx++) reached.add(dragTo(colour, 0, dx).value);
    for (let v = -20; v <= 20; v++) expect(reached.has(v), `value ${v}`).toBe(true);
    const fromAfar = new Set<number>();
    for (let dx = 0; dx <= 120; dx++) fromAfar.add(dragTo(colour, 30, dx).value);
    for (let v = -20; v <= 30; v++) expect(fromAfar.has(v), `value ${v} from +30`).toBe(true);
  });

  it('a drag never leaves the range', () => {
    expect(dragTo(colour, 90, -500).value).toBe(100);
    expect(dragTo(colour, -90, 500).value).toBe(-100);
  });

  it('a tap brings the tick under the finger to the needle', () => {
    expect(tapTo(colour, 10, 40)).toBe(30);
    expect(tapTo(colour, 10, -40)).toBe(-10);
    expect(tapTo(speed, 100, 500)).toBe(400);
  });

  it('the keyboard moves by a step, by a long tick and to the ends', () => {
    expect(keyTo(colour, 10, 'ArrowRight')).toBe(11);
    expect(keyTo(colour, 10, 'ArrowDown')).toBe(9);
    expect(keyTo(colour, 10, 'PageUp')).toBe(35);
    expect(keyTo(colour, 90, 'PageUp')).toBe(100);
    expect(keyTo(speed, 100, 'ArrowLeft')).toBe(95);
    expect(keyTo(colour, 10, 'Home')).toBe(-100);
    expect(keyTo(colour, 10, 'End')).toBe(100);
    expect(keyTo(colour, 10, 'a')).toBeNull();
  });

  it('ticks run from end to end, long ones on the long step', () => {
    const t = ticks(colour);
    expect(t.length).toBe(41);
    expect(t[0]).toEqual({ at: -100, major: true });
    expect(t.filter((x) => x.major).map((x) => x.at)).toEqual([-100, -75, -50, -25, 0, 25, 50, 75, 100]);
    expect(ticks(speed).filter((x) => x.major).map((x) => x.at)).toEqual([100, 200, 300, 400]);
  });

  it('a wrong spec is named, and never hangs the drawing', () => {
    expect(specProblems(colour)).toEqual([]);
    expect(specProblems(speed)).toEqual([]);
    expect(specProblems({ ...colour, rest: 0.5 })).toEqual(['rest is not on a step']);
    expect(specProblems({ ...colour, rest: 300 })).toEqual(['rest is outside the range']);
    expect(specProblems({ ...speed, min: 23 })).toEqual(['an end of the range is not on a step']);
    expect(specProblems({ ...colour, minor: 0 })).toEqual(['a tick step is not positive']);
    expect(ticks({ ...colour, minor: 0 })).toEqual([]);
  });

  it('the segment lies between what was and what is, whichever is greater', () => {
    expect(offsetPx(colour, 0)).toBe(200);
    expect(segment(colour, 35)).toEqual({ left: 200, width: 70 });
    expect(segment(colour, -35)).toEqual({ left: 130, width: 70 });
    expect(segment(colour, 0)).toEqual({ left: 200, width: 0 });
  });
});

describe('specFor: a slider of a sheet as a Scale', () => {
  // The values the sheets set (Ч4: values on the Scale): volume, a share, rotation, the speed's position, a fade, a
  // crop's width cut by its left edge, a silence level in dB.
  const cases = [
    { min: 0, max: 2, step: 0.01, rest: 1 },
    { min: 0, max: 1, step: 0.01, rest: 0.8 },
    { min: -180, max: 180, step: 1, rest: 0 },
    { min: 0, max: 1, step: 0.001, rest: Math.log(10) / Math.log(100) },
    { min: 0, max: 2.73, step: 0.05, rest: 0 },
    { min: 0.05, max: 1 - 0.137, step: 0.01, rest: 1 - 0.137 },
    { min: -60, max: -20, step: 1, rest: -35 },
    { min: 0.05, max: 4, step: 0.01, rest: 1 },
  ];
  for (const c of cases) {
    it(`${c.min}…${c.max} by ${c.step}`, () => {
      const s = specFor(c);
      expect(specProblems(s)).toEqual([]);
      expect(s.min).toBeGreaterThanOrEqual(c.min - 1e-9);
      expect(s.max).toBeLessThanOrEqual(c.max + 1e-9);
      expect(s.max - s.min).toBeGreaterThan((c.max - c.min) - 2 * c.step); // nothing of the range lost but a part of a step
      const length = (s.max - s.min) * s.pxPerUnit;
      expect(length).toBeGreaterThanOrEqual(359.9);
      expect(length).toBeLessThanOrEqual(960.1);
      expect(s.major * s.pxPerUnit, 'numbers at least 64 px apart').toBeGreaterThanOrEqual(64);
      expect(s.major * s.pxPerUnit, 'and not much further: the strip says where the value goes').toBeLessThanOrEqual(64 * 2.5 + 1e-6);
      expect(Math.abs(s.major / s.minor - Math.round(s.major / s.minor)), 'a long tick is on a short one').toBeLessThan(1e-6);
      expect(s.hold * s.pxPerUnit).toBeCloseTo(10, 2);
      expect(labelsFor(s).length, 'some numbers to read').toBeGreaterThanOrEqual(2);
    });
  }
  it('a value right at the rest holds, and every value of the range is reached', () => {
    const s = specFor({ min: 0, max: 2, step: 0.01, rest: 1 });
    expect(dragTo(s, 1, -5).held).toBe(true);
    expect(dragTo(s, 1, -(s.hold * s.pxPerUnit) - s.pxPerUnit * 0.01).value).toBeCloseTo(1.01, 6);
  });
});
