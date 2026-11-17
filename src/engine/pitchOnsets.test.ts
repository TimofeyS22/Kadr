// Natural pitch at 0.5× keeps the sound on the picture (SW-A-13). The derived sound is the source shifted ×2 in pitch
// (SoundTouch) and played at half speed; SoundTouch moves onsets by up to −22 ms of source time, the playback doubles it
// (−44 ms at 0.5×, more than a frame). With the shifter's offset taken off, every onset must stay within half a frame of
// source time (16 ms), so within a frame (33 ms) on the timeline.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { pitchShifter as Make } from './audiofx';

let pitchShifter: typeof Make;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
  vi.stubGlobal('self', globalThis);
  ({ pitchShifter } = await import('./audiofx'));
}, 120_000);

const SR = 48000;
/** 30 s with a 1 kHz beep (0.1 s) at 1, 5, … 29 s, like fixtures/avsync_long.mp4. */
function beeps(): { x: Float32Array; at: number[] } {
  const x = new Float32Array(30 * SR);
  const at: number[] = [];
  for (let s = 1; s < 30; s += 4) {
    const on = s * SR;
    at.push(on);
    for (let i = 0; i < 0.1 * SR; i++) x[on + i] = 0.5 * Math.sin((2 * Math.PI * 1000 * i) / SR);
  }
  return { x, at };
}

describe('pitch shift ×2 for 0.5× with natural pitch', () => {
  it('every onset stays within 16 ms of source time (a frame at 0.5×)', async () => {
    const { x, at } = beeps();
    const sh = await pitchShifter(2, 1);
    const parts: Float32Array[] = [];
    for (let a = 0; a < x.length; a += 4096) parts.push(sh.process([x.subarray(a, a + 4096)])[0]);
    parts.push(sh.flush()[0]);
    const y = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
    let o = 0;
    for (const p of parts) { y.set(p, o); o += p.length; }
    // An onset as silencedetect at -40 dB sees it: the first 10 ms block louder than 0.01 RMS, searched the same way in the
    // source and in the shifted sound (from 0.1 s before the beep).
    const onset = (z: Float32Array, from: number) => {
      for (let i = from; i + 480 < z.length; i += 48) {
        let e = 0;
        for (let k = i; k < i + 480; k++) e += z[k] * z[k];
        if (Math.sqrt(e / 480) > 0.01) return i;
      }
      return -1;
    };
    const shifts = at.map((a) => Math.round(((onset(y, a - 0.1 * SR) - onset(x, a - 0.1 * SR)) / SR) * 1000));
    console.log(`onset shifts, ms of source time: ${shifts.join(' ')}`);
    for (const s of shifts) expect(Math.abs(s), `shifts ${shifts.join(' ')} ms`).toBeLessThanOrEqual(16);
  }, 120_000);
});
