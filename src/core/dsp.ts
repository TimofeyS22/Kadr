// Streaming DSP in plain TypeScript: filters, compressor, loudness meter (ITU-R BS.1770-4) and a lookahead
// limiter. State carries across calls, so sound processed in 10 s windows has no seams (ADR 15).

type FilterType = 'highpass' | 'lowpass' | 'peaking' | 'highshelf';

/** Biquad in transposed direct form II, one instance per channel; coefficients normalized by a0. */
export class Biquad {
  private z1 = 0; private z2 = 0;
  constructor(private readonly b0: number, private readonly b1: number, private readonly b2: number, private readonly a1: number, private readonly a2: number) {}

  /** RBJ audio-EQ-cookbook filter. */
  static rbj(type: FilterType, freq: number, q: number, gainDb: number, sr: number): Biquad {
    const w = (2 * Math.PI * freq) / sr, cw = Math.cos(w), sw = Math.sin(w);
    const A = 10 ** (gainDb / 40), alpha = sw / (2 * q);
    let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
    if (type === 'highpass') {
      b0 = (1 + cw) / 2; b1 = -(1 + cw); b2 = (1 + cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'lowpass') {
      b0 = (1 - cw) / 2; b1 = 1 - cw; b2 = (1 - cw) / 2; a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === 'peaking') {
      b0 = 1 + alpha * A; b1 = -2 * cw; b2 = 1 - alpha * A; a0 = 1 + alpha / A; a1 = -2 * cw; a2 = 1 - alpha / A;
    } else {
      const s = 2 * Math.sqrt(A) * alpha;
      b0 = A * (A + 1 + (A - 1) * cw + s); b1 = -2 * A * (A - 1 + (A + 1) * cw); b2 = A * (A + 1 + (A - 1) * cw - s);
      a0 = A + 1 - (A - 1) * cw + s; a1 = 2 * (A - 1 - (A + 1) * cw); a2 = A + 1 - (A - 1) * cw - s;
    }
    return new Biquad(b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0);
  }

  /** Filters in place. */
  process(x: Float32Array): void {
    const { b0, b1, b2, a1, a2 } = this;
    let { z1, z2 } = this;
    for (let i = 0; i < x.length; i++) {
      const v = x[i], y = b0 * v + z1;
      z1 = b1 * v - a1 * y + z2;
      z2 = b2 * v - a2 * y;
      x[i] = y;
    }
    this.z1 = z1; this.z2 = z2;
  }
}

/** Feed-forward RMS compressor (mono). */
export class Compressor {
  private env = 0;
  private readonly att: number;
  private readonly rel: number;
  constructor(private readonly thresholdDb: number, private readonly ratio: number, attackS: number, releaseS: number, sr: number) {
    this.att = Math.exp(-1 / (attackS * sr));
    this.rel = Math.exp(-1 / (releaseS * sr));
  }
  process(x: Float32Array): void {
    let env = this.env;
    for (let i = 0; i < x.length; i++) {
      const p = x[i] * x[i];
      env = p > env ? this.att * env + (1 - this.att) * p : this.rel * env + (1 - this.rel) * p;
      const db = 10 * Math.log10(env + 1e-12);
      if (db > this.thresholdDb) x[i] *= 10 ** ((this.thresholdDb + (db - this.thresholdDb) / this.ratio - db) / 20);
    }
    this.env = env;
  }
}

/** Integrated loudness (LUFS) per ITU-R BS.1770-4: K-weighting, 400 ms blocks every 100 ms, two gates. */
export class LoudnessMeter {
  private readonly filters: Biquad[][] = [];
  private readonly step: number;
  private acc: number[];
  private n = 0;
  private readonly quarters: number[] = []; // mean-square sums of 100 ms sub-blocks, summed over channels
  private readonly blocks: number[] = [];

