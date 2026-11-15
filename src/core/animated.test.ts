// A picture that moves comes in as one frame, and the person is told (V-227): GIF, animated WebP and APNG alike.
import { describe, expect, it } from 'vitest';
import { animatedImage } from './sniff';

const bytes = (...parts: (number[] | string)[]) => Uint8Array.from(parts.flatMap((p) => (typeof p === 'string' ? [...p].map((c) => c.charCodeAt(0)) : p)));
const u32be = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255];

/** A GIF of `frames` 1×1 images, with no global colour table. */
const gif = (frames: number) => bytes('GIF89a', [1, 0, 1, 0, 0, 0, 0],
  ...Array.from({ length: frames }, () => [0x21, 0xf9, 4, 0, 10, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x4c, 0x01, 0]), [0x3b]);
/** A WebP whose VP8X header has the animation flag set or not. */
const webp = (animated: boolean) => bytes('RIFF', [0, 0, 0, 0], 'WEBPVP8X', [10, 0, 0, 0, animated ? 0x02 : 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
const chunk = (type: string, data: number[] = []) => [...u32be(data.length), ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
/** A PNG with or without the APNG animation control chunk before its picture. */
const png = (animated: boolean) => bytes([0x89], 'PNG', [13, 10, 26, 10], chunk('IHDR', Array(13).fill(0)), ...(animated ? [chunk('acTL', [0, 0, 0, 2, 0, 0, 0, 0])] : []), chunk('IDAT', [0]), chunk('IEND'));

describe('a picture that moves (V-227)', () => {
  it('a GIF of two frames moves, one of a single frame does not', () => {
    expect(animatedImage(gif(2))).toBe(true);
    expect(animatedImage(gif(1))).toBe(false);
  });
  it('a WebP moves when its header says so', () => {
    expect(animatedImage(webp(true))).toBe(true);
    expect(animatedImage(webp(false))).toBe(false);
  });
  it('a PNG moves when it is an APNG', () => {
    expect(animatedImage(png(true))).toBe(true);
    expect(animatedImage(png(false))).toBe(false);
  });
  it('anything else, or too few bytes, does not', () => {
    expect(animatedImage(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe(false);
    expect(animatedImage(new Uint8Array())).toBe(false);
  });
});
