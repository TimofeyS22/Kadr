// FastConformer Hybrid Large RU P&C (NVIDIA, CC BY 4.0; int8 ONNX export by istupakov), the model-independent part:
// the compact Russian model for phones (docs/12 §6.3), 131 MB against GigaAM's 225 MB. Features exactly as NeMo's
// AudioToMelSpectrogramPreprocessor makes them (80 log-mel bands, per-feature normalization), mirroring onnx-asr's
// NemoPreprocessorNumpy, which with its nemo80.onnx is the reference the unit tests compare with. Decoding is the
// same greedy CTC as GigaAM's (core/gigaam.ts), with this model's 80 ms frame.

export const NEMO_SR = 16000;
const N_FFT = 512, WIN = 400, HOP = 160, MELS = 80, BINS = N_FFT / 2 + 1;
const PREEMPH = 0.97, LOG_GUARD = 2 ** -24;
/** Seconds per model output frame: 10 ms hop × subsampling 8. */
export const NEMO_FRAME_S = (HOP / NEMO_SR) * 8;

let tables: { window: Float64Array; mel: Float64Array; cos: Float64Array; sin: Float64Array; rev: Uint16Array } | null = null;
function getTables() {
  if (tables) return tables;
  // np.hanning(400) (symmetric), centred in the 512-sample frame.
  const window = new Float64Array(N_FFT);
  for (let n = 0; n < WIN; n++) window[(N_FFT - WIN) / 2 + n] = 0.5 - 0.5 * Math.cos((2 * Math.PI * n) / (WIN - 1));
  // librosa.filters.mel(sr=16000, n_fft=512, n_mels=80), Slaney scale and norm, laid out [bin][mel].
  const fsp = 200 / 3, minLog = 1000, minLogMel = minLog / fsp, logStep = Math.log(6.4) / 27;
  const hz2mel = (f: number) => (f >= minLog ? minLogMel + Math.log(f / minLog) / logStep : f / fsp);
  const mel2hz = (m: number) => (m >= minLogMel ? minLog * Math.exp(logStep * (m - minLogMel)) : fsp * m);
  const top = hz2mel(NEMO_SR / 2);
  const pts = Array.from({ length: MELS + 2 }, (_, i) => mel2hz((top * i) / (MELS + 1)));
  const mel = new Float64Array(BINS * MELS);
  for (let k = 0; k < BINS; k++) {
    const f = (k * (NEMO_SR / 2)) / (BINS - 1);
    for (let m = 0; m < MELS; m++) {
      const down = (f - pts[m]) / (pts[m + 1] - pts[m]), up = (pts[m + 2] - f) / (pts[m + 2] - pts[m + 1]);
      mel[k * MELS + m] = Math.max(0, Math.min(down, up)) * (2 / (pts[m + 2] - pts[m]));
    }
  }
  const cos = new Float64Array(N_FFT / 2), sin = new Float64Array(N_FFT / 2);
  for (let i = 0; i < N_FFT / 2; i++) { cos[i] = Math.cos((2 * Math.PI * i) / N_FFT); sin[i] = -Math.sin((2 * Math.PI * i) / N_FFT); }
  const bits = Math.log2(N_FFT), rev = new Uint16Array(N_FFT);
  for (let i = 0; i < N_FFT; i++) { let r = 0; for (let b = 0; b < bits; b++) r |= ((i >> b) & 1) << (bits - 1 - b); rev[i] = r; }
  return (tables = { window, mel, cos, sin, rev });
}

/** In-place radix-2 FFT of a 512-point frame. */
function fft(re: Float64Array, im: Float64Array) {
  const { cos, sin, rev } = getTables();
  for (let i = 0; i < N_FFT; i++) {
    const j = rev[i];
    if (j > i) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let size = 2; size <= N_FFT; size *= 2) {
    const half = size / 2, step = N_FFT / size;
    for (let start = 0; start < N_FFT; start += size) {
      for (let k = 0; k < half; k++) {
        const wr = cos[k * step], wi = sin[k * step], a = start + k, b = a + half;
        const tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
      }
    }
  }
}

/**
 * Normalized log-mel features of 16 kHz mono audio: [80 × frames] (mel-major, as the model takes them) and the
 * number of valid frames (`length`, the model's second input). Frames past `length` are zero.
 */
export function nemoFeatures(audio: Float32Array): { data: Float32Array; frames: number; length: number } {
  const { window, mel } = getTables();
  const n = audio.length;
  const frames = Math.floor(n / HOP) + 1, length = Math.floor(n / HOP);
  // Pre-emphasis, then N_FFT/2 zeros each side (centred frames).
  const padded = new Float64Array(n + N_FFT);
  for (let i = 0; i < n; i++) padded[N_FFT / 2 + i] = audio[i] - (i ? PREEMPH * audio[i - 1] : 0);
  const logMel = new Float64Array(MELS * frames);
  const re = new Float64Array(N_FFT), im = new Float64Array(N_FFT);
  for (let t = 0; t < frames; t++) {
    for (let i = 0; i < N_FFT; i++) { re[i] = padded[t * HOP + i] * window[i]; im[i] = 0; }
    fft(re, im);
    for (let m = 0; m < MELS; m++) {
      let e = 0;
      for (let k = 0; k < BINS; k++) {
        const w = mel[k * MELS + m];
        if (w) e += (re[k] * re[k] + im[k] * im[k]) * w;
      }
      logMel[m * frames + t] = Math.log(e + LOG_GUARD);
    }
  }
  // Per-feature normalization over the valid frames (unbiased variance), as NeMo's "per_feature".
  const data = new Float32Array(MELS * frames);
  if (length < 2) return { data, frames, length };
  for (let m = 0; m < MELS; m++) {
    const row = logMel.subarray(m * frames, m * frames + length);
    let mean = 0;
    for (const v of row) mean += v;
    mean /= length;
    let v2 = 0;
    for (const v of row) v2 += (v - mean) ** 2;
    const sd = Math.sqrt(v2 / (length - 1)) + 1e-5;
    for (let t = 0; t < length; t++) data[m * frames + t] = (row[t] - mean) / sd;
  }
  return { data, frames, length };
}
