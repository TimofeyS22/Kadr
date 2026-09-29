// Speed curve editor: drag points up/down on a log scale (0.1×–10×). Keyboard: focus a point, arrows adjust.
import { useRef } from 'react';
import { CURVE_POINTS, MAX_RATE, MIN_RATE, clampRate, subCurve } from '../core/speed';
import { t } from './i18n';

const W = 320, H = 132, PAD = 14;
const yOf = (v: number) => PAD + (1 - (Math.log10(v) + 1) / 2) * (H - 2 * PAD);
const vOf = (y: number) => clampRate(10 ** ((1 - (y - PAD) / (H - 2 * PAD)) * 2 - 1));
const xOf = (i: number, n: number) => PAD + (i / (n - 1)) * (W - 2 * PAD);

export function CurveEditor({ points, onChange }: { points: number[]; onChange: (p: number[]) => void }) {
  const pts = points.length === CURVE_POINTS ? points : subCurve(points, 0, 1);
  const svg = useRef<SVGSVGElement>(null);
  const drag = useRef<number | null>(null);

  const setAt = (i: number, v: number) => {
    const next = [...pts];
    next[i] = Math.round(clampRate(v) * 100) / 100;
    onChange(next);
  };
  const move = (e: React.PointerEvent) => {
    if (drag.current === null || !svg.current) return;
    const r = svg.current.getBoundingClientRect();
    setAt(drag.current, vOf(((e.clientY - r.top) / r.height) * H));
  };

  return (
    <svg ref={svg} className="curve" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={t('Speed curve')}
      onPointerMove={move} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
      {[MAX_RATE, 1, MIN_RATE].map((v) => (
        <g key={v}>
          <line x1={PAD} x2={W - PAD} y1={yOf(v)} y2={yOf(v)} className={v === 1 ? 'curve-one' : 'curve-grid'} />
          <text x={W - PAD} y={yOf(v) - 3} textAnchor="end" className="curve-label">{v}×</text>
        </g>
      ))}
      <polyline className="curve-line" points={pts.map((v, i) => `${xOf(i, pts.length)},${yOf(v)}`).join(' ')} />
      {pts.map((v, i) => (
        <circle key={i} cx={xOf(i, pts.length)} cy={yOf(v)} r={9} className="curve-dot" tabIndex={0}
          role="slider" aria-label={`Speed at point ${i + 1}`} aria-valuemin={MIN_RATE} aria-valuemax={MAX_RATE} aria-valuenow={v}
          onPointerDown={(e) => { (e.target as Element).setPointerCapture(e.pointerId); drag.current = i; }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); setAt(i, v * (e.key === 'ArrowUp' ? 1.1 : 1 / 1.1)); }
          }} />
      ))}
    </svg>
  );
}
