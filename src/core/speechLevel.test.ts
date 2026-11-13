import { describe, expect, it } from 'vitest';
import { liftGain } from './speechLevel';

const SR = 16000;
const speech = (level: number, n = SR) => Float32Array.from({ length: n }, (_, i) => Math.sin(i * 0.1) * level);
/** Speech for a second, then four seconds of near silence: most of a video is not speech. */
const sparse = (level: number) => { const x = new Float32Array(SR * 5); x.set(speech(level)); return x; };

describe('the level of speech for the models (docs/20 ADR-С7)', () => {
  it('lifts a quiet recording by its loud moments, not by the silence round them', () => {
    const quiet = sparse(0.01); // speech at −43 dBFS RMS
    const g = liftGain(quiet, SR);
    expect(g).toBeGreaterThan(10);
    expect(g).toBeLessThanOrEqual(16);
    expect(0.01 * Math.SQRT1_2 * g).toBeCloseTo(0.1, 1);
  });
  it('leaves a recording at a normal level exactly as it was', () => {
    expect(liftGain(sparse(0.2), SR)).toBe(1);
    expect(liftGain(sparse(0.9), SR)).toBe(1);
  });
  it('does not lift into clipping, and leaves silence and nothing alone', () => {
    const click = sparse(0.01);
    click[SR * 3] = 0.9;
    expect(0.9 * liftGain(click, SR)).toBeLessThanOrEqual(0.98 + 1e-6);
    expect(liftGain(new Float32Array(SR * 2), SR)).toBe(1);
    expect(liftGain(new Float32Array(0), SR)).toBe(1);
  });
});
