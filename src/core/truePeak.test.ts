// The true peak, between the samples (Q-31): a limiter that holds the samples at its ceiling lets the waveform pass it,
// and the AAC encoder and the player draw that waveform. A sine at a quarter of the sample rate, a quarter period off,
// has its samples at ±0.707 and its true peak at 1.
import { describe, expect, it } from 'vitest';
import { Limiter, TruePeak } from './dsp';

const SR = 48000;
const db = (v: number) => 20 * Math.log10(v);
const sine = (hz: number, phase: number, amp: number, n: number) => Float32Array.from({ length: n }, (_, i) => amp * Math.sin((2 * Math.PI * hz * i) / SR + phase));
/** Past the first 100 samples: a sine that starts at once rings in any interpolation, the measure's own edge. */
const truePeakOf = (x: Float32Array) => { const tp = new TruePeak(); let m = 0; x.forEach((v, i) => { const p = tp.next(v); if (i >= 100) m = Math.max(m, p); }); return m; };

describe('true peak', () => {
  it('finds the peak between the samples: a quarter-rate sine with its samples at −3 dB peaks at 0 dB', () => {
    const x = sine(SR / 4, Math.PI / 4, 1, 4800);
    expect(db(Math.max(...x.map(Math.abs))), 'the samples').toBeCloseTo(-3.01, 1);
    expect(db(truePeakOf(x)), 'the waveform').toBeGreaterThan(-0.2);
    expect(db(truePeakOf(x))).toBeLessThan(0.2);
  });

  it('is the sine\'s own peak at any frequency up to 16 kHz and any phase: never under it by 0.1 dB, at most 0.3 dB over', () => {
    // Under is what a limiter must not be (the waveform would pass its ceiling); over, at the top of the band, only holds
    // a little more back.
    for (const hz of [997, 5513, 11025, 16000]) for (const ph of [0, 0.3, 1.1, 2.9]) {
      const off = db(truePeakOf(sine(hz, ph, 0.5, 9600))) - db(0.5);
      expect(off, `${hz} Hz, phase ${ph}: under`).toBeGreaterThan(-0.1);
      expect(off, `${hz} Hz, phase ${ph}: over`).toBeLessThan(0.3);
    }
  });

  it('a true-peak limiter holds the waveform at its ceiling; a sample-peak one lets it 1.5 dB past (the control)', () => {
    const x = sine(SR / 4, Math.PI / 4, 1, SR); // samples −3 dBFS, true peak 0 dBTP
    const out = (truePeak: boolean) => {
      const lim = new Limiter(1, SR, 1, -1.5, undefined, undefined, truePeak);
      const y = lim.process([x])[0];
      return y.subarray(SR / 2); // past the attack
    };
    expect(db(truePeakOf(out(true))), 'true-peak limiter').toBeLessThanOrEqual(-1.45);
    expect(db(truePeakOf(out(false))), 'sample-peak limiter: the samples are under −1.5, the waveform is not').toBeGreaterThan(-0.2);
  });
});
