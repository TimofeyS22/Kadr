// Speed curve editor: drag points up/down on a log scale (0.1×–10×). Keyboard: focus a point, arrows adjust.
import { useRef, useState } from 'react';
import { CURVE_POINTS, MAX_RATE, MIN_RATE, clampRate, subCurve } from '../core/speed';
import { t } from '../lib/i18n';
import { num } from './controls';
import './detail.css';

/** GUT: a column of its own at the right for 10×, 1× and 0.1×, so the last point never covers a label (Ч4 release 11). */
const W = 320, H = 132, PAD = 14, GUT = 32;
const yOf = (v: number) => PAD + (1 - (Math.log10(v) + 1) / 2) * (H - 2 * PAD);
const vOf = (y: number) => clampRate(10 ** ((1 - (y - PAD) / (H - 2 * PAD)) * 2 - 1));
const xOf = (i: number, n: number) => PAD + (i / (n - 1)) * (W - 2 * PAD - GUT);

export function CurveEditor({ points, onChange }: { points: number[]; onChange: (p: number[]) => void }) {
  const pts = points.length === CURVE_POINTS ? points : subCurve(points, 0, 1);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);

  const setAt = (i: number, v: number) => {
    const next = [...pts];
    next[i] = Math.round(clampRate(v) * 100) / 100;
    onChange(next);
  };
  const [held, setHeld] = useState<number | null>(null);
  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    setAt(drag.current, vOf(((e.clientY - r.top) / r.height) * H));
  };
  /** A finger anywhere in a point's column takes that point (a dot alone is 19 px, under the 44 of DESIGN.md §2.5);
   *  the value changes only as the finger moves, so a tap changes nothing. */
  const down = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    for (let i = 1; i < pts.length; i++) if (Math.abs(xOf(i, pts.length) - x) < Math.abs(xOf(best, pts.length) - x)) best = i;
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* the pointer is gone */ }
    drag.current = best;
    setHeld(best);
  };
  const up = () => { drag.current = null; setHeld(null); };

  return (
    <svg ref={svg} className="curve ck-curve" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('Speed curve')}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
      {[MAX_RATE, 1, MIN_RATE].map((v) => (
        <g key={v}>
          <line x1={PAD} x2={W - GUT} y1={yOf(v)} y2={yOf(v)} className={v === 1 ? 'curve-one ck-curve-one' : 'curve-grid ck-curve-grid'} />
          <text x={W - 4} y={yOf(v) + 4} textAnchor="end" className="curve-label ck-curve-label">{num(v)}×</text>
        </g>
      ))}
      <polyline className="curve-line ck-curve-line" points={pts.map((v, i) => `${xOf(i, pts.length)},${yOf(v)}`).join(' ')} />
      {pts.map((v, i) => (
        <circle key={i} cx={xOf(i, pts.length)} cy={yOf(v)} r={9} className="curve-dot ck-curve-dot" tabIndex={0}
          role="slider" aria-label={t('Speed at point {n}', { n: i + 1 })} aria-valuemin={MIN_RATE} aria-valuemax={MAX_RATE} aria-valuenow={v} aria-valuetext={`${num(v)}×`}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setAt(i, v * (e.key === 'ArrowUp' ? 1.1 : 1 / 1.1)); }
          }} />
      ))}
      {/* The value of the point held, by it, in the signal colour of a value's digit (DESIGN.md §2.2). */}
      {held !== null && (
        <text className="ck-curve-value" x={Math.min(W - GUT - 4, Math.max(PAD + 4, xOf(held, pts.length)))} y={Math.max(PAD + 10, yOf(pts[held]) - 14)}
          textAnchor={held === 0 ? 'start' : held === pts.length - 1 ? 'end' : 'middle'}>{num(pts[held])}×</text>
      )}
    </svg>
  );
}
