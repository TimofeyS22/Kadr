import { describe, expect, it } from 'vitest';
import { fitFades } from './timeline';

describe('fitFades (fades as they sound)', () => {
  it('keeps fades that fit the clip as they are', () => {
    expect(fitFades(6, 3, 3)).toEqual([3, 3]);
    expect(fitFades(4, 1, 0)).toEqual([1, 0]);
    expect(fitFades(1, 0.8, 0)).toEqual([0.8, 0]); // a crossfade on a short clip is not cut
  });

  it('shares the length of a clip trimmed shorter than its fades, in proportion', () => {
    expect(fitFades(1, 3, 3)).toEqual([0.5, 0.5]);
    const [a, b] = fitFades(2, 3, 1);
    expect(a).toBeCloseTo(1.5);
    expect(b).toBeCloseTo(0.5);
    expect(fitFades(0, 1, 1)).toEqual([0, 0]);
  });

  it('leaves the middle of a trimmed clip at full level (the envelope peaks at 1)', () => {
    const [fi, fo] = fitFades(1, 3, 3);
    const gain = (t: number) => Math.min(1, t / fi) * Math.min(1, (1 - t) / fo);
    expect(gain(0.5)).toBeCloseTo(1);
  });
});
