import { describe, expect, it } from 'vitest';
import { createAudioClip } from './defaults';
import { Biquad } from './dsp';
import { expectedAudioKey } from './timeline';
import type { Asset } from './types';
import { VOICE_IDS, voiceStages, type VoiceId } from './voicefx';

const SR = 48000;
const sine = (f: number, s: number, a = 0.1) => Float32Array.from({ length: Math.round(s * SR) }, (_, i) => a * Math.sin((2 * Math.PI * f * i) / SR));
const run = (id: VoiceId, x: Float32Array) => { const y = x.slice(); for (const s of voiceStages(id, SR)) s.process(y); return y; };
/** RMS after the first 0.2 s (filters settle). */
const rms = (x: Float32Array) => { let s = 0; const a = Math.round(0.2 * SR); for (let i = a; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / (x.length - a)); };
const db = (a: number, b: number) => 20 * Math.log10(a / b);
const peak = (x: Float32Array) => { let m = 0; for (const v of x) m = Math.max(m, Math.abs(v)); return m; };
let seed = 1;
const noise = (s: number) => Float32Array.from({ length: Math.round(s * SR) }, () => { seed = (seed * 16807) % 2147483647; return (seed / 2147483647 - 0.5) * 0.5; });

describe('voice effects (docs/09 V1)', () => {
  it('telephone keeps the voice band and cuts above it by ≥ 20 dB', () => {
    expect(db(rms(run('telephone', sine(6000, 1))), rms(run('telephone', sine(1000, 1))))).toBeLessThan(-20);
    expect(db(rms(run('telephone', sine(100, 1))), rms(run('telephone', sine(1000, 1))))).toBeLessThan(-12);
  });

  it('telephone on broadband sound: the share above 4 kHz drops ≥ 20 dB (distortion does not refill it)', () => {
    const hi = (x: Float32Array) => { const y = x.slice(); for (let k = 0; k < 2; k++) Biquad.rbj('highpass', 4000, Math.SQRT1_2, 0, SR).process(y); return y; };
    const share = (x: Float32Array) => db(rms(hi(x)), rms(x));
    const x = noise(2);
    expect(share(x) - share(run('telephone', x))).toBeGreaterThan(20);
  });

  it('underwater muffles: 3 kHz is ≥ 20 dB below 300 Hz', () => {
    expect(db(rms(run('underwater', sine(3000, 1))), rms(run('underwater', sine(300, 1))))).toBeLessThan(-20);
  });

  it('echo repeats a click 0.28 s later at half level', () => {
    const x = new Float32Array(SR);
    x[0] = 1;
    const y = run('echo', x);
    const at = Math.round(0.28 * SR);
    expect(y[at]).toBeCloseTo(0.5, 2);
    expect(Math.abs(y[at - 50])).toBeLessThan(1e-6);
  });

  it('halls leave a decaying tail and never run away', () => {
    for (const id of ['hall', 'cathedral'] as const) {
      const x = new Float32Array(5 * SR);
      x[0] = 1;
      const y = run(id, x);
      const energy = (a: number, b: number) => { let s = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) s += y[i] * y[i]; return s; };
      expect(energy(0.05, 1), id).toBeGreaterThan(1e-4);
      expect(energy(3, 5), id).toBeLessThan(energy(0.05, 1));
      expect(peak(y), id).toBeLessThan(2);
    }
  });

  it('every voice is seamless across processing windows and stays finite on noise', () => {
    const x = noise(1.5);
    for (const id of VOICE_IDS) {
      const whole = run(id, x);
      const stages = voiceStages(id, SR);
      const parts = x.slice();
      for (let a = 0, n = 977; a < parts.length; a += n, n = (n * 7) % 5003 + 300) {
        const part = parts.subarray(a, Math.min(parts.length, a + n));
        for (const s of stages) s.process(part);
      }
      for (let i = 0; i < x.length; i += 997) expect(parts[i], `${id} at ${i}`).toBeCloseTo(whole[i], 6);
      expect(whole.every(Number.isFinite), id).toBe(true);
      expect(peak(whole), id).toBeLessThan(4); // the limiter after takes it to −1 dBFS
    }
  });

  it('robot changes the voice but keeps its level in range', () => {
    const x = sine(220, 1);
    const y = run('robot', x);
    expect(Math.abs(db(rms(y), rms(x)))).toBeLessThan(12);
    let diff = 0;
    for (let i = 0; i < x.length; i++) diff += Math.abs(y[i] - x[i]);
    expect(diff / x.length).toBeGreaterThan(0.02);
  });

  it('the sound key carries the voice between clean-up and natural pitch, and the sync version', () => {
    const a: Asset = { id: 'a', name: 'a', mime: 'audio/mp4', size: 1, kind: 'audio', duration: 5, width: 0, height: 0, hasAudio: true };
    const c = { ...createAudioClip(a), enhance: true, speed: 1.5 };
    expect(expectedAudioKey(c)).toBe('ep1.5~2'); // v1.1's 'ep1.5' (44 ms late) no longer matches: it is rebuilt
    expect(expectedAudioKey({ ...c, voice: 'robot' })).toBe('evrobotp1.5~2');
    expect(expectedAudioKey({ ...c, enhance: false, speed: 1, voice: 'echo' })).toBe('vecho~2');
    expect(expectedAudioKey({ ...c, enhance: false, speed: 1 })).toBe(''); // nothing to process: the source plays
  });
});

