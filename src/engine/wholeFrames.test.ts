// Sound reaches the encoder in whole frames, nothing lost, nothing moved (SW-A-14).
import { describe, expect, it } from 'vitest';
import { FRAME_GRAIN, WholeFrames, encoderPieces, pieceLimit } from './wholeFrames';

const ramp = (from: number, n: number) => Float32Array.from({ length: n }, (_, i) => from + i);

describe('sound in whole codec frames', () => {
  it('pieces of any length come out in whole AAC and Opus frames, every sample once, in order; the tail at the end', () => {
    const w = new WholeFrames(2);
    const out: number[] = [];
    let next = 0;
    for (const n of [96_000 - 2112, 96_000, 1, 15_359, 1023, 96_000, 777]) {
      const piece = w.push([ramp(next, n), ramp(next, n).map((v) => -v)]);
      next += n;
      if (piece) {
        expect(piece[0].length % 1024, 'whole AAC frames').toBe(0);
        expect(piece[0].length % 960, 'whole Opus frames').toBe(0);
        expect(piece[1].every((v, i) => v === -piece[0][i]), 'the channels stay together').toBe(true);
        out.push(...piece[0]);
      }
    }
    const tail = w.flush()!;
    expect(tail[0].length).toBeLessThan(FRAME_GRAIN);
    out.push(...tail[0]);
    expect(out.length).toBe(next);
    expect(out.every((v, i) => v === i)).toBe(true);
    expect(w.flush()).toBeNull();
  });

  it('a long piece goes to Mediabunny in parts it does not cut again: whole frames, under 240 000 samples over all channels', () => {
    for (const channels of [1, 2]) {
      const limit = pieceLimit(channels);
      expect(limit * channels, `${channels} channels: under AudioSample._fromAudioBuffer's 240 000`).toBeLessThanOrEqual(240_000);
      expect(limit % FRAME_GRAIN, 'whole grains').toBe(0);
      const n = 10 * FRAME_GRAIN * 7; // 10 s windows and more
      const chans = Array.from({ length: channels }, (_, c) => ramp(c * 1e7, n));
      const parts = [...encoderPieces(chans)];
      const seen: number[] = [];
      for (const p of parts) {
        expect(p[0].length).toBeLessThanOrEqual(limit);
        expect(p[0].length % 1024, 'whole AAC frames').toBe(0);
        expect(p.length).toBe(channels);
        for (const v of p[0]) seen.push(v);
      }
      expect(seen.length).toBe(n);
      expect(seen.every((v, i) => v === i)).toBe(true);
    }
  });
});
