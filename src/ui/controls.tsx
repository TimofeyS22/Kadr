import { Diamond, Pipette } from 'lucide-react';
import { createContext, useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react';
import { player } from '../engine/player';
import { track } from '../lib/telemetry';
import { clipEnd } from '../core/timeline';
import type { Clip, Project } from '../core/types';
import { useEditor } from '../state/store';
import { formatTime } from './format';
import { Spectrum } from './Spectrum';
import { t, useLocale } from '../lib/i18n';
import { Button } from './ck/controls';
import { giveBack, opener, watchPressed } from './ck/focus';

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

/**
 * A tool sheet (Chetko Ч4 release 5): docked at the bottom, as tall as what it holds and never over 46% of the screen
 * (audit UI-7). It is not modal: the frame, Undo and play stay in reach while it is open. It takes the focus when it
 * opens (its name is read), Escape closes it (Editor.tsx) and the focus goes back to the tool that opened it.
 */
/** The header of the open sheet, for a control of its body that belongs next to «Готово» (Before / after). */
export const SheetHead = createContext<HTMLElement | null>(null);

export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const close = () => { useEditor.getState().closeSheet(); };
  const [head, setHead] = useState<HTMLElement | null>(null);
  // Swipe the header down to close, like the system sheets (docs/09 Q2). The sheet moves through its style, not React
  // state: the bodies are heavy and the finger needs 60 FPS.
  const ref = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const id = useId();
  const drag = useRef<{ y0: number; y: number; t: number; v: number; on: boolean } | null>(null);
  useEffect(watchPressed, []);
  // The focus: into the sheet when it opens (unless its body already took it, a text field), back when it closes.
  useEffect(() => {
    const el = ref.current;
    const back = opener();
    const name = back?.textContent ?? null;
    if (el && !el.contains(document.activeElement)) heading.current?.focus({ preventScroll: true });
    return () => {
      if (!el || !(el.contains(document.activeElement) || document.activeElement === document.body)) return;
      // The ribbon is drawn again when the sheet closes: the tool of the same name, or the first one if the ribbon changed.
      requestAnimationFrame(() => giveBack(back, () => {
        const tools = [...document.querySelectorAll<HTMLElement>('.toolbar .ck-tool:not(:disabled)')];
        return tools.find((b) => b.textContent === name) ?? tools[0];
      }));
    };
  }, [title]);
  // The editor gives the frame what the sheet leaves. While the sheet is open it does not shrink, so the frame does not
  // jump when a tab or a category changes; it grows only with what the person opened in it (the spectrum).
  useLayoutEffect(() => {
    const el = ref.current, host = el?.closest<HTMLElement>('.ck-editor');
    if (!el || !host) return;
    let tallest = 0, frame = 0;
    const fit = () => {
      const h = el.offsetHeight;
      if (h <= tallest) return;
      tallest = h;
      el.style.minHeight = `${h}px`; // the sheet itself keeps it too: no gap opens between the frame and the sheet
      host.style.setProperty('--sheet-h', `${h}px`);
    };
    fit();
    // Later changes wait for the next frame: changing the editor's layout inside the observer's own callback made the
    // browser report "ResizeObserver loop completed with undelivered notifications".
    const ro = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(fit); });
    ro.observe(el);
    return () => { ro.disconnect(); cancelAnimationFrame(frame); el.style.minHeight = ''; host.style.removeProperty('--sheet-h'); };
  }, [title]);
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
    if (!d.on) { d.on = true; ref.current?.setAttribute('data-dragging', 'true'); }
    if (e.timeStamp > d.t) d.v = (e.clientY - d.y) / (e.timeStamp - d.t);
    d.y = e.clientY; d.t = e.timeStamp;
    slide(Math.max(0, dy));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    const el = ref.current;
    if (!d?.on || !el) return;
    el.removeAttribute('data-dragging');
    // Past 30% of its height, or a flick (> 0.5 px/ms), closes it; otherwise it springs back.
    if (d.y - d.y0 > 0.3 * el.offsetHeight || d.v > 0.5) {
      if (useEditor.getState().sheetGuard) { slide(0); close(); return; } // it may stay open: no slide-away
      slide(el.offsetHeight);
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) close(); else setTimeout(close, 160);
    } else slide(0);
  };
  return (
    <section ref={ref} className="sheet ck ck-panel" role="dialog" aria-label={t(title)}>
      <header className="sheet-head ck-panel-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
        <h2 id={id} ref={heading} tabIndex={-1}>{t(title)}</h2>
        <span ref={setHead} className="ck-panel-tools" />
        <Button onClick={close}>{t('Done')}</Button>
      </header>
      {/* A line under the header once the body has scrolled under it. */}
      <div className="sheet-body ck-panel-body" onScroll={(e) => ref.current?.toggleAttribute('data-scrolled', e.currentTarget.scrollTop > 0)}>
        <SheetHead.Provider value={head}>{children}</SheetHead.Provider>
      </div>
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

/**
 * The playhead inside a sheet that covers the timeline (audit V-218): the second keyframe no longer means closing the sheet.
 * Marks show the moments that have keyframes.
 */
export function ClipScrub({ clip, keys }: { clip: Clip; keys: number[] }) {
  const time = useEditor((s) => s.time);
  const fps = useEditor((s) => s.project?.settings.fps ?? 30);
  const end = clipEnd(clip);
  return (
    <div className="ck-scrub">
      <span className="ck-scrub-time">{formatTime(Math.max(0, time - clip.start))}</span>
      <div className="ck-scrub-track">
        <input
          type="range" aria-label={t('Position in the clip')} min={clip.start} max={end} step={1 / fps} value={Math.min(end, Math.max(clip.start, time))}
          aria-valuetext={formatTime(Math.max(0, time - clip.start))}
          onChange={(e) => { player.pause(); player.seek(Number(e.target.value)); useEditor.setState({ time: player.time }); }}
        />
        {[...new Set(keys)].map((k) => <i key={k} className="ck-scrub-key" style={{ left: `${(k / Math.max(clip.duration, 1e-3)) * 100}%` }} aria-hidden />)}
      </div>
    </div>
  );
}

/** A value (until the Scale takes over, docs/17 Ч4): the name and the digit on one line, the track the whole width of the
 *  sheet under them (audit UI-3), 44 px to a finger; the keyframe diamond at the end of the line, 44 px (UI-9). */
export function Slider({ label, value, min, max, step = 0.01, format, onChange, reset, keyframe }: SliderProps) {
  const shown = format ? format(value) : value.toFixed(2);
  // The signal segment runs from where the value rests (its reset) to where it is now, as on the Scale.
  const frac = (v: number) => (Math.min(max, Math.max(min, v)) - min) / Math.max(max - min, 1e-9);
  const at = (v: number) => `${frac(v) * 100}%`;
  const rest = reset ?? min;
  const seg = { '--from': at(Math.min(rest, value)), '--to': at(Math.max(rest, value)), '--rest': frac(rest) } as CSSProperties;
  return (
    <div className="slider ck-slider" data-key={keyframe ? '' : undefined} style={seg}>
      <span className="ck-slider-label" onDoubleClick={() => reset !== undefined && onChange(reset)} title={reset !== undefined ? t('Double-tap to reset') : undefined}>
        {t(label)}
      </span>
      <span className="ck-slider-value" aria-hidden="true">{shown}</span>
      {keyframe && (
        <button
          className="ck-kf" data-active={keyframe.active || undefined} data-animated={keyframe.animated || undefined}
          disabled={keyframe.disabled} onClick={keyframe.toggle}
          aria-label={keyframe.active ? t('Remove {label} keyframe', { label }) : t('Add {label} keyframe', { label })}
        >
          <Diamond size={16} fill={keyframe.active ? 'currentColor' : 'none'} aria-hidden="true" />
        </button>
      )}
      {/* The white mark stands where the value rests, the signal mark where it is now, the signal segment between them
          (DESIGN.md §1, the Scale). */}
      <span className="ck-slider-track">
        <i className="ck-slider-was" aria-hidden="true" />
        <input
          className="ck-slider-input" type="range" min={min} max={max} step={step} value={value} aria-label={t(label)} aria-valuetext={shown}
          onChange={(e) => onChange(Number(e.target.value))}
        />
      </span>
    </div>
  );
}

export function Chips<T extends string | number>({ options, value, onChange, render, scroll, even, label }: {
  options: readonly T[]; value: T | null; onChange: (v: T) => void; render?: (v: T) => ReactNode;
  /** One horizontally scrolling row: every list that is not `even` is one now (Ч4 release 5: a wrapped cloud of options
   *  re-flowed as the chosen one grew bold). Kept for the callers that said so before. */
  scroll?: boolean;
  /** A few short words: one row of equal segments (weight, format, frame rate). */
  even?: boolean;
  label?: string;
}) {
  // A row that runs past the edge opens on its chosen option, wherever it is in the row.
  const row = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const r = row.current, on = r?.querySelector<HTMLElement>('[aria-checked="true"]');
    if (r && on && r.scrollWidth > r.clientWidth) r.scrollLeft = Math.max(0, on.offsetLeft - r.offsetLeft - r.clientWidth / 2 + on.offsetWidth / 2);
  }, []);
  return (
    <div ref={row} className="ck-chips" data-scroll={!even || scroll || undefined} data-even={even ? (options.length > 5 ? 'dense' : '') : undefined} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={String(o)} type="button" role="radio" aria-checked={o === value} className="chip ck-chip" onClick={() => onChange(o)}>
          {chipLabel(o, render)}
        </button>
      ))}
    </div>
  );
}

