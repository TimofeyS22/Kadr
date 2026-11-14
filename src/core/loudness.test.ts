// «Even loudness» is −14 LUFS as the file comes out of the limiter, not before it (SW-D-5, docs/03 AC: I = −14 ± 1,
// peak ≤ −0.9 dBFS). A 120 BPM beat at +6 dB came out at −18.4 LUFS: the gain was measured before the −1 dBFS limiter,
// and on peaks 21 dB above the loudness the limiter took most of it back.
import { describe, expect, it } from 'vitest';
import { Limiter, LoudnessMeter, limitedGain } from './dsp';

const SR = 48000;
/** A click every 0.5 s (80 Hz dying in ~40 ms, at `amp`) over a faint hiss: peaks far above the loudness, like beat120.m4a. */
function beat(seconds: number, decay = 25, amp = 0.98, hiss = 0.01): Float32Array {
  const x = new Float32Array(SR * seconds);
  let s = 1;
  for (let i = 0; i < x.length; i++) {
    const t = (i % (SR / 2)) / SR;
    s = (s * 1664525 + 1013904223) >>> 0;
    x[i] = Math.exp(-t * decay) * Math.sin(2 * Math.PI * 80 * t) * amp + (s / 2 ** 32 - 0.5) * hiss;
  }
  return x;
}
/** The sound through the limiter at `gain`, measured. */
function out(x: Float32Array, gain: number) {
  const lim = new Limiter(2, SR, gain, -1);
  const m = new LoudnessMeter(2, SR);
  let peak = 0;
  for (let i = 0; i < x.length; i += SR * 2) {
    const w = x.subarray(i, i + SR * 2);
    const y = lim.process([w, w]);
    m.push(y);
    for (const v of y[0]) peak = Math.max(peak, Math.abs(v));
  }
  const tail = lim.flush();
  m.push(tail);
  return { lufs: m.integrated(), peak: 20 * Math.log10(peak) };
}
/** `x` fed to the search window by window, as the export renders its mix. */
const passes = (x: Float32Array) => { let n = 0; return { count: () => n, pass: async (each: (c: Float32Array[]) => void) => { n++; for (let i = 0; i < x.length; i += SR * 10) { const w = x.subarray(i, i + SR * 10); each([w.slice(), w.slice()]); } } }; };

describe('even loudness through the limiter', { timeout: 60_000 }, () => {
  it('a beat with peaks far above its loudness comes out at −14 ± 1 LUFS, no sample above −1 dBFS', async () => {
    const x = beat(20);
    const g = await limitedGain(passes(x).pass, 2, SR, -14, 12);
    const r = out(x, g);
    expect(Math.abs(r.lufs + 14), `${r.lufs.toFixed(2)} LUFS at ${(20 * Math.log10(g)).toFixed(1)} dB`).toBeLessThan(1);
    expect(r.peak).toBeLessThanOrEqual(-0.99);
  });
  it('where −14 is out of reach within the +12 dB cap, the file is as loud as the cap allows, louder than before', async () => {
    const x = beat(20, 30, 0.6, 0.004); // −20.9 LUFS, peaks at −4.4 dBFS
    const g = await limitedGain(passes(x).pass, 2, SR, -14, 12);
    expect(20 * Math.log10(g)).toBeCloseTo(12, 6);
    const before = out(x, 10 ** (6.94 / 20)).lufs; // the gain measured before the limiter: −16.3 LUFS
    expect(out(x, g).lufs).toBeGreaterThan(before + 0.4);
  });
  it('a steady tone the limiter leaves alone takes one pass, and the plain gain', async () => {
    const x = Float32Array.from({ length: SR * 5 }, (_, i) => 0.05 * Math.sin((2 * Math.PI * 1000 * i) / SR));
    const feed = passes(x);
    const g = await limitedGain(feed.pass, 2, SR, -14, 12);
    expect(feed.count()).toBe(1);
    expect(Math.abs(out(x, g).lufs + 14)).toBeLessThan(0.2);
  });
  it('silence is left as it is; the boost never passes the cap', async () => {
    expect(await limitedGain(passes(new Float32Array(SR * 2)).pass, 2, SR, -14, 12)).toBe(1);
    const quiet = beat(10).map((v) => v * 0.001);
    expect(20 * Math.log10(await limitedGain(passes(quiet).pass, 2, SR, -14, 12))).toBeLessThanOrEqual(12 + 1e-9);
  });
});
