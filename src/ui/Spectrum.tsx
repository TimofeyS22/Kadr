// The colour spectrum (v1.6.2, the owner: "a colour square to find the colour and its shade, as convenient as it can
// be, with a magnifier above the touch"). A square of saturation and brightness for the hue below it; a finger on
// either shows a loupe above it with the colours around the finger four times larger and the one picked in its middle.
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { hexToHsv, hsvToHex } from '../core/color';
import type { Project } from '../core/types';
import { t } from '../lib/i18n';
import { editor } from '../state/store';

type HSV = { h: number; s: number; v: number };
type Area = 'sv' | 'hue';
/** Loupe diameter (CSS px), how much it enlarges, and how far above the finger it floats. */
const LOUPE = 84, ZOOM = 4, LIFT = 36;
const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

/** The colour at a point of an area, as fractions of its width and height. */
const colorAt = (area: Area, fx: number, fy: number, hsv: HSV): HSV =>
  area === 'sv' ? { h: hsv.h, s: clamp01(fx), v: clamp01(1 - fy) } : { h: clamp01(fx) * 359.999, s: hsv.s, v: hsv.v };

export function Spectrum({ value, label, onChange, onDone }: {
  value: string; label: string;
  /** Every change while dragging (at most once a frame); the drag is one history step. */
  onChange: (color: string) => void;
  /** The colour a drag or a typed code ended on. */
  onDone: (color: string) => void;
}) {
  const [hsv, setHsvState] = useState<HSV>(() => hexToHsv(value) ?? { h: 0, s: 0, v: 1 });
  const cur = useRef(hsv);
  const setHsv = (x: HSV) => { cur.current = x; setHsvState(x); };
  const sv = useRef<HTMLDivElement>(null), hue = useRef<HTMLDivElement>(null);
  const drag = useRef<{ area: Area; before: Project | null } | null>(null);
  const [loupe, setLoupe] = useState<{ x: number; y: number; area: Area; fx: number; fy: number; w: number; h: number } | null>(null);
  const hex = hsvToHex(hsv.h, hsv.s, hsv.v);
  const [draft, setDraft] = useState<string | null>(null);

  // A colour chosen elsewhere (a swatch, the eyedropper) moves the spectrum there; a grey keeps the hue it had.
  useEffect(() => {
    if (drag.current) return;
    const c = hexToHsv(value);
    if (!c || hsvToHex(c.h, c.s, c.v) === hsvToHex(cur.current.h, cur.current.s, cur.current.v)) return;
    setHsv({ ...c, h: c.s === 0 || c.v === 0 ? cur.current.h : c.h });
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
    const r = (area === 'sv' ? sv : hue).current!.getBoundingClientRect();
    const fx = clamp01((e.clientX - r.left) / r.width), fy = clamp01((e.clientY - r.top) / r.height);
    const next = colorAt(area, fx, fy, cur.current);
    setHsv(next);
    emit(hsvToHex(next.h, next.s, next.v));
    setLoupe({ x: r.left + fx * r.width, y: area === 'sv' ? r.top + fy * r.height : r.top + r.height / 2, area, fx, fy, w: r.width, h: r.height });
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
    onDone(hsvToHex(c.h, c.s, c.v));
  };

  /** Arrow keys: 1% steps (10% with Shift); on the square, left and right are saturation, up and down brightness. */
  const keys = (area: Area) => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }[e.key];
    if (!d) return;
    e.preventDefault();
    const c = cur.current;
    const next = area === 'sv' ? { ...c, s: clamp01(c.s + d[0]), v: clamp01(c.v + d[1]) } : { ...c, h: (c.h + (d[0] || d[1]) * 360 + 360) % 360 };
    setHsv(next);
    const col = hsvToHex(next.h, next.s, next.v);
    onChange(col);
    onDone(col);
  };

  const typed = (text: string) => {
    setDraft(null);
    const c = hexToHsv(text);
    if (!c) return;
    setHsv({ ...c, h: c.s === 0 || c.v === 0 ? cur.current.h : c.h });
    const col = hsvToHex(c.h, c.s, c.v);
    onChange(col);
    onDone(col);
  };

  return (
    <div className="spectrum" role="group" aria-label={t('Spectrum: {label}', { label })}>
      <div ref={sv} className="spectrum-sv" style={{ '--hue': `hsl(${hsv.h} 100% 50%)` } as CSSProperties} {...handlers('sv')}
        role="slider" tabIndex={0} aria-label={t('Saturation and brightness')} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(hsv.s * 100)}
        aria-valuetext={t('saturation {s}%, brightness {v}%', { s: Math.round(hsv.s * 100), v: Math.round(hsv.v * 100) })} onKeyDown={keys('sv')}>
        <i style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div ref={hue} className="spectrum-hue" {...handlers('hue')} role="slider" tabIndex={0} aria-label={t('Hue')}
        aria-valuemin={0} aria-valuemax={360} aria-valuenow={Math.round(hsv.h)} onKeyDown={keys('hue')}>
        <i style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>
      <div className="spectrum-foot">
        <span className="spectrum-chip" style={{ background: hex }} aria-hidden />
        <input className="spectrum-code" value={draft ?? hex} maxLength={7} spellCheck={false} autoCapitalize="none" autoCorrect="off"
          aria-label={t('Color code')} onChange={(e) => setDraft(e.target.value)} onBlur={(e) => typed(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      </div>
      {loupe && createPortal(<Loupe {...loupe} hsv={hsv} />, document.body)}
    </div>
  );
}

/**
 * Above the finger (which hides what it touches): the colours around it, ZOOM times larger, with the picked one in a
 * ring at the middle. Near the top of the screen it moves to the side.
 */
function Loupe({ x, y, area, fx, fy, w, h, hsv }: { x: number; y: number; area: Area; fx: number; fy: number; w: number; h: number; hsv: HSV }) {
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
        const c2 = colorAt(area, fx + dx / w, area === 'sv' ? fy + dy / h : 0.5, hsv);
        const hex = hsvToHex(c2.h, c2.s, c2.v);
        const i = (py * n + px) * 4;
        d[i] = parseInt(hex.slice(1, 3), 16); d[i + 1] = parseInt(hex.slice(3, 5), 16); d[i + 2] = parseInt(hex.slice(5, 7), 16); d[i + 3] = 255;
      }
    }
    c.getContext('2d')!.putImageData(img, 0, 0);
  }, [area, fx, fy, w, h, hsv]);
  const above = y - LIFT - LOUPE >= 8;
  const left = above ? x - LOUPE / 2 : x + LIFT + LOUPE <= window.innerWidth - 8 ? x + LIFT : x - LIFT - LOUPE;
  const top = above ? y - LIFT - LOUPE : y - LOUPE / 2;
  const picked = hsvToHex(hsv.h, hsv.s, hsv.v);
  return (
    <div className="color-loupe" aria-hidden style={{ left: Math.max(8, Math.min(window.innerWidth - LOUPE - 8, left)), top, width: LOUPE, height: LOUPE }}>
      <canvas ref={canvas} />
      <i style={{ borderColor: picked }} />
    </div>
  );
}
