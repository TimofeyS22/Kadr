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

/**
 * Does this picture move (V-227)? Kadr takes a picture as its first frame, so the person is told. A GIF moves when it
 * holds more than one image, a WebP when its VP8X header says so, a PNG when it has an animation chunk before its
 * picture (APNG). `b` is the start of the file: an image past it is not seen.
 */
export function animatedImage(b: Uint8Array): boolean {
  const ascii = (at: number, len: number) => String.fromCharCode(...b.subarray(at, at + len));
  if (b.length < 12) return false;
  if (ascii(0, 4) === 'GIF8') return gifFrames(b) > 1;
  if (ascii(0, 4) === 'RIFF' && ascii(8, 8) === 'WEBPVP8X') return b.length > 20 && (b[20] & 0x02) !== 0;
  if (b[0] === 0x89 && ascii(1, 3) === 'PNG') {
    for (let at = 8; at + 8 <= b.length;) {
      const len = ((b[at] << 24) | (b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]) >>> 0;
      const type = ascii(at + 4, 4);
      if (type === 'acTL') return true;
      if (type === 'IDAT' || type === 'IEND') return false;
      at += 12 + len;
    }
  }
  return false;
}

/** The images of a GIF, counted by walking its blocks (up to two: that is enough to say it moves). */
function gifFrames(b: Uint8Array): number {
  let at = 13, frames = 0;
  if (b[10] & 0x80) at += 3 * 2 ** ((b[10] & 7) + 1); // the global colour table
  const skipBlocks = () => { while (at < b.length && b[at] !== 0) at += b[at] + 1; at++; };
  while (at < b.length && frames < 2) {
    const kind = b[at];
    if (kind === 0x21) { at += 2; skipBlocks(); } // an extension: its label, then data blocks
    else if (kind === 0x2c) {
      frames++;
      const packed = b[at + 9];
      at += 10;
      if (packed & 0x80) at += 3 * 2 ** ((packed & 7) + 1); // a local colour table
      at++; // the LZW code size
      skipBlocks();
    } else break; // the trailer, or something this does not read
  }
  return frames;
}
