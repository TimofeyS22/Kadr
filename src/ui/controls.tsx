import { Check, Diamond, Pipette } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react';
import { player } from '../engine/player';
import { track } from '../lib/telemetry';
import type { Project } from '../core/types';
import { useEditor } from '../state/store';
import { t } from '../lib/i18n';

/** Px of downward drag before the sheet follows the finger (taps on the header stay taps). */
const DRAG_SLOP = 8;

export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const close = () => useEditor.getState().openSheet(null);
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
 * The colour row (v1.6, the owner: "more colours, and an eyedropper"): the eyedropper, any colour, the colours picked
 * last, then 30 colours by hue. One scrolling row, every target 44 px.
 */
export const SWATCHES = [
  '#ffffff', '#d9d9d9', '#9e9e9e', '#5c5c5c', '#000000',
  '#ff4d4f', '#ff5a36', '#ff8a3d', '#ffc53d', '#ffe66d',
  '#c8f560', '#3bd16f', '#12b886', '#2ad4c8', '#5ad8ff',
  '#2f9bff', '#3366ff', '#5b4dff', '#a45bff', '#d36bff',
  '#ff4fa3', '#ff8fc8', '#ffd6e0', '#fff1c1', '#d4f7dc',
  '#cfe8ff', '#8b5e3c', '#c49a6c', '#1b2a49', '#7a1f2b',
];
const RECENT_KEY = 'kadr.recentColors';
const RECENT_MAX = 8;
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
  const custom = useRef<HTMLInputElement>(null);
  const remember = (c: string) => {
    const col = c.toLowerCase();
    if (SWATCHES.includes(col)) return;
    setRecent((r) => {
      const next = [col, ...r.filter((x) => x !== col)].slice(0, RECENT_MAX);
      try { localStorage.setItem(RECENT_KEY, JSON.stringify(next)); } catch { /* storage off: this session only */ }
      return next;
    });
  };
  // The native picker reports every move as "input"; "change" is the colour it closed on.
  useEffect(() => {
    const el = custom.current;
    const done = () => { if (el) remember(el.value); };
    el?.addEventListener('change', done);
    return () => el?.removeEventListener('change', done);
  }, []);
  // A closed sheet takes its eyedropper with it.
  useEffect(() => () => { if (useEditor.getState().eyedropper?.owner === owner) useEditor.setState({ eyedropper: null }); }, [owner]);
  const toggleDropper = () => {
    if (picking) { useEditor.setState({ eyedropper: null }); return; }
    player.pause();
    useEditor.setState({ eyedropper: { owner, from, pick: (c) => { latest.current(c); remember(c); track('eyedropper_used'); } } });
  };
  const lower = value.toLowerCase();
  const swatch = (c: string) => (
    <button key={c} className={`swatch ${c === lower ? 'on' : ''}`} onClick={() => onChange(c)} aria-label={c} aria-pressed={c === lower}>
      <i style={{ background: c }} />
    </button>
  );
  return (
    <div className="swatches" role="group" aria-label={label}>
      <button className={`swatch tool-dropper ${picking ? 'on' : ''}`} onClick={toggleDropper} aria-pressed={picking} aria-label={t('Eyedropper: {label}', { label })}>
        <i><Pipette size={18} /></i>
      </button>
      <label className="swatch custom" title={t('Any color')}>
        <i style={{ background: SWATCHES.includes(lower) || recent.includes(lower) ? undefined : value }} />
        <input ref={custom} type="color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label}`} />
      </label>
      {recent.length > 0 && <>{recent.map(swatch)}<span className="swatch-sep" aria-hidden /></>}
      {SWATCHES.map(swatch)}
    </div>
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
