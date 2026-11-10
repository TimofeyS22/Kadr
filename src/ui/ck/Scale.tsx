// The Scale (DESIGN.md §1): one strip sets any number. The white mark stands on the value it was, the signal needle on
// the value it is; the whole strip is the handle. A drag moves it, a tap brings the tapped tick under the needle, the
// two buttons at its ends and the keyboard move it by one step (WCAG 2.5.7: no value needs a drag, and one step can
// always be taken exactly). The digit is soft while the value moves and sharp when it rests. The maths is in core/scale.ts.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { dragTo, keyTo, offsetPx, quantize, segment, tapTo, ticks, type ScaleSpec } from '../../core/scale';

interface Props {
  /** What is being set, for a screen reader: «Экспозиция». */
  label: string;
  spec: ScaleSpec;
  value: number;
  /** The value as a person reads it: «+35», «1,5×». Keep it the same function between renders: the ticks are drawn once. */
  format: (v: number) => string;
  /** Values that carry a number under their tick. */
  labels: number[];
  onChange: (v: number) => void;
  /**
   * A change is finished: what it was and what it became — one step of undo. A drag and a tap report once, when the
   * finger is lifted. Steps (keys, the two buttons) report each time; `more` is true when a step follows the previous
   * one closely, and then it belongs to the same step of undo.
   */
  onCommit?: (from: number, to: number, more: boolean) => void;
  /** To the left and to the right of the digit: «Сбросить», «До и после». */
  before?: ReactNode;
  after?: ReactNode;
  /** The buttons that take one step down and up, with their names for a screen reader: «Меньше», «Больше». */
  stepDown: { label: string; icon: ReactNode };
  stepUp: { label: string; icon: ReactNode };
  disabled?: boolean;
}

const SLOP = 4; // px a finger may wander and still be a tap
const RUN = 700; // ms: steps closer together than this are one run, one step of undo

export function Scale({ label, spec, value, format, labels, onChange, onCommit, before, after, stepDown, stepUp, disabled }: Props) {
  const [moving, setMoving] = useState(false);
  const [held, setHeld] = useState(false);
  const gesture = useRef<{ id: number; x: number; from: number; moved: boolean; held: boolean; last: number } | null>(null);
  const run = useRef<{ from: number; to: number; at: number } | null>(null);
  const pulseTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(pulseTimer.current), []);
  const seg = segment(spec, value);
  // Ticks and their numbers do not change while a value is dragged: only the shift of the strip does.
  const drawn = useMemo(() => (
    <>
      {ticks(spec).map((m) => <i key={m.at} className={m.major ? 'ck-tick ck-major' : 'ck-tick'} style={{ left: offsetPx(spec, m.at) }} />)}
      {labels.map((v) => <span key={v} className="ck-tick-label" style={{ left: offsetPx(spec, v) }}>{format(v)}</span>)}
    </>
  ), [spec, labels, format]);

  const pulse = () => { setHeld(true); window.clearTimeout(pulseTimer.current); pulseTimer.current = window.setTimeout(() => setHeld(false), 140); };
  /** One step from the keyboard or a button. */
  const stepTo = (to: number, now: number) => {
    if (to === value) return;
    // The same run only if the value is still where the run left it: a reset or an undo in between starts a new one.
    const more = !!run.current && run.current.to === value && now - run.current.at < RUN;
    run.current = { from: more && run.current ? run.current.from : value, to, at: now };
    onChange(to);
    onCommit?.(run.current.from, to, more);
  };

  const down = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || gesture.current) return; // a second finger does not take the strip from the first
    run.current = null;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* a pointer that is already gone: the gesture ends by itself */ }
    gesture.current = { id: e.pointerId, x: e.clientX, from: value, moved: false, held: value === spec.rest, last: value };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    const dx = e.clientX - g.x;
    if (!g.moved && Math.abs(dx) < SLOP) return;
    if (!g.moved) { g.moved = true; setMoving(true); }
    const next = dragTo(spec, g.from, dx);
    if (next.held && !g.held) pulse();
    g.held = next.held;
    if (next.value !== g.last) { g.last = next.value; onChange(next.value); }
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g || e.pointerId !== g.id) return;
    gesture.current = null;
    setMoving(false);
    if (e.type !== 'pointerup') { // the system took the gesture (a scroll, an edge swipe): nothing is set by half
      if (g.last !== g.from) onChange(g.from);
      return;
    }
    let to = g.last;
    if (!g.moved) {
      const box = e.currentTarget.getBoundingClientRect();
      to = tapTo(spec, g.from, e.clientX - (box.left + box.width / 2));
      if (to !== g.from) onChange(to);
    }
    if (to !== g.from) onCommit?.(g.from, to, false);
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const to = keyTo(spec, value, e.key);
    if (to === null) return;
    e.preventDefault();
    stepTo(to, e.timeStamp);
  };

  return (
    <div className="ck-scale" data-moving={moving} data-held={held} data-disabled={disabled || undefined}>
      <div className="ck-scale-head">
        <span className="ck-scale-side">{before}</span>
        <output className="ck-digit" data-moving={moving} aria-hidden="true">{format(value)}</output>
        <span className="ck-scale-side ck-end">{after}</span>
      </div>
      <div className="ck-scale-row">
        <button type="button" className="ck-ib ck-scale-step" aria-label={stepDown.label} disabled={disabled || value <= spec.min}
          onClick={(e) => stepTo(quantize(spec, value - spec.step), e.timeStamp)}>{stepDown.icon}</button>
        <div className="ck-scale-strip" role="slider" tabIndex={disabled ? -1 : 0} aria-label={label} aria-disabled={disabled || undefined}
          aria-valuemin={spec.min} aria-valuemax={spec.max} aria-valuenow={value} aria-valuetext={format(value)} aria-orientation="horizontal"
          onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up} onKeyDown={key}>
          <div className="ck-ticks" style={{ transform: `translateX(${-offsetPx(spec, value)}px)` }}>
            {drawn}
            <i className="ck-seg" style={{ left: seg.left, width: seg.width }} />
            <i className="ck-was" style={{ left: offsetPx(spec, spec.rest) }} />
          </div>
          <i className="ck-needle" />
        </div>
        <button type="button" className="ck-ib ck-scale-step" aria-label={stepUp.label} disabled={disabled || value >= spec.max}
          onClick={(e) => stepTo(quantize(spec, value + spec.step), e.timeStamp)}>{stepUp.icon}</button>
      </div>
    </div>
  );
}
