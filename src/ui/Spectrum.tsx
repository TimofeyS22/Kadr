// The colour spectrum (v1.6.2; v1.6.4, the owner: "only pink and white, odd; let the basic colours be there"). The field
// shows every colour at once, as the system picker's Spectrum tab does: hue across, white at the top, the pure colours in
// the middle, black at the bottom. The strip below it takes the colour towards grey. A finger on either shows a loupe
// above it with the colours around the finger four times larger and the one picked in its middle.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { hexToHsl, hslToHex } from '../core/color';
import type { Project } from '../core/types';
import { t } from '../lib/i18n';
import { editor } from '../state/store';

type HSL = { h: number; s: number; l: number };
type Area = 'field' | 'sat';
/** Loupe diameter (CSS px), how much it enlarges, and how far above the finger it floats. */
const LOUPE = 84, ZOOM = 4, LIFT = 36;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));
/** Below this saturation the field would be grey from edge to edge: it is drawn, and picks, in full colour. */
const GREY = 0.05;
const fieldS = (s: number) => (s < GREY ? 1 : s);

/** The colour at a point of an area, as fractions of its width and height. */
const colorAt = (area: Area, fx: number, fy: number, c: HSL): HSL =>
  area === 'field' ? { h: clamp01(fx) * 359.999, s: fieldS(c.s), l: clamp01(1 - fy) } : { h: c.h, s: clamp01(fx), l: c.l };

/** A colour as the spectrum holds it: white and black have no hue or saturation of their own, so they keep the current ones. */
function read(value: string, cur: HSL): HSL | null {
  const c = hexToHsl(value);
  if (!c) return null;
  if (c.l === 0 || c.l === 1) return { h: cur.h, s: cur.s, l: c.l };
  return c.s === 0 ? { ...c, h: cur.h } : c;
}

export function Spectrum({ value, label, onChange, onDone }: {
  value: string; label: string;
  /** Every change while dragging (at most once a frame); the drag is one history step. */
  onChange: (color: string) => void;
  /** The colour a drag or a typed code ended on. */
  onDone: (color: string) => void;
}) {
  const [hsl, setHslState] = useState<HSL>(() => read(value, { h: 0, s: 1, l: 1 }) ?? { h: 0, s: 1, l: 1 });
  const cur = useRef(hsl);
  const setHsl = (x: HSL) => { cur.current = x; setHslState(x); };
  const field = useRef<HTMLDivElement>(null), sat = useRef<HTMLDivElement>(null);
  const drag = useRef<{ area: Area; before: Project | null } | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number; area: Area; fx: number; fy: number; w: number; h: number } | null>(null);
  const hex = hslToHex(hsl.h, hsl.s, hsl.l);
  const [draft, setDraft] = useState<string | null>(null);

  // A colour chosen elsewhere (a swatch, the eyedropper) moves the spectrum there.
  useEffect(() => {
    if (drag.current) return;
    const c = read(value, cur.current);
    if (c && hslToHex(c.h, c.s, c.l) !== hslToHex(cur.current.h, cur.current.s, cur.current.l)) setHsl(c);
  }, [value]); // cur is a ref

  // At most one change a frame while dragging: the preview redraws once per frame anyway.
  const raf = useRef(0), queued = useRef<string | null>(null);
  const emit = (c: string) => {
    queued.current = c;
    raf.current ||= requestAnimationFrame(() => { raf.current = 0; if (queued.current) onChange(queued.current); queued.current = null; });
  };
  const flush = () => { cancelAnimationFrame(raf.current); raf.current = 0; if (queued.current) onChange(queued.current); queued.current = null; };
  useEffect(() => () => cancelAnimationFrame(raf.current), []);

  const point = (e: RPointerEvent<HTMLDivElement>, area: Area) => {
    const r = (area === 'field' ? field : sat).current!.getBoundingClientRect();
    const fx = clamp01((e.clientX - r.left) / r.width), fy = clamp01((e.clientY - r.top) / r.height);
    const next = colorAt(area, fx, fy, cur.current);
    setHsl(next);
    emit(hslToHex(next.h, next.s, next.l));
    setLoupe({ x: r.left + fx * r.width, y: area === 'field' ? r.top + fy * r.height : r.top + r.height / 2, area, fx, fy, w: r.width, h: r.height });
  };
  const handlers = (area: Area) => ({
    onPointerDown: (e: RPointerEvent<HTMLDivElement>) => {
      e.preventDefault();
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
      drag.current = { area, before: editor().project };
      point(e, area);
    },
    onPointerMove: (e: RPointerEvent<HTMLDivElement>) => { if (drag.current?.area === area) point(e, area); },
    onPointerUp: () => end(),
    onPointerCancel: () => end(),
  });
  const end = () => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    flush();
    if (d.before) editor().squash(d.before);
    setLoupe(null);
    const c = cur.current;
    onDone(hslToHex(c.h, c.s, c.l));
  };

  /** Arrow keys: 1% steps (10% with Shift); on the field, left and right are the hue, up and down the brightness. */
  const keys = (area: Area) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const c = cur.current;
    const next = area === 'field' ? { ...c, s: fieldS(c.s), h: (c.h + d[0] * 360 + 360) % 360, l: clamp01(c.l + d[1]) } : { ...c, s: clamp01(c.s + (d[0] || d[1])) };
    setHsl(next);
    const col = hslToHex(next.h, next.s, next.l);
    onChange(col);
    onDone(col);
  };

  const typed = (text: string) => {
    setDraft(null);
    const c = read(text, cur.current);
    if (!c) return;
    setHsl(c);
    const col = hslToHex(c.h, c.s, c.l);
    onChange(col);
    onDone(col);
  };

  return (
    <div className="spectrum" role="group" aria-label={t('Spectrum: {label}', { label })}>
      <div ref={field} className="spectrum-field" style={{ '--grey': 1 - fieldS(hsl.s) } as CSSProperties} {...handlers('field')}
        role="slider" tabIndex={0} aria-label={t('Color and brightness')} aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsl.h)}
        aria-valuetext={t('hue {h}°, brightness {l}%', { h: Math.round(hsl.h), l: Math.round(hsl.l * 100) })} onKeyDown={keys('field')}>
        <i style={{ left: `${(hsl.h / 360) * 100}%`, top: `${(1 - hsl.l) * 100}%`, background: hex }} />
      </div>
      <div ref={sat} className="spectrum-sat" style={{ '--full': `hsl(${hsl.h} 100% 50%)` } as CSSProperties} {...handlers('sat')} role="slider" tabIndex={0} aria-label={t('Saturation')}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsl.s * 100)} onKeyDown={keys('sat')}>
        <i style={{ left: `${hsl.s * 100}%`, background: hslToHex(hsl.h, hsl.s, 0.5) }} />
      </div>
      <div className="spectrum-foot">
        <span className="spectrum-chip" style={{ background: hex }} aria-hidden />
        <input className="spectrum-code" value={draft ?? hex} maxLength={7} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          aria-label={t('Color code')} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => typed(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </div>
      {loupe && createPortal(<Loupe {...loupe} hsl={hsl} />, document.body)}
    </div>
  );
}

