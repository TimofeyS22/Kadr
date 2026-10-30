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