  constructor(private readonly channels: number, sr: number) {
    // K-weighting: pre-filter shelf and RLB high-pass, derived for any sample rate as in libebur128.
    const shelf = () => {
      const K = Math.tan((Math.PI * 1681.974450955533) / sr), Q = 0.7071752369554196;
      const Vh = 10 ** (3.999843853973347 / 20), Vb = Vh ** 0.4996667741545416, a0 = 1 + K / Q + K * K;
      return new Biquad((Vh + (Vb * K) / Q + K * K) / a0, (2 * (K * K - Vh)) / a0, (Vh - (Vb * K) / Q + K * K) / a0, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
    };
    const rlb = () => {
      const K = Math.tan((Math.PI * 38.13547087602444) / sr), Q = 0.5003270373238773, a0 = 1 + K / Q + K * K;
      return new Biquad(1, -2, 1, (2 * (K * K - 1)) / a0, (1 - K / Q + K * K) / a0);
    };
    for (let c = 0; c < channels; c++) this.filters.push([shelf(), rlb()]);
    this.step = Math.round(sr / 10);
    this.acc = new Array(channels).fill(0);
  }

  push(chans: Float32Array[]): void {
    const k = chans.map((x, c) => { const y = x.slice(); for (const f of this.filters[c]) f.process(y); return y; });
    const len = k[0]?.length ?? 0;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < this.channels; c++) this.acc[c] += k[c][i] * k[c][i];
      if (++this.n === this.step) {
        this.quarters.push(this.acc.reduce((a, b) => a + b, 0) / this.step);
        this.acc.fill(0);
        this.n = 0;
        const q = this.quarters.length;
        if (q >= 4) this.blocks.push((this.quarters[q - 1] + this.quarters[q - 2] + this.quarters[q - 3] + this.quarters[q - 4]) / 4);
      }
    }
  }

  /** Integrated loudness, or -Infinity for silence / shorter than one block. */
  integrated(): number {
    const lufs = (ms: number) => -0.691 + 10 * Math.log10(ms);
    const abs = this.blocks.filter((z) => lufs(z) > -70);
    if (!abs.length) return -Infinity;
    const rel = lufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
    const gated = abs.filter((z) => lufs(z) > rel);
    return lufs(gated.reduce((a, b) => a + b, 0) / gated.length);
  }
}

/** Samples each side of a point between two samples that the true-peak interpolation reads (16 taps in all). */
const TP_SIDE = 8;
/**
 * 8× oversampling for the true peak (seven points between a sample and the next): a Hann-windowed sinc of 16 taps per
 * point, each summing to 1. The AAC encoder and a player's converter draw the waveform between the samples; a
 * sample-peak limiter at −1 dBFS let it reach −0.8 in the file (Q-31). 4× (BS.1770) reads up to 0.3 dB under the peak
 * at 16 kHz, and under is what a ceiling must not be; at 8× it is under 0.1 dB.
 */
const TP_PHASES: Float32Array[] = [1, 2, 3, 4, 5, 6, 7].map((k) => k / 8).map((f) => {
  const h = Float32Array.from({ length: 2 * TP_SIDE }, (_, j) => {
    const x = j - (TP_SIDE - 1) - f; // the tap's sample, from the point
    const sinc = x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x);
    return sinc * (0.5 + 0.5 * Math.cos((Math.PI * x) / (TP_SIDE + 1)));
  });
  const sum = h.reduce((a, b) => a + b, 0);
  return h.map((v) => v / sum);
});

/** The true peak of one channel, sample by sample, `TP_SIDE` samples late (the interpolation reads ahead). */
export class TruePeak {
  private readonly x = new Float32Array(2 * TP_SIDE);
  private i = 0; // where the next sample goes: the oldest held

  /**
   * Takes the next sample; returns the peak of the sample `TP_SIDE` before it and of the waveform up to the one after
   * that. The filter runs only where the waveform can rise between them — it turns there (a monotonic stretch peaks at
   * its ends) and the samples are within 6 dB of `floor` (a limiter needs nothing below its ceiling): the 87 s of live
   * speech under music took 10× longer with it run at every sample.
   */
  next(v: number, floor = 0): number {
    const x = this.x, n = x.length, i = this.i;
    x[i] = v;
    this.i = (i + 1) % n;
    const at = (k: number) => x[(this.i + TP_SIDE - 1 + k + n) % n]; // k = 0: the sample TP_SIDE before the newest
    const a = at(0), b = at(1), s = a < 0 ? -a : a, s1 = b < 0 ? -b : b;
    if (2 * Math.max(s, s1) <= floor) return s;
    if ((a - at(-1)) * (at(2) - b) > 0 && (b - a) * (a - at(-1)) > 0) return s; // rising or falling through: no peak between
    let peak = s;
    for (const h of TP_PHASES) {
      let y = 0;
      for (let t = 0; t < n; t++) y += h[t] * x[(this.i + t) % n]; // oldest to newest
      if (y < 0) y = -y;
      if (y > peak) peak = y;
    }
    return peak;
  }
}

