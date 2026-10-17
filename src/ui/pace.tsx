// Progress bar for speech jobs (docs/09 Q4): stages from core/pace, expectations learned on this device.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { paceAt, type Pace, type PaceStage } from '../core/pace';
import type { AsrModel } from '../engine/captions';
import { t } from '../lib/i18n';

const KEY = 'kadr.pace';
type Learned = Record<string, number>;
const load = (): Learned => { try { return JSON.parse(localStorage.getItem(KEY) ?? '{}') as Learned; } catch { return {}; } };

/** Seconds of work per second of audio, until this device has shown its own. */
const RATE: Record<string, number> = { prepare: 0.05, listen: 0.04, 'transcribe:tiny': 0.25, 'transcribe:base': 0.6, 'transcribe:small': 2, pauses: 0.03 };
const MODEL_MB: Record<AsrModel, number> = { tiny: 41, base: 77, small: 249 };

/** The stages of a speech job over `seconds` of audio, with what this device is expected to take. */
export function speechStages(model: AsrModel, seconds: number, extra: { script?: boolean; pauses?: boolean; music?: boolean } = {}): PaceStage[] {
  const l = load();
  const rate = (k: string) => l[k] ?? RATE[k];
  return [
    // The first run downloads the model (≈ 4 MB/s); later runs load it from the browser cache.
    { id: 'model', expected: l[`model:${model}`] ?? MODEL_MB[model] / 4 },
    { id: 'prepare', expected: rate('prepare') * seconds },
    { id: 'listen', expected: rate('listen') * seconds },
    { id: 'transcribe', expected: rate(`transcribe:${model}`) * seconds },
    ...(extra.script ? [{ id: 'align', expected: 0.3 }] : []),
    ...(extra.pauses ? [{ id: 'pauses', expected: 0.3 + rate('pauses') * seconds }] : []),
    ...(extra.music ? [{ id: 'music', expected: 2.5 }] : []),
  ];
}

/** Remembers how long a finished run took, so the next bar moves at this device's pace (moving average). */
export function learnPace(model: AsrModel, seconds: number, took: Record<string, number>): void {
  if (seconds <= 0) return;
  const l = load();
  const mix = (k: string, v: number) => { l[k] = l[k] === undefined ? v : 0.6 * l[k] + 0.4 * v; };
  // The model is either downloaded or cached: the last load time is the best guess, not an average with the download.
  if (took.model !== undefined) l[`model:${model}`] = took.model;
  for (const s of ['prepare', 'listen', 'pauses'] as const) if (took[s] !== undefined) mix(s, took[s] / seconds);
  if (took.transcribe !== undefined) mix(`transcribe:${model}`, took.transcribe / seconds);
  try { localStorage.setItem(KEY, JSON.stringify(l)); } catch { /* storage blocked: the defaults stay */ }
}

/** Phase of a speech job → its stage on the bar. */
export const speechStage = (phase: 'download' | 'prepare' | 'listen' | 'transcribe'): string => (phase === 'download' ? 'model' : phase);

/** The bar itself: redrawn every frame from the pace, without re-rendering the sheet around it. */
export function PaceBar({ pace }: { pace: MutableRefObject<Pace | null> }) {
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const draw = () => {
      const p = pace.current;
      if (p && fill.current && bar.current) {
        const v = paceAt(p, performance.now());
        fill.current.style.width = `${(v * 100).toFixed(2)}%`;
        bar.current.setAttribute('aria-valuenow', v.toFixed(4));
      }
      raf = requestAnimationFrame(draw);
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, [pace]);
  return (
    <div ref={bar} className="progress" role="progressbar" aria-label={t('Progress')} aria-valuemin={0} aria-valuemax={1}>
      <div ref={fill} style={{ width: 0 }} />
    </div>
  );
}
