// Colour contrast (WCAG 2): which text colour reads on which box. Pure, so the catalog's readability is unit-tested.

/** Relative luminance of `#rrggbb`, 0 (black) … 1 (white). */
export function luminance(hex: string): number {
  const n = parseInt(hex.replace('#', '').padEnd(6, '0').slice(0, 6), 16);
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** WCAG contrast ratio of two colours, 1 … 21. */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Text on a coloured box (the "box" word highlight): the style's colour when it reads there (4.5:1), else black or white. */
export function readableOn(box: string, preferred: string): string {
  if (contrast(preferred, box) >= 4.5) return preferred;
  return contrast('#111111', box) >= contrast('#ffffff', box) ? '#111111' : '#ffffff';
}

/** "#rrggbb" from channels 0..1 (clamped, rounded). */
export function toHex(r: number, g: number, b: number): string {
  return `#${[r, g, b].map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, '0')).join('')}`;
}

/** HSV (hue 0..360, saturation and value 0..1) as "#rrggbb". */
export function hsvToHex(h: number, s: number, v: number): string {
  const f = (n: number) => { const k = (n + h / 60) % 6; return v - v * s * Math.max(0, Math.min(k, 4 - k, 1)); };
  return toHex(f(5), f(3), f(1));
}

/** "#rgb" or "#rrggbb" as HSV; null for anything else. Grey has no hue: 0. */
export function hexToHsv(hex: string): { h: number; s: number; v: number } | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const x = m[1].length === 3 ? [...m[1]].map((c) => c + c).join('') : m[1];
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}
