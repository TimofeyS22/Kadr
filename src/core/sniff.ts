// What a file is by its first bytes, not by its name (docs/11 §3.6). Messengers and "Save to Files" drop or change
// extensions, and a browser types a file by its name only: a photo saved without an extension has no type, a video
// renamed to .jpg is "image/jpeg". `null`: not recognised, the type and the name decide as before.

/** Enough bytes from the start of a file for `sniffMime`. */
export const SNIFF_BYTES = 16;

const HEIF_BRANDS = ['heic', 'heix', 'heim', 'heis', 'hevc', 'hevx', 'mif1', 'mif2', 'msf1'];

export function sniffMime(b: Uint8Array): string | null {
  const ascii = (at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') return 'image/png';
  if (ascii(0, 4) === 'GIF8') return 'image/gif';
  if (ascii(0, 4) === 'RIFF') {
    const form = ascii(8, 4);
    return form === 'WEBP' ? 'image/webp' : form === 'WAVE' ? 'audio/wav' : form === 'AVI ' ? 'video/x-msvideo' : null;
  }
  if (ascii(4, 4) === 'ftyp') {
    const brand = ascii(8, 4);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    if (HEIF_BRANDS.includes(brand)) return 'image/heic';
    return brand === 'qt  ' ? 'video/quicktime' : brand.startsWith('M4A') ? 'audio/mp4' : 'video/mp4';
  }
  if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
  if (ascii(0, 4) === 'OggS') return 'audio/ogg';
  if (ascii(0, 4) === 'fLaC') return 'audio/flac';
  if (ascii(0, 3) === 'ID3') return 'audio/mpeg';
  if (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) return (b[1] & 0xf6) === 0xf0 ? 'audio/aac' : 'audio/mpeg'; // a frame sync
  return null;
}
