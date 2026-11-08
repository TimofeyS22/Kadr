import { Check, Diamond, Pipette } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { player } from '../engine/player';
import { track } from '../lib/telemetry';
import type { Project } from '../core/types';
import { useEditor } from '../state/store';
import { Spectrum } from './Spectrum';
import { t } from '../lib/i18n';

/** Px of downward drag before the sheet follows the finger (taps on the header stay taps). */
const DRAG_SLOP = 8;

/**
 * While this sheet holds work closing it would lose (an export, captions being made, a file not saved yet), `message`
 * says what: the first close warns, a second one closes (audit V-225: Done, a swipe or Esc silently threw it away).
 */
export function useSheetGuard(message: string | null): void {
  useEffect(() => {
    if (!message) return;
    useEditor.setState({ sheetGuard: message });
    return () => useEditor.setState({ sheetGuard: null });
  }, [message]);
}

export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const close = () => { useEditor.getState().closeSheet(); };
  // Swipe the header down to close, like the system sheets (docs/09 Q2). The sheet moves through its style, not React
  // state: the bodies are heavy and the finger needs 60 FPS.
  const ref = useRef<HTMLElement>(null);
  const drag = useRef<{ y0: number; y: number; t: number; v: number; on: boolean } | null>(null);
  const slide = (dy: number) => { if (ref.current) ref.current.style.transform = dy ? `translateY(${dy}px)` : ''; };
  const down = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0, on: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.on && dy < DRAG_SLOP) return;
    if (!d.on) { d.on = true; ref.current?.classList.add('dragging'); }
    if (e.timeStamp > d.t) d.v = (e.clientY - d.y) / (e.timeStamp - d.t);
    d.y = e.clientY; d.t = e.timeStamp;
    slide(Math.max(0, dy));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d?.on || !el) return;
    el.classList.remove('dragging');
    // Past 30% of its height, or a flick (> 0.5 px/ms), closes it; otherwise it springs back.
    if (d.y - d.y0 > 0.3 * el.offsetHeight || d.v > 0.5) {
      if (useEditor.getState().sheetGuard) { slide(0); close(); return; } // it may stay open: no slide-away
      slide(el.offsetHeight);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) close(); else setTimeout(close, 160);
    } else slide(0);
  };
  return (
    <section ref={ref} className="sheet" role="dialog" aria-label={t(title)}>
      <header className="sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <h2>{t(title)}</h2>
        <button className="icon-btn accent" onClick={close} aria-label={t('Done')}><Check size={22} /></button>
      </header>
      <div className="sheet-body">{children}</div>
    </section>
  );
}

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
  /** Double-tap on the label resets to this value. */
  reset?: number;
  keyframe?: { active: boolean; animated: boolean; disabled: boolean; toggle: () => void };
}

export function Slider({ label, value, min, max, step = 0.01, format, onChange, reset, keyframe }: SliderProps) {
  return (
    <div className="slider">
      <span className="slider-label" onDoubleClick={() => reset !== undefined && onChange(reset)} title={reset !== undefined ? t('Double-tap to reset') : undefined}>
        {t(label)}
      </span>
      <input
        type="range" min={min} max={max} step={step} value={value} aria-label={t(label)}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="slider-value">{format ? format(value) : value.toFixed(2)}</span>
      {keyframe && (
        <button
          className={`kf-btn ${keyframe.active ? 'on' : ''} ${keyframe.animated ? 'animated' : ''}`}
          disabled={keyframe.disabled} onClick={keyframe.toggle}
          aria-label={keyframe.active ? t('Remove {label} keyframe', { label }) : t('Add {label} keyframe', { label })}
        >
          <Diamond size={16} fill={keyframe.active ? 'currentColor' : 'none'} />
        </button>
      )}
    </div>
  );
}

export function Chips<T extends string | number>({ options, value, onChange, render, scroll, label }: {
  options: readonly T[]; value: T | null; onChange: (v: T) => void; render?: (v: T) => ReactNode;
  /** One horizontally scrolling row instead of wrapping (long lists such as fonts). */
  scroll?: boolean;
  label?: string;
}) {
  return (
    <div className={`chips ${scroll ? 'scroll' : ''}`} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o)} role="radio" aria-checked={o === value} className={`chip ${o === value ? 'on' : ''}`} onClick={() => onChange(o)}>
          {chipLabel(o, render)}
        </button>
      ))}
    </div>
  );
}

export function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span>{t(label)}</span>
      <input type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}

/**
 * The colour row: the eyedropper, any colour, then the basic colours, so they are what the eye meets first (v1.6.4, the
 * owner: "only pink and white, odd"; eight colours picked from one picture used to fill the whole first screen). The
 * colours picked last and the other shades follow. One scrolling row, every target 44 px.
 */