/**
 * Lookahead peak limiter with gain applied first. Output is delayed by `lookahead` samples internally, but
 * the class compensates: `process` returns the same number of samples it was given, starting at time 0, and
 * `flush` returns the held-back tail, so total output length equals total input length.
 */
export class Limiter {
  private readonly la: number;
  private readonly ceil: number;
  private readonly rel: number;
  private readonly delay: Float32Array[];
  private readonly peaks: Float32Array; // ring buffer of per-sample peak (max over channels)
  private readonly dq: Int32Array; // monotonic deque of indices into the peak history (sliding max)
  private head = 0; private tail = 0;
  private pos = 0; // samples written so far
  private gain = 1;
  private skip: number;

  /** Per channel when the ceiling is of the true peak (`truePeak`): the waveform between samples, not only the samples. */
  private readonly tp: TruePeak[] | null;

  constructor(private readonly channels: number, sr: number, private readonly preGain = 1, ceilingDb = -1, lookaheadS = 0.005, releaseS = 0.08, truePeak = false) {
    this.la = Math.max(1, Math.round(lookaheadS * sr));
    // The true peak comes TP_SIDE samples late: the lookahead still covers each sample when it leaves.
    if (truePeak && this.la <= TP_SIDE) this.la = TP_SIDE + 1;
    this.tp = truePeak ? Array.from({ length: channels }, () => new TruePeak()) : null;
    this.ceil = 10 ** (ceilingDb / 20);
    this.rel = Math.exp(-1 / (releaseS * sr));
    this.delay = Array.from({ length: channels }, () => new Float32Array(this.la + 1));
    this.peaks = new Float32Array(this.la + 1);
    this.dq = new Int32Array(this.la + 2);
    this.skip = this.la;
  }

  private step(frame: number[], out: Float32Array[], o: number): number {
    const n = this.la + 1, i = this.pos % n;
    let peak = 0;
    for (let c = 0; c < this.channels; c++) {
      const v = frame[c] * this.preGain;
      this.delay[c][i] = v;
      peak = Math.max(peak, this.tp ? this.tp[c].next(v, this.ceil) : Math.abs(v));
    }
    this.peaks[i] = peak;
    // Sliding max over the last la+1 samples.
    const size = this.dq.length;
    while (this.tail !== this.head && this.peaks[this.dq[(this.tail - 1 + size) % size] % n] <= peak) this.tail = (this.tail - 1 + size) % size;
    this.dq[this.tail] = this.pos; this.tail = (this.tail + 1) % size;
    while (this.dq[this.head] <= this.pos - n) this.head = (this.head + 1) % size;
    const maxPeak = this.peaks[this.dq[this.head] % n];
    const target = maxPeak > this.ceil ? this.ceil / maxPeak : 1;
    this.gain = target < this.gain ? target : target - (target - this.gain) * this.rel;
    this.pos++;
    if (this.skip > 0) { this.skip--; return o; }
    const j = (this.pos - 1 - this.la + n * 2) % n; // the sample written la steps ago
    for (let c = 0; c < this.channels; c++) out[c][o] = this.delay[c][j] * this.gain;
    return o + 1;
  }

  process(chans: Float32Array[]): Float32Array[] {
    const len = chans[0]?.length ?? 0;
    const out = chans.map(() => new Float32Array(len));
    const frame = new Array<number>(this.channels);
    let o = 0;
    for (let i = 0; i < len; i++) {
      for (let c = 0; c < this.channels; c++) frame[c] = chans[c][i];
      o = this.step(frame, out, o);
    }
    return out.map((x) => x.subarray(0, o));
  }

