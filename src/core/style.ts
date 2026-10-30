// A text style read from a backup, a newer version or an edited file is not trusted (docs/11 §3.15): the numbers that
// decide a drawing's size and work are kept in sane ranges before drawing. Styles made in Kadr pass through unchanged.
import type { TextStyle } from './types';

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);

export function saneStyle(s: TextStyle): TextStyle {
  const out: TextStyle = { ...s, size: num(s.size, 0.005, 1, 0.055) };
  if (s.stroke) out.stroke = { ...s.stroke, width: num(s.stroke.width, 0, 0.5, 0) };
  if (s.outline2) out.outline2 = { ...s.outline2, width: num(s.outline2.width, 0, 0.5, 0) };
  if (s.background) {
    out.background = { ...s.background, opacity: num(s.background.opacity, 0, 1, 1) };
    if (s.background.padding !== undefined) out.background.padding = num(s.background.padding, 0, 3, 0.35);
    if (s.background.radius !== undefined) out.background.radius = num(s.background.radius, 0, 3, 0.3);
  }
  if (s.letterSpacing !== undefined) out.letterSpacing = num(s.letterSpacing, -0.5, 2, 0);
  if (s.lineHeight !== undefined) out.lineHeight = num(s.lineHeight, 0.5, 4, 1.25);
  if (s.copies !== undefined) {
    out.copies = (Array.isArray(s.copies) ? s.copies : []).slice(0, 4)
      .map((c) => ({ ...c, x: num(c?.x, -0.5, 0.5, 0), y: num(c?.y, -0.5, 0.5, 0) }));
  }
  return out;
}