export const BASIC_COLORS = ['#ffffff', '#000000', '#ff3b30', '#ff9500', '#ffd60a', '#34c759', '#00c7be', '#007aff', '#af52de', '#ff2d92', '#9e9e9e'];
const SHADES = [
  '#d9d9d9', '#5c5c5c', '#ff5a36', '#ff8a3d', '#ffc53d', '#c8f560', '#3bd16f', '#2ad4c8', '#5ad8ff', '#2f9bff',
  '#3366ff', '#5b4dff', '#d36bff', '#ff8fc8', '#ffd6e0', '#8b5e3c', '#c49a6c', '#1b2a49', '#7a1f2b',
];
export const SWATCHES = [...BASIC_COLORS, ...SHADES];
/** Two colours this close (sum of channel differences) look the same in a 30 px circle: the row keeps one of them. */
const SAME_COLOR = 36;
const channels = (c: string) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
const looksSame = (a: string, b: string) => { const y = channels(b); return channels(a).reduce((n, v, i) => n + Math.abs(v - y[i]), 0) < SAME_COLOR; };
const RECENT_KEY = 'kadr.recentColors';
const RECENT_MAX = 6;
function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]') as unknown;
    return Array.isArray(v) ? v.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/.test(c)).slice(0, RECENT_MAX) : [];
  } catch { return []; }
}

export function Swatches({ value, onChange, label, from }: {
  value: string; onChange: (c: string) => void; label: string;
  /** The eyedropper reads this version of the project instead of the one on screen (the chroma key's colour, key off). */
  from?: () => Project | null;
}) {
  const [recent, setRecent] = useState(loadRecent);
  const owner = useRef({}).current;
  const latest = useRef(onChange);
  latest.current = onChange;
  const picking = useEditor((s) => s.eyedropper?.owner === owner);
  const [spectrum, setSpectrum] = useState(false);
  const remember = (c: string) => {
    const col = c.toLowerCase();
    if (SWATCHES.includes(col)) return;
    setRecent((r) => {
      const next = [col, ...r.filter((x) => !looksSame(x, col))].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage off: this session only */ }
      return next;
    });
  };
  // A closed sheet takes its eyedropper with it.
  useEffect(() => () => { if (useEditor.getState().eyedropper?.owner === owner) useEditor.setState({ eyedropper: null }); }, [owner]);
  const toggleDropper = () => {
    if (picking) { useEditor.setState({ eyedropper: null }); return; }
    player.pause();
    useEditor.setState({ eyedropper: { owner, from, pick: (c) => { latest.current(c); remember(c); track('eyedropper_used'); } } });
  };
  const lower = value.toLowerCase();
  // The chosen colour is in view when the sheet opens, wherever it is in the row.
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = row.current, on = r?.querySelector<HTMLElement>('.swatch.on[aria-label^="#"]');
    if (r && on) r.scrollLeft = Math.max(0, on.offsetLeft - r.offsetLeft - r.clientWidth / 2);
  }, []);
  const swatch = (c: string) => (
    <button key={c} className={`swatch ${c === lower ? 'on' : ''}`} onClick={() => onChange(c)} aria-label={c} aria-pressed={c === lower}>
      <i style={{ background: c }} />
    </button>
  );
  return (
    <>
      <div ref={row} className="swatches" role="group" aria-label={label}>
        <button className={`swatch tool-dropper ${picking ? 'on' : ''}`} onClick={toggleDropper} aria-pressed={picking} aria-label={t('Eyedropper: {label}', { label })}>
          <i><Pipette size={18} /></i>
        </button>
        {/* Any colour (v1.6.2): our own spectrum with a loupe, the same on every phone, instead of the system picker. */}
        <button className={`swatch custom ${spectrum ? 'on' : ''}`} onClick={() => setSpectrum((o) => !o)} aria-expanded={spectrum}
          aria-label={t('Spectrum: {label}', { label })}>
          <i />
        </button>
        {BASIC_COLORS.map(swatch)}
        <span className="swatch-sep" aria-hidden />
        {recent.length > 0 && <>{recent.map(swatch)}<span className="swatch-sep" aria-hidden /></>}
        {SHADES.map(swatch)}
      </div>
      {spectrum && <Spectrum value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} label={label} onChange={onChange} onDone={remember} />}
    </>
  );
}

/** Human labels for option ids shown as chips; every string label is translated. */
const OPTION_LABELS: Record<string, string> = {
  none: 'None', fade: 'Fade', rise: 'Rise', pop: 'Pop', typewriter: 'Typewriter', normal: 'Normal', screen: 'Screen',
  multiply: 'Multiply', add: 'Add', left: 'Left', center: 'Center', right: 'Right',
  // v1.5 text motion
  slideLeft: 'Slide from left', slideRight: 'Slide from right', drop: 'Drop', zoom: 'Zoom', spin: 'Spin', blur: 'Blur',
  pulse: 'Pulse', float: 'Float', swing: 'Swing', shake: 'Shake', blink: 'Blink',
};
function chipLabel<T extends string | number>(o: T, render?: (v: T) => ReactNode): ReactNode {
  const r = render ? render(o) : typeof o === 'string' ? OPTION_LABELS[o] ?? o : String(o);
  return typeof r === 'string' ? t(r) : r;
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const signed = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
export const secs = (v: number): string => `${v.toFixed(1)}s`;
