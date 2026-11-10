import { describe, expect, it } from 'vitest';
import { BT709_AS_601, decodedAs709, pixelsAs601, pixelsToSdr } from './hdr';

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

describe('a BT.601 video decoded with the BT.709 matrix (audit V-243)', () => {
  const fix = (r: number, g: number, b: number) => { const d = new Uint8ClampedArray([r, g, b, 255]); pixelsAs601(d); return [...d]; };
  it('brings the colours back to what ffmpeg decodes from the file', () => {
    // WebKit's output for the bands of fixtures/bt601.mp4 (by ffmpeg's BT.709 decode) → ffmpeg's BT.601 decode.
    for (const [seen, truth] of [[[223, 49, 30], [208, 32, 33]], [[21, 154, 60], [32, 175, 63]], [[29, 69, 214], [33, 64, 208]], [[229, 163, 126], [223, 160, 127]]]) {
      fix(seen[0], seen[1], seen[2]).slice(0, 3).forEach((v, i) => expect(Math.abs(v - truth[i]), `${seen} → ${truth}`).toBeLessThanOrEqual(2));
    }
  });
  it('leaves greys, black, white and alpha alone', () => {
    for (const v of [0, 128, 255]) expect(fix(v, v, v)).toEqual([v, v, v, 255]);
  });
  it('the rows add up to 1, so neutral stays neutral', () => {
    for (let r = 0; r < 3; r++) expect(BT709_AS_601[r * 3] + BT709_AS_601[r * 3 + 1] + BT709_AS_601[r * 3 + 2]).toBeCloseTo(1, 3);
  });
  it('corrects only a frame labelled bt709 from a track that says BT.601', () => {
    expect(decodedAs709(true, 'bt709')).toBe(true);
    expect(decodedAs709(true, 'smpte170m')).toBe(false); // Chromium keeps the label: nothing to do
    expect(decodedAs709(false, 'bt709')).toBe(false);
    expect(decodedAs709(true, null)).toBe(false);
  });
});
