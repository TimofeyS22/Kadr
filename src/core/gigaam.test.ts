import { describe, expect, it } from 'vitest';
import { GIGAAM_FRAME_S, ctcDecode, gigaamFeatures, parseCtcVocab } from './gigaam';

describe('GigaAM features', () => {
  it('match the reference preprocessor (onnx-asr gigaam_v3) to 1e-3', () => {
    const x = Float32Array.from({ length: 1600 }, (_, i) => 0.5 * Math.sin((2 * Math.PI * 440 * i) / 16000) + 0.1 * Math.sin((2 * Math.PI * 3000 * i) / 16000));
    const { data, frames } = gigaamFeatures(x);
    expect(frames).toBe(9);
    // [mel, frame] → value, computed by onnx_asr.preprocessors.numpy_preprocessor.GigaamPreprocessorNumpy('gigaam_v3').
    const ref: [number, number, number][] = [[0, 0, -9.18102], [5, 0, -6.11349], [10, 3, 5.45951], [25, 5, -10.52658], [40, 8, -9.40218], [63, 4, -8.81761]];
    for (const [m, t, v] of ref) expect(data[m * frames + t]).toBeCloseTo(v, 3);
  });

  it('give no frames for audio shorter than one window', () => {
    expect(gigaamFeatures(new Float32Array(100)).frames).toBe(0);
  });
});

describe('CTC decoding', () => {
  const vocab = parseCtcVocab('<unk> 0\n▁ 1\n, 2\n▁при 3\nвет 4\n▁мир 5\n<blk> 6\n');
  /** Log-probs where each frame is sure of one class. */
  const frames = (ids: number[]) => {
    const lp = new Float32Array(ids.length * 7).fill(-20);
    ids.forEach((c, t) => { lp[t * 7 + c] = -0.01; });
    return lp;
  };

  it('reads the vocab and its blank', () => {
    expect(vocab.blank).toBe(6);
    expect(vocab.tokens[3]).toBe('▁при');
  });

  it('collapses repeats, drops blanks and joins pieces into timed words', () => {
    const ids = [6, 3, 3, 6, 4, 2, 6, 6, 5, 5, 6];
    const r = ctcDecode(frames(ids), ids.length, 7, vocab);
    expect(r.words.map((w) => w.text)).toEqual(['привет,', 'мир']);
    expect(r.words[0].t0).toBeCloseTo(1 * GIGAAM_FRAME_S);
    expect(r.words[0].t1).toBeCloseTo(6 * GIGAAM_FRAME_S);
    expect(r.words[1].t0).toBeCloseTo(8 * GIGAAM_FRAME_S);
    expect(r.words[1].t1).toBeCloseTo(10 * GIGAAM_FRAME_S);
    expect(r.chars).toBe(9);
    expect(r.confidence).toBeGreaterThan(0.98);
  });

  it('a repeated token after a blank is a new token, not a repeat', () => {
    const ids = [5, 6, 5];
    expect(ctcDecode(frames(ids), 3, 7, vocab).words.map((w) => w.text)).toEqual(['мир', 'мир']);
  });

  it('punctuation after a lone word start sticks to the word before', () => {
    const ids = [5, 6, 1, 2];
    expect(ctcDecode(frames(ids), 4, 7, vocab).words.map((w) => w.text)).toEqual(['мир,']);
  });

  it('silence gives no words and zero confidence', () => {
    const r = ctcDecode(frames([6, 6, 6]), 3, 7, vocab);
    expect(r.words).toEqual([]);
    expect(r.confidence).toBe(0);
  });
});
