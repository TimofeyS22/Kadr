import { describe, expect, it } from 'vitest';
import { rulerMarks, rulerStep } from './ruler';

describe('the ruler of the timeline', () => {
  it('numbers stand at least 64 px apart, on a round interval', () => {
    expect(rulerStep(45)).toBe(2); // 90 px between numbers
    expect(rulerStep(64)).toBe(1);
    expect(rulerStep(200)).toBe(0.5);
    expect(rulerStep(10)).toBe(10);
    expect(rulerStep(0.01)).toBe(600);
    for (const pps of [3, 7, 13, 31, 45, 90, 400]) expect(rulerStep(pps) * pps).toBeGreaterThanOrEqual(64);
  });

  it('marks run from zero to the end, short ticks only where they stay apart', () => {
    const m = rulerMarks(12, 45);
    expect(m.filter((x) => x.major).map((x) => x.at)).toEqual([0, 2, 4, 6, 8, 10, 12]);
    expect(m.filter((x) => !x.major).map((x) => x.at)).toEqual([1, 3, 5, 7, 9, 11]);
    // At 10 s per number a short tick every 2 s: 13 px apart at 6.5 px/s.
    const far = rulerMarks(60, 6.5);
    expect(far.filter((x) => x.major).map((x) => x.at)).toEqual([0, 10, 20, 30, 40, 50, 60]);
    expect(far.filter((x) => !x.major).length).toBe(24);
    // An hour on a phone screen: ten minutes per number, short ticks would sit 6 px apart, so there are none.
    const whole = rulerMarks(3600, 0.05);
    expect(whole.length).toBe(7);
    expect(whole.every((x) => x.major)).toBe(true);
  });

  it('nothing for a broken input', () => {
    expect(rulerMarks(NaN, 45)).toEqual([]);
    expect(rulerMarks(10, 0)).toEqual([]);
    expect(rulerMarks(0, 45)).toEqual([{ at: 0, major: true }]);
  });
});