/** `note`: a second, quieter line that says what the switch does, so its name stays a name and not a sentence. */
export function Toggle({ label, value, onChange, note }: { label: string; value: boolean; onChange: (v: boolean) => void; note?: string }) {
  return (
    <label className="ck-switch-row">
      <span>{t(label)}{note && <small className="ck-switch-note">{note}</small>}</span>
      <span className="ck-switch"><input type="checkbox" role="switch" checked={value} onChange={(e) => onChange(e.target.checked)} /><i aria-hidden="true" /></span>
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
    const r = row.current, on = r?.querySelector<HTMLElement>('.swatch[aria-pressed="true"][aria-label^="#"]');
    if (r && on) r.scrollLeft = Math.max(0, on.offsetLeft - r.offsetLeft - r.clientWidth / 2);
  }, []);
  const swatch = (c: string) => (
    <button key={c} type="button" className="swatch ck-swatch" onClick={() => onChange(c)} aria-label={c} aria-pressed={c === lower}>
      <i style={{ background: c }} />
    </button>
  );
  return (
    <>
      <div ref={row} className="ck-swatches" role="group" aria-label={label}>
        <button type="button" className="swatch ck-swatch" data-tool="dropper" onClick={toggleDropper} aria-pressed={picking} aria-label={t('Eyedropper: {label}', { label })}>
          <i><Pipette size={18} /></i>
        </button>
        {/* Any colour (v1.6.2): our own spectrum with a loupe, the same on every phone, instead of the system picker. */}
        <button type="button" className="swatch custom ck-swatch" data-tool="spectrum" onClick={() => setSpectrum((o) => !o)} aria-expanded={spectrum}
          aria-label={t('Spectrum: {label}', { label })}>
          <i />
        </button>
        {BASIC_COLORS.map(swatch)}
        <span className="ck-swatch-sep" aria-hidden />
        {recent.length > 0 && <>{recent.map(swatch)}<span className="ck-swatch-sep" aria-hidden /></>}
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
/** A number as a person of the interface's language writes it: «1,25» in Russian, «1.25» in English. */
export const num = (v: number, digits = 2): string => new Intl.NumberFormat(useLocale.getState().locale === 'ru' ? 'ru-RU' : 'en-US', { maximumFractionDigits: digits }).format(v);
/** Seconds as a person reads them: «0,5 с» in Russian (audit P3-8: «0.5s» in a Russian screen). */
export const secs = (v: number): string => t('{n} s', { n: useLocale.getState().locale === 'ru' ? v.toFixed(1).replace('.', ',') : v.toFixed(1) });