/**
 * Above the finger (which hides what it touches): the colours around it, ZOOM times larger, with the picked one in a
 * ring at the middle. Near the top of the screen it moves to the side.
 */
function Loupe({ x, y, area, fx, fy, w, h, hsl }: { x: number; y: number; area: Area; fx: number; fy: number; w: number; h: number; hsl: HSL }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const n = Math.round(LOUPE * dpr);
    if (c.width !== n) { c.width = n; c.height = n; }
    const img = c.getContext('2d')!.createImageData(n, n);
    const d = img.data;
    for (let py = 0; py < n; py++) {
      for (let px = 0; px < n; px++) {
        // This pixel of the loupe shows the point (dx, dy) CSS px from the finger, ZOOM times nearer.
        const dx = (px / dpr - LOUPE / 2) / ZOOM, dy = (py / dpr - LOUPE / 2) / ZOOM;
        const c2 = colorAt(area, fx + dx / w, area === 'field' ? fy + dy / h : 0.5, hsl);
        const hex = hslToHex(c2.h, c2.s, c2.l);
        const i = (py * n + px) * 4;
        d[i] = parseInt(hex.slice(1, 3), 16); d[i + 1] = parseInt(hex.slice(3, 5), 16); d[i + 2] = parseInt(hex.slice(5, 7), 16); d[i + 3] = 255;
      }
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [area, fx, fy, w, h, hsl]);
  const above = y - LIFT - LOUPE >= 8;
  const left = above ? x - LOUPE / 2 : x + LIFT + LOUPE <= window.innerWidth - 8 ? x + LIFT : x - LIFT - LOUPE;
  const top = above ? y - LIFT - LOUPE : y - LOUPE / 2;
  const picked = hslToHex(hsl.h, hsl.s, hsl.l);
  return (
    <div className="color-loupe" aria-hidden style={{ left: Math.max(8, Math.min(window.innerWidth - LOUPE - 8, left)), top, width: LOUPE, height: LOUPE }}>
      <canvas ref={canvas} />
      <i style={{ borderColor: picked }} />
    </div>
  );
}
