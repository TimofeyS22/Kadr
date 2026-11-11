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
  if (s.lines !== undefined) {
    // A look from a file: at most four, sizes and shifts in sane ranges (a scale of 10⁴ would make a canvas of 10⁸ px).
    out.lines = (Array.isArray(s.lines) ? s.lines : []).slice(0, 4).filter((l) => typeof l === 'object' && l !== null).map((l) => {
      const o = { ...l };
      if (l.scale !== undefined) o.scale = num(l.scale, 0.3, 3, 1);
      if (l.gap !== undefined) o.gap = num(l.gap, -0.8, 2, 0);
      if (l.dx !== undefined) o.dx = num(l.dx, -0.5, 0.5, 0);
      if (l.letterSpacing !== undefined) o.letterSpacing = num(l.letterSpacing, -0.5, 2, 0);
      return o;
    });
    if (!out.lines.length) delete out.lines;
  }
  if (s.copies !== undefined) {
    out.copies = (Array.isArray(s.copies) ? s.copies : []).slice(0, 4)
      .map((c) => ({ ...c, x: num(c?.x, -0.5, 0.5, 0), y: num(c?.y, -0.5, 0.5, 0) }));
  }
  return out;
}
