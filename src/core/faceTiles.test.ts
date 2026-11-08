import { describe, expect, it } from 'vitest';
import { mergeBoxes, tileStarts } from './faceTiles';

describe('face tiles (audit V-221)', () => {
  it('tiles cover the side, overlap by about half and end at its edge', () => {
    const s = tileStarts(1280, 540);
    expect(s[0]).toBe(0);
    expect(s[s.length - 1] + 540).toBe(1280);
    for (let i = 1; i < s.length; i++) expect(s[i] - s[i - 1]).toBeLessThanOrEqual(270);
    expect(tileStarts(400, 540)).toEqual([0]);
  });

  it('a face found twice (whole frame and a tile) is one box covering both', () => {
    const m = mergeBoxes([{ x: 0.1, y: 0.1, w: 0.1, h: 0.1 }, { x: 0.12, y: 0.11, w: 0.1, h: 0.1 }, { x: 0.6, y: 0.6, w: 0.05, h: 0.05 }]);
    expect(m).toHaveLength(2);
    expect(m[0].x).toBeCloseTo(0.1);
    expect(m[0].x + m[0].w).toBeCloseTo(0.22);
  });
});
