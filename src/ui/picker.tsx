// Template catalogs (v1.5): category buttons over a two-row strip of live previews. A preview is drawn by the same text
// renderer as the video (ui/tiles.ts), so it shows exactly what the template gives. Made for one hand at 375 px: the
// strip scrolls sideways under the thumb, a category tap jumps to its first template.
import { useEffect, useRef, useState } from 'react';
import { t } from '../lib/i18n';

export interface PickerItem { id: string; name: string; cat: string }
/** Draws `item` into `canvas` at demo time `t` (seconds); calls `redraw` if it could not draw yet (a font loading). */
export type TileDraw<T> = (item: T, canvas: HTMLCanvasElement, t: number, redraw: () => void) => void;

/** One demo loop of the animated previews, and the moment a still preview shows (reduced motion, text styles). */
export const DEMO_LOOP_S = 2.4;
export const DEMO_STILL_S = 1.2;
const TICK_MS = 80; // ~12 frames a second is enough for a 100 px preview, and cheap on a slow phone

export function StylePicker<T extends PickerItem>({ items, categories, value, onChange, label, draw, animated = false }: {
  items: readonly T[]; categories: readonly { id: string; name: string }[]; value: string | null; onChange: (id: string) => void;
  label: string; draw: TileDraw<T>; animated?: boolean;
}) {
  const strip = useRef<HTMLDivElement>(null);
  const cats = useRef<HTMLDivElement>(null);
  const groups = categories.map((c) => ({ ...c, items: items.filter((it) => it.cat === c.id) })).filter((g) => g.items.length);
  const [cat, setCat] = useState(() => items.find((it) => it.id === value)?.cat ?? groups[0]?.id);

  // The chosen template is in view when the picker opens.
  useEffect(() => {
    const el = strip.current?.querySelector<HTMLElement>('[aria-checked="true"]');
    const root = strip.current;
    if (el && root) root.scrollLeft = Math.max(0, el.offsetLeft - root.clientWidth / 2 + el.offsetWidth / 2);
  }, []);

  // Only previews on screen are drawn; with motion they redraw on one shared clock, which stops with the picker.
  useEffect(() => {
    const root = strip.current;
    if (!root) return;
    const byId = new Map(items.map((it) => [it.id, it]));
    const still = !animated || matchMedia('(prefers-reduced-motion: reduce)').matches;
    const visible = new Set<HTMLCanvasElement>();
    const paint = (c: HTMLCanvasElement, now: number) => {
      const it = byId.get(c.dataset.id ?? '');
      if (!it) return;
      const dpr = Math.min(3, devicePixelRatio || 1);
      const w = Math.round(c.clientWidth * dpr), h = Math.round(c.clientHeight * dpr);
      if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
      draw(it, c, still ? DEMO_STILL_S : (now / 1000) % DEMO_LOOP_S, () => paint(c, performance.now()));
    };
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        const c = e.target as HTMLCanvasElement;
        if (e.isIntersecting) { visible.add(c); paint(c, performance.now()); } else visible.delete(c);
      }
    }, { root, rootMargin: '0px 80px' });
    root.querySelectorAll('canvas[data-id]').forEach((c) => io.observe(c));
    let raf = 0, last = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (now - last < TICK_MS || document.hidden) return;
      last = now;
      for (const c of visible) paint(c, now);
    };
    if (!still) raf = requestAnimationFrame(tick);
    return () => { io.disconnect(); cancelAnimationFrame(raf); };
  }, [items, draw, animated]);

  // The lit category button stays in view as the strip scrolls past the categories.
  useEffect(() => {
    const row = cats.current, b = row?.querySelector<HTMLElement>('.pick-cat.on');
    if (!row || !b) return;
    if (b.offsetLeft < row.scrollLeft || b.offsetLeft + b.offsetWidth > row.scrollLeft + row.clientWidth) row.scrollLeft = b.offsetLeft - 16;
  }, [cat]);

  const jumped = useRef<string | null>(null);
  const jump = (id: string) => {
    setCat(id);
    jumped.current = id;
    const root = strip.current, g = root?.querySelector<HTMLElement>(`[data-cat="${id}"]`);
    if (!root || !g) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    root.scrollTo({ left: g.offsetLeft - parseFloat(getComputedStyle(root).paddingLeft), behavior: reduce ? 'auto' : 'smooth' });
  };
  // The category under the left edge lights up while the strip scrolls.
  const onScroll = () => {
    const root = strip.current;
    if (!root) return;
    let on = groups[0]?.id;
    for (const g of root.querySelectorAll<HTMLElement>('[data-cat]')) if (g.offsetLeft - root.scrollLeft <= root.clientWidth / 3) on = g.dataset.cat ?? on;
    // At the end of the strip the last categories cannot reach the left edge: the one tapped (or the last) stays lit.
    if (root.scrollLeft + root.clientWidth >= root.scrollWidth - 2 && jumped.current) on = jumped.current;
    else if (root.scrollLeft + root.clientWidth >= root.scrollWidth - 2) on = groups[groups.length - 1]?.id;
    if (on !== cat) setCat(on);
  };

  return (
    <div className="picker">
      <div ref={cats} className="pick-cats">
        {groups.map((g) => (
          <button key={g.id} className={`pick-cat ${g.id === cat ? 'on' : ''}`} aria-current={g.id === cat} onClick={() => jump(g.id)}>{t(g.name)}</button>
        ))}
      </div>
      <div ref={strip} className="pick-strip" role="radiogroup" aria-label={label} onScroll={onScroll} onPointerDown={() => { jumped.current = null; }}>
        {groups.map((g) => (
          <div key={g.id} className="pick-group" data-cat={g.id}>
            {g.items.map((it) => (
              <button key={it.id} role="radio" aria-checked={it.id === value} aria-label={t(it.name)} className={`tile ${it.id === value ? 'on' : ''}`} onClick={() => onChange(it.id)}>
                <canvas data-id={it.id} aria-hidden />
                <span aria-hidden>{t(it.name)}</span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
