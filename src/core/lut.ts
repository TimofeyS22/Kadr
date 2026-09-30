// .cube 3D LUT parsing (Adobe/Resolve format) into a compact RGB8 table for a WebGL 3D texture.

export const MAX_LUT_SIZE = 33;
export const MAX_CUBE_BYTES = 10 * 1024 * 1024;

export interface ParsedLut { title: string; size: number; data: Uint8Array }

const INVALID = 'This .cube file is not a valid 3D LUT';

/** Parses a .cube file; sizes above 33 are resampled (trilinear) to 33 to keep projects small. */
export function parseCube(text: string): ParsedLut {
  let size = 0, title = '';
  let min = [0, 0, 0], max = [1, 1, 1];
  const values: number[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [key, ...rest] = line.split(/\s+/);
    if (key === 'TITLE') title = line.slice(5).trim().replace(/^"|"$/g, '');
    else if (key === 'LUT_3D_SIZE') size = Number(rest[0]);
    else if (key === 'LUT_1D_SIZE') throw new Error('1D LUTs are not supported, use a 3D .cube LUT');
    else if (key === 'DOMAIN_MIN') min = rest.map(Number);
    else if (key === 'DOMAIN_MAX') max = rest.map(Number);
    else if (/^[-+.\d]/.test(key)) {
      const v = [key, ...rest].slice(0, 3).map(Number);
      if (v.length !== 3 || v.some((x) => !Number.isFinite(x))) throw new Error(INVALID);
      values.push(...v);
    }
  }
  if (!Number.isInteger(size) || size < 2 || size > 65 || values.length !== size ** 3 * 3) throw new Error(INVALID);
  if (min.length !== 3 || max.length !== 3 || min.some((m, i) => !(max[i] > m))) throw new Error(INVALID);
  // Output values are scaled by the domain as well, so a LUT authored for 0..1 input stays correct.
  const norm = (v: number, c: number) => Math.min(1, Math.max(0, (v - min[c]) / (max[c] - min[c])));
  const src = Float32Array.from(values, (v, i) => norm(v, i % 3));
  const n = Math.min(size, MAX_LUT_SIZE);
  const out = new Uint8Array(n ** 3 * 3);
  const at = (r: number, g: number, b: number, c: number) => src[((b * size + g) * size + r) * 3 + c];
  for (let b = 0; b < n; b++) for (let g = 0; g < n; g++) for (let r = 0; r < n; r++) {
    const p = [r, g, b].map((x) => (x * (size - 1)) / (n - 1));
    const i0 = p.map(Math.floor), i1 = i0.map((x) => Math.min(size - 1, x + 1)), f = p.map((x, k) => x - i0[k]);
    for (let c = 0; c < 3; c++) {
      let v = 0;
      for (let k = 0; k < 8; k++) {
        const rr = k & 1 ? i1[0] : i0[0], gg = k & 2 ? i1[1] : i0[1], bb = k & 4 ? i1[2] : i0[2];
        const w = (k & 1 ? f[0] : 1 - f[0]) * (k & 2 ? f[1] : 1 - f[1]) * (k & 4 ? f[2] : 1 - f[2]);
        if (w) v += w * at(rr, gg, bb, c);
      }
      out[((b * n + g) * n + r) * 3 + c] = Math.round(v * 255);
    }
  }
  return { title, size: n, data: out };
}

export function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}
