// CRC-32 (IEEE 802.3), the checksum of every zip entry: eight bytes a step through eight tables ("slicing by 8"),
// a few times quicker than a byte a step. A backup's media pass through it whole, gigabytes on a phone.

const T = new Int32Array(256 * 8);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  T[i] = c;
}
for (let k = 256; k < 256 * 8; k += 256) for (let i = 0; i < 256; i++) T[k + i] = (T[k - 256 + i] >>> 8) ^ T[T[k - 256 + i] & 255];

/** The CRC-32 of the bytes `crc` was computed over followed by `d` (start with 0), as zlib's `crc32(crc, buf)`. */
export function crc32(crc: number, d: Uint8Array): number {
  let c = ~crc, i = 0;
  for (const n = d.length - 7; i < n; i += 8) {
    const a = c ^ (d[i] | (d[i + 1] << 8) | (d[i + 2] << 16) | (d[i + 3] << 24));
    c = T[1792 + (a & 255)] ^ T[1536 + ((a >>> 8) & 255)] ^ T[1280 + ((a >>> 16) & 255)] ^ T[1024 + (a >>> 24)]
      ^ T[768 + d[i + 4]] ^ T[512 + d[i + 5]] ^ T[256 + d[i + 6]] ^ T[d[i + 7]];
  }
  for (; i < d.length; i++) c = T[(c ^ d[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}
