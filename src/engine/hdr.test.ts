import { describe, expect, it } from 'vitest';
import { pixelsToSdr } from './hdr';

// HLG signal for a neutral grey of the given SDR linear light (1.0 = 203 nits), as scripts/make-hdr-frame.py writes it.
const hlgGrey = (l: number) => {
  const d = l * 0.203, e = d / d ** (0.2 / 1.2);
  return Math.round(255 * (e <= 1 / 12 ? Math.sqrt(3 * e) : 0.17883277 * Math.log(12 * e - 0.28466892) + 0.55991073));
};
const pqGrey = (l: number) => {
  const y = ((l * 203) / 10000) ** 0.1593017578125;
  return Math.round(255 * ((0.8359375 + 18.8515625 * y) / (1 + 18.6875 * y)) ** 78.84375);
};
const run = (v: number, hdr: 'hlg' | 'pq') => { const d = new Uint8ClampedArray([v, v, v, 255]); pixelsToSdr(d, hdr); return [...d]; };

describe('HDR thumbnails', () => {
  it.each([['hlg', hlgGrey], ['pq', pqGrey]] as const)('%s: mid grey stays mid grey, white stays bright, alpha stays', (hdr, grey) => {
    const mid = run(grey(0.2158), hdr); // 128 in sRGB
    expect(Math.abs(mid[0] - 128)).toBeLessThanOrEqual(5);
    expect(mid[0]).toBe(mid[1]);
    expect(mid[3]).toBe(255);
    expect(run(grey(1), hdr)[0]).toBeGreaterThan(240);
  });
  it('highlights roll off instead of clipping everything at one value', () => {
    expect(run(255, 'hlg')[0]).toBeGreaterThanOrEqual(run(220, 'hlg')[0]);
    expect(run(220, 'hlg')[0]).toBeLessThanOrEqual(255);
  });
});