  flush(): Float32Array[] {
    const pending = Math.min(this.pos, this.la); // real samples not yet output
    const out = Array.from({ length: this.channels }, () => new Float32Array(pending));
    const zero = new Array<number>(this.channels).fill(0);
    let o = 0;
    for (let i = this.skip + pending; i > 0; i--) o = this.step(zero, out, o);
    return out.map((x) => x.subarray(0, o));
  }
}

/** Gain in linear units that brings `measured` LUFS to `target`, capped; 1 for silence. */
export function normalizeGain(measured: number, target: number, maxBoostDb: number): number {
  if (!Number.isFinite(measured)) return 1;
  return 10 ** (Math.min(maxBoostDb, target - measured) / 20);
}

/**
 * The gain that brings a sound to `target` LUFS as it comes out of a `ceilingDb` limiter (Limiter), not before it. On
 * peaks far above the loudness the limiter takes back what a gain measured before it adds: a 120 BPM beat at +6 dB came
 * out at −18.4 LUFS instead of −14 (SW-D-5). `pass(each)` feeds the whole sound to `each` once per call, window by
 * window; the inputs may be changed. The first pass measures the sound as it is; only when the limiter would act do
 * further passes measure it through the limiter and correct the gain (a secant on dB: up to `passes` in all, the last
 * gain is not measured again). The boost stays within `maxBoostDb`; silence keeps gain 1.
 */
export async function limitedGain(
  pass: (each: (chans: Float32Array[]) => void) => Promise<void>, channels: number, sr: number, target: number, maxBoostDb: number,
  ceilingDb = -1, passes = 4, truePeak = false,
): Promise<number> {
  const raw = new LoudnessMeter(channels, sr);
  let peak = 0;
  await pass((chans) => {
    for (const c of chans) for (let i = 0; i < c.length; i++) { const v = c[i] < 0 ? -c[i] : c[i]; if (v > peak) peak = v; }
    raw.push(chans);
  });
  const measured = raw.integrated();
  const first = normalizeGain(measured, target, maxBoostDb);
  // A true peak is at most 6 dB over the samples (TruePeak's own bound): under that the limiter would not act.
  if (!Number.isFinite(measured) || peak * first * (truePeak ? 2 : 1) <= 10 ** (ceilingDb / 20)) return first;
  const most = Math.min(maxBoostDb, target - measured + maxBoostDb); // dB; the cap of normalizeGain, wherever the start
  const through = async (db: number) => {
    const meter = new LoudnessMeter(channels, sr);
    const limiter = new Limiter(channels, sr, 10 ** (db / 20), ceilingDb, undefined, undefined, truePeak);
    await pass((chans) => meter.push(limiter.process(chans)));
    meter.push(limiter.flush());
    return meter.integrated();
  };
  const dbCap = Math.min(maxBoostDb, most);
  let g0 = 20 * Math.log10(first), out0 = await through(g0);
  if (!Number.isFinite(out0) || Math.abs(target - out0) < 0.1) return first;
  let g1 = Math.min(dbCap, g0 + (target - out0));
  for (let k = 3; k < passes; k++) {
    if (g1 === g0) break;
    const out1 = await through(g1);
    if (!Number.isFinite(out1) || Math.abs(target - out1) < 0.1) break;
    const slope = (out1 - out0) / (g1 - g0); // dB out per dB of gain: 1 unlimited, less the harder the limiter works
    const next = Math.min(dbCap, g1 + (target - out1) / (slope > 0.05 ? slope : 0.05));
    [g0, out0, g1] = [g1, out1, next];
  }
  return 10 ** (g1 / 20);
}

/** "Enhance voice" tone and dynamics (mono): rumble cut, less mud, presence, air, gentle compression. */
export function voiceChain(sr: number): (x: Float32Array) => void {
  const stages = [
    Biquad.rbj('highpass', 80, 0.707, 0, sr),
    Biquad.rbj('peaking', 250, 1, -2, sr),
    Biquad.rbj('peaking', 3500, 0.8, 3, sr),
    Biquad.rbj('highshelf', 10000, 0.707, 2, sr),
  ];
  const comp = new Compressor(-24, 3, 0.01, 0.15, sr);
  return (x) => { for (const s of stages) s.process(x); comp.process(x); };
}
