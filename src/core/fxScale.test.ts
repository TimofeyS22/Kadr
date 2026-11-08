import { describe, expect, it } from 'vitest';
import { fxLod, fxScale } from './fxScale';

describe('effects are a share of the picture (audit V-145)', () => {
  it('the blur radius is the same share at preview, 1080p and 4K', () => {
    const share = (m: number) => 2 ** fxLod(0.5, m) / m;
    expect(share(1920)).toBeCloseTo(share(1280), 6);
    expect(share(3840)).toBeCloseTo(share(1280), 6);
  });
  it('no blur at zero', () => { expect(fxLod(0, 3840)).toBe(0); });
  it('a block of the reference covers proportionally more texels of a bigger picture', () => {
    expect(fxScale(3840)).toBe(3);
    expect(fxScale(1280)).toBe(1);
  });
});
