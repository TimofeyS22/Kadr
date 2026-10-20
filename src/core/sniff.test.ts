import { describe, expect, it } from 'vitest';
import { sniffMime } from './sniff';

const bytes = (...parts: (string | number[])[]) => {
  const out: number[] = [];
  for (const p of parts) out.push(...(typeof p === 'string' ? Array.from(p, (c) => c.charCodeAt(0)) : p));
  while (out.length < 16) out.push(0);
  return Uint8Array.from(out);
};
const box = (brand: string) => bytes([0, 0, 0, 0x20], 'ftyp', brand, [0, 0, 0, 0]);

describe('sniffMime (a file is what its bytes say, not its name)', () => {
  it('recognises photos', () => {
    expect(sniffMime(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffMime(bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffMime(bytes('GIF89a'))).toBe('image/gif');
    expect(sniffMime(bytes('RIFF', [1, 2, 3, 4], 'WEBPVP8 '))).toBe('image/webp');
    expect(sniffMime(box('heic'))).toBe('image/heic');
    expect(sniffMime(box('mif1'))).toBe('image/heic');
    expect(sniffMime(box('avif'))).toBe('image/avif');
  });

  it('recognises video and sound, including an iPhone .mov and an .m4a', () => {
    expect(sniffMime(box('isom'))).toBe('video/mp4');
    expect(sniffMime(box('mp42'))).toBe('video/mp4');
    expect(sniffMime(box('qt  '))).toBe('video/quicktime');
    expect(sniffMime(box('M4A '))).toBe('audio/mp4');
    expect(sniffMime(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('video/webm');
    expect(sniffMime(bytes('RIFF', [1, 2, 3, 4], 'WAVEfmt '))).toBe('audio/wav');
    expect(sniffMime(bytes('OggS'))).toBe('audio/ogg');
    expect(sniffMime(bytes('ID3', [4]))).toBe('audio/mpeg');
    expect(sniffMime(bytes([0xff, 0xfb, 0x90]))).toBe('audio/mpeg');
    expect(sniffMime(bytes([0xff, 0xf1, 0x50]))).toBe('audio/aac');
  });

  it('says nothing about text, random bytes or a file too short to tell', () => {
    expect(sniffMime(bytes('hello, this is not media'))).toBeNull();
    expect(sniffMime(bytes('RIFF', [1, 2, 3, 4], 'XXXX'))).toBeNull();
    expect(sniffMime(Uint8Array.from([0xff, 0xd8, 0xff]))).toBeNull();
    expect(sniffMime(new Uint8Array(0))).toBeNull();
  });
});
