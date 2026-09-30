import { describe, expect, it } from 'vitest';
import { Biquad, Limiter, LoudnessMeter, normalizeGain, voiceChain } from './dsp';

const SR = 48000;
const sine = (freq: number, amp: number, seconds: number) => Float32Array.from({ length: Math.round(SR * seconds) }, (_, i) => amp * Math.sin((2 * Math.PI * freq * i) / SR));
const lufs = (x: Float32Array, windows = 7) => {
  const m = new LoudnessMeter(1, SR);
  const n = Math.ceil(x.length / windows);
  for (let i = 0; i < x.length; i += n) m.push([x.subarray(i, i + n)]); // streamed in uneven windows
  return m.integrated();
};

describe('loudness meter (BS.1770-4)', () => {
  it('1 kHz sine at -20 dBFS on one channel reads -23 LUFS', () => {
    expect(lufs(sine(1000, 0.1, 5))).toBeCloseTo(-23.01, 1);
  });
  it('is independent of window size and ignores silence gating', () => {
    const x = new Float32Array(SR * 6);
    x.set(sine(1000, 0.1, 3), SR * 3); // 3 s silence + 3 s tone
    expect(lufs(x, 3)).toBeCloseTo(-23.01, 0);
    expect(lufs(new Float32Array(SR * 2))).toBe(-Infinity);
  });
});

describe('limiter', () => {
  it('keeps every sample under the ceiling and preserves length and timing', () => {
    const x = sine(440, 0.5, 1);
    const lim = new Limiter(1, SR, 4, -1); // +12 dB into a -1 dBFS ceiling
    const parts = [x.subarray(0, 1000), x.subarray(1000, 30000), x.subarray(30000)].map((p) => lim.process([p])[0]);
    parts.push(lim.flush()[0]);
    const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { out.set(p, o); o += p.length; }
    expect(out.length).toBe(x.length);
    expect(Math.max(...out.map(Math.abs))).toBeLessThanOrEqual(10 ** (-1 / 20) + 1e-6);
    // Quiet signal passes unchanged (no delay).
    const q = sine(440, 0.05, 0.1);
    const l2 = new Limiter(1, SR);
    const y = [...l2.process([q])[0], ...l2.flush()[0]];
    expect(y.length).toBe(q.length);
    expect(Math.max(...y.map((v, i) => Math.abs(v - q[i])))).toBeLessThan(1e-6);
  });
  it('flushes correctly when the input is shorter than the lookahead', () => {
    const l = new Limiter(2, SR);
    const a = l.process([new Float32Array([0.1, 0.2]), new Float32Array([0.1, 0.2])]);
    const b = l.flush();
    expect(a[0].length + b[0].length).toBe(2);
    expect(Array.from(b[0])).toEqual([0.1, 0.2].map(Math.fround));
  });
});

describe('voice chain', () => {
  it('cuts rumble and normalizes to the target', () => {
    const hum = sine(40, 0.3, 1);
    const run = voiceChain(SR);
    run(hum);
    expect(Math.max(...hum.subarray(SR / 2).map(Math.abs))).toBeLessThan(0.1);
    expect(normalizeGain(-26, -16, 18)).toBeCloseTo(10 ** 0.5, 5);
    expect(normalizeGain(-50, -16, 18)).toBeCloseTo(10 ** (18 / 20), 5);
    expect(normalizeGain(-Infinity, -16, 18)).toBe(1);
  });
  it('rbj peaking filter at 0 dB is transparent', () => {
    const x = sine(1000, 0.5, 0.1), y = x.slice();
    Biquad.rbj('peaking', 1000, 1, 0, SR).process(y);
    expect(Math.max(...y.map((v, i) => Math.abs(v - x[i])))).toBeLessThan(1e-5);
  });
});
