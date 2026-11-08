// The size of a picture from its first bytes, before anything decodes it (audit V-127): a file under a megabyte can
// declare 200 megapixels, and decoding it takes the tab down.

const be16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const be32 = (b: Uint8Array, i: number) => ((b[i] * 2 ** 24) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3]);
const le16 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const le24 = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const tag = (b: Uint8Array, i: number, s: string) => [...s].every((c, k) => b[i + k] === c.charCodeAt(0));

/** Width and height declared by a PNG, JPEG, GIF or WebP header; null for anything else or a header cut short. */
export function imageSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length >= 24 && tag(b, 1, 'PNG') && tag(b, 12, 'IHDR')) return { width: be32(b, 16), height: be32(b, 20) };
  if (b.length >= 10 && tag(b, 0, 'GIF8')) return { width: le16(b, 6), height: le16(b, 8) };
  if (b.length >= 30 && tag(b, 0, 'RIFF') && tag(b, 8, 'WEBP')) {
    if (tag(b, 12, 'VP8X')) return { width: 1 + le24(b, 24), height: 1 + le24(b, 27) };
    if (tag(b, 12, 'VP8 ')) return { width: le16(b, 26) & 0x3fff, height: le16(b, 28) & 0x3fff };
    if (tag(b, 12, 'VP8L')) { const v = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24); return { width: (v & 0x3fff) + 1, height: ((v >> 14) & 0x3fff) + 1 }; }
    return null;
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; }
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { width: be16(b, i + 7), height: be16(b, i + 5) };
      i += 2 + be16(b, i + 2);
    }
  }
  return null;
}
