import { describe, expect, it } from 'vitest';
import { NEMO_FRAME_S, nemoFeatures } from './fastconformer';
import { ctcDecode, parseCtcVocab } from './gigaam';

describe('FastConformer features (docs/12 §6.3)', () => {
  it('match the reference preprocessor (onnx-asr nemo80.onnx) to 1e-4', () => {
    const x = Float32Array.from({ length: 1600 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000) + 0.1 * Math.sin((2 * Math.PI * 3000 * i) / 16000));
    const { data, frames, length } = nemoFeatures(x);
    expect([frames, length]).toEqual([11, 10]);
    // [mel, frame] → value, from onnx_asr's nemo80.onnx run on the same signal (onnxruntime, 2026-10-29).
    const ref: [number, number, number][] = [[0, 0, 2.15332], [5, 1, 0.41382], [10, 3, 0.31552], [25, 5, -0.58252], [40, 8, -0.57249], [79, 4, -0.54287], [30, 9, 0.9886], [12, 10, 0]];
    for (const [m, t, v] of ref) expect(data[m * frames + t]).toBeCloseTo(v, 4);
  });

  it('give silence-only frames nothing to divide by zero over', () => {
    const { data } = nemoFeatures(new Float32Array(16000));
    expect(data.every(Number.isFinite)).toBe(true);
  });

  it('time words by the 80 ms frame', () => {
    const vocab = parseCtcVocab('<unk> 0\n▁при 1\nвет 2\n<blk> 3\n');
    const lp = new Float32Array(4 * 4).fill(-20);
    [1, 2, 3, 3].forEach((c, t) => { lp[t * 4 + c] = -0.01; });
    const r = ctcDecode(lp, 4, 4, vocab, NEMO_FRAME_S);
    expect(r.words).toEqual([{ t0: 0, t1: expect.closeTo(0.16, 6), text: 'привет' }]);
  });
});
