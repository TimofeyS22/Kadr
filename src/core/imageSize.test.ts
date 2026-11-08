import { describe, expect, it } from 'vitest';
import { imageSize } from './imageSize';

const bytes = (...x: (number | string)[]) => new Uint8Array(x.flatMap((v) => (typeof v === 'string' ? [...v].map((c) => c.charCodeAt(0)) : [v])));

describe('picture size from the header (audit V-127)', () => {
  it('PNG', () => {
    const b = bytes(0x89, 'PNG', 13, 10, 26, 10, 0, 0, 0, 13, 'IHDR', 0, 0, 0x4e, 0x20, 0, 0, 0x27, 0x10, 8, 6, 0, 0, 0);
    expect(imageSize(b)).toEqual({ width: 20000, height: 10000 });
  });
  it('JPEG, past its other segments', () => {
    const b = bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 1, 2, 0xff, 0xc0, 0, 17, 8, 0x0b, 0xb8, 0x0f, 0xa0, 3, 1, 2, 3);
    expect(imageSize(b)).toEqual({ width: 4000, height: 3000 });
  });
  it('GIF', () => { expect(imageSize(bytes('GIF89a', 0x40, 1, 0xf0, 0))).toEqual({ width: 320, height: 240 }); });
  it('anything else is not judged', () => { expect(imageSize(bytes('not a picture at all', 0, 0, 0, 0, 0, 0, 0, 0, 0, 0))).toBeNull(); });
});
