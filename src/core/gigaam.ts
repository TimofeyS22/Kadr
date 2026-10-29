// GigaAM v3 (Sber, MIT) speech recognition, the model-independent part (v1.4): log-mel features exactly as the
// model was trained on, and greedy CTC decoding into timed words. Mirrors onnx-asr's GigaamPreprocessorNumpy
// ('gigaam_v3') and _AsrWithCtcDecoding, which are the reference the unit tests compare with.
import type { CaptionWord } from './types';

export const GIGAAM_SR = 16000;
const N_FFT = 320, HOP = 160, MELS = 64, BINS = N_FFT / 2 + 1;
/** Seconds per model output frame: 10 ms hop × subsampling 4. */
export const GIGAAM_FRAME_S = (HOP / GIGAAM_SR) * 4;

/** Rounds to bfloat16 (nearest, ties to even): the reference Hann window and mel bank are stored that way. */
function bf16(x: number): number {
  const f = new Float32Array([x]), u = new Uint32Array(f.buffer);
  u[0] = ((u[0] + 0x7fff + ((u[0] >>> 16) & 1)) >>> 16) << 16;
  return f[0];
}

let tables: { window: Float32Array; mel: Float32Array; cos: Float64Array; sin: Float64Array } | null = null;
function getTables() {
  if (tables) return tables;
  const window = Float32Array.from({ length: N_FFT }, (_, i) => bf16(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / N_FFT)));
  // HTK mel scale, 0–8 kHz, no normalization (torchaudio melscale_fbanks), laid out [bin][mel].
  const hz2mel = (f: number) => 2595 * Math.log10(1 + f / 700), mel2hz = (m: number) => 700 * (10 ** (m / 2595) - 1);
  const fp = Array.from({ length: MELS + 2 }, (_, i) => mel2hz((hz2mel(GIGAAM_SR / 2) * i) / (MELS + 1)));
  const mel = new Float32Array(BINS * MELS);
  for (let k = 0; k < BINS; k++) {
    const f = (k * (GIGAAM_SR / 2)) / (BINS - 1);
    for (let m = 0; m < MELS; m++) {
      const down = (f - fp[m]) / (fp[m + 1] - fp[m]), up = (fp[m + 2] - f) / (fp[m + 2] - fp[m + 1]);
      mel[k * MELS + m] = bf16(Math.max(0, Math.min(down, up)));
    }
  }
  const cos = new Float64Array(BINS * N_FFT), sin = new Float64Array(BINS * N_FFT);
  for (let k = 0; k < BINS; k++) for (let n = 0; n < N_FFT; n++) {
    cos[k * N_FFT + n] = Math.cos((2 * Math.PI * k * n) / N_FFT);
    sin[k * N_FFT + n] = Math.sin((2 * Math.PI * k * n) / N_FFT);
  }
  return (tables = { window, mel, cos, sin });
}

/** Log-mel features of 16 kHz mono audio: [64 × frames] (mel-major, as the model takes them), no centering. */
export function gigaamFeatures(audio: Float32Array): { data: Float32Array; frames: number } {
  const { window, mel, cos, sin } = getTables();
  const frames = Math.max(0, Math.floor((audio.length - N_FFT) / HOP) + 1);
  const data = new Float32Array(MELS * frames);
  const x = new Float64Array(N_FFT), power = new Float64Array(BINS);
  for (let t = 0; t < frames; t++) {
    for (let n = 0; n < N_FFT; n++) x[n] = audio[t * HOP + n] * window[n];
    for (let k = 0; k < BINS; k++) {
      let re = 0, im = 0;
      for (let n = 0, o = k * N_FFT; n < N_FFT; n++) { re += x[n] * cos[o + n]; im += x[n] * sin[o + n]; }
      power[k] = re * re + im * im;
    }
    for (let m = 0; m < MELS; m++) {
      let e = 0;
      for (let k = 0; k < BINS; k++) e += power[k] * mel[k * MELS + m];
      data[m * frames + t] = Math.log(Math.min(1e9, Math.max(1e-9, e)));
    }
  }
  return { data, frames };
}

export interface CtcVocab { tokens: string[]; blank: number }

/** The model's vocab file: "<token> <id>" per line; "▁" starts a word; the blank is "<blk>" (else one past the end). */
export function parseCtcVocab(text: string): CtcVocab {
  const tokens: string[] = [];
  let blank = -1;
  for (const line of text.split('\n')) {
    const i = line.lastIndexOf(' ');
    if (i <= 0) continue;
    const token = line.slice(0, i), id = Number(line.slice(i + 1));
    tokens[id] = token;
    if (token === '<blk>') blank = id;
  }
  return { tokens, blank: blank >= 0 ? blank : tokens.length };
}

export interface CtcResult {
  /** Words in seconds from the start of the audio: from the first frame of a word to one frame past its last. */
  words: CaptionWord[];
  /** Mean probability of the emitted tokens' frames (1 = sure); low on speech in another language. */
  confidence: number;
  /** Letters and digits recognized: next to the confidence, tells speech the model understood from noise. */
  chars: number;
}

const hasText = (s: string) => /[\p{L}\p{N}]/u.test(s);

/** Greedy CTC over log-probabilities [frames × classes]: repeats collapse, blanks separate. `frameS`: seconds per frame. */
export function ctcDecode(logProbs: Float32Array, frames: number, classes: number, vocab: CtcVocab, frameS = GIGAAM_FRAME_S): CtcResult {
  const words: CaptionWord[] = [];
  let cur: CaptionWord | null = null;
  let prev = vocab.blank, sum = 0, emitted = 0, chars = 0;
  const finish = () => {
    if (!cur) return;
    // A word of punctuation only (a lone "▁" before a comma) belongs to the word before it.
    if (!hasText(cur.text) && words.length) { const last = words[words.length - 1]; last.text += cur.text; last.t1 = cur.t1; }
    else if (cur.text) words.push(cur);
    cur = null;
  };
  for (let t = 0; t < frames; t++) {
    let best = 0, bv = -Infinity;
    for (let c = 0, o = t * classes; c < classes; c++) if (logProbs[o + c] > bv) { bv = logProbs[o + c]; best = c; }
    if (best !== vocab.blank) {
      sum += bv; emitted++;
      if (best !== prev) {
        const token = vocab.tokens[best] ?? '';
        const piece = token.replace(/^▁/, '');
        chars += piece.replace(/[^\p{L}\p{N}]/gu, '').length;
        if (token.startsWith('▁') || !cur) { finish(); cur = { t0: t * frameS, t1: (t + 1) * frameS, text: piece }; }
        else { cur.text += piece; cur.t1 = (t + 1) * frameS; }
      } else if (cur) cur.t1 = (t + 1) * frameS;
    }
    prev = best;
  }
  finish();
  return { words, confidence: emitted ? Math.exp(sum / emitted) : 0, chars };
}
