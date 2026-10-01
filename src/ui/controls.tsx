import { Check, Diamond } from 'lucide-react';
import type { ReactNode } from 'react';
import { useEditor } from '../state/store';
import { t } from '../lib/i18n';

export function Sheet({ title, children }: { title: string; children: ReactNode }) {
  const close = () => useEditor.getState().openSheet(null);
  return (
    <section className="sheet" role="dialog" aria-label={t(title)}>
      <header className="sheet-head">
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

const SWATCHES = ['#ffffff', '#000000', '#ffc53d', '#ff5a36', '#3bd16f', '#2f9bff', '#a45bff', '#ff4fa3'];

export function Swatches({ value, onChange, label }: { value: string; onChange: (c: string) => void; label: string }) {
  return (
    <div className="swatches" aria-label={label}>
      {SWATCHES.map((c) => (
        <button key={c} className={`swatch ${c === value ? 'on' : ''}`} style={{ background: c }} onClick={() => onChange(c)} aria-label={c} />
      ))}
      <input type="color" value={value} onChange={(e) => onChange(e.target.value)} aria-label={`Custom ${label}`} />
    </div>
  );
}

/** Human labels for option ids shown as chips; every string label is translated. */
const OPTION_LABELS: Record<string, string> = {
  none: 'None', fade: 'Fade', rise: 'Rise', pop: 'Pop', typewriter: 'Typewriter', normal: 'Normal', screen: 'Screen',
  multiply: 'Multiply', add: 'Add', left: 'Left', center: 'Center', right: 'Right',
};
function chipLabel<T extends string | number>(o: T, render?: (v: T) => ReactNode): ReactNode {
  const r = render ? render(o) : typeof o === 'string' ? OPTION_LABELS[o] ?? o : String(o);
  return typeof r === 'string' ? t(r) : r;
}

export const pct = (v: number): string => `${Math.round(v * 100)}%`;
export const signed = (v: number): string => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`;
export const secs = (v: number): string => `${v.toFixed(1)}s`;
