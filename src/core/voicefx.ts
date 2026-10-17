// Voice effects (docs/09 V1): chipmunk, robot, telephone, halls… as streaming DSP in plain TypeScript. Every stage
// keeps its state across calls, so a sound processed in 10 s windows has no seams (ADR 15). Pitch (chipmunk, deep)
// is shifted by SoundTouch in engine/audiofx before these stages; a −1 dBFS limiter follows them there.
import { Biquad } from './dsp';

export const VOICE_IDS = ['chipmunk', 'deep', 'robot', 'telephone', 'megaphone', 'radio', 'echo', 'hall', 'cathedral', 'underwater'] as const;
export type VoiceId = typeof VOICE_IDS[number];
export const VOICE_LABEL: Record<VoiceId, string> = {
  chipmunk: 'Chipmunk', deep: 'Deep', robot: 'Robot', telephone: 'Telephone', megaphone: 'Megaphone',
  radio: 'Radio', echo: 'Echo', hall: 'Hall', cathedral: 'Cathedral', underwater: 'Underwater',
};
/** Pitch factor applied first (1.6 ≈ +8 semitones); absent = unchanged. */
export const VOICE_PITCH: Partial<Record<VoiceId, number>> = { chipmunk: 1.6, deep: 0.72 };

export interface VoiceStage { process(x: Float32Array): void }

const stage = (process: (x: Float32Array) => void): VoiceStage => ({ process });
const gain = (g: number) => stage((x) => { for (let i = 0; i < x.length; i++) x[i] *= g; });
const filter = (b: Biquad) => stage((x) => b.process(x));
/** Butterworth band: cascaded 2nd-order high- and low-passes (12 dB/oct each); the top edge can be steeper. */
function band(lo: number, hi: number, sr: number, loOrder = 1, hiOrder = loOrder): VoiceStage[] {
  const out: VoiceStage[] = [];
  for (let i = 0; i < loOrder; i++) out.push(filter(Biquad.rbj('highpass', lo, Math.SQRT1_2, 0, sr)));
  for (let i = 0; i < hiOrder; i++) out.push(filter(Biquad.rbj('lowpass', hi, Math.SQRT1_2, 0, sr)));
  return out;
}
/** Soft saturation, level-matched at small signals: tanh(d·x) / d. */
const drive = (d: number) => stage((x) => { for (let i = 0; i < x.length; i++) x[i] = Math.tanh(d * x[i]) / d; });

/** Ring modulation: the voice times a low sine — the classic sci-fi robot. */
function ring(freq: number, sr: number): VoiceStage {
  let ph = 0;
  const step = (2 * Math.PI * freq) / sr;
  return stage((x) => { for (let i = 0; i < x.length; i++) { x[i] *= Math.sin(ph); ph += step; } ph %= 2 * Math.PI; });
}

/** Feedback delay: `mix` of a copy every `seconds`, each repeat `feedback` quieter. */
function delay(seconds: number, feedback: number, mix: number, sr: number): VoiceStage {
  const buf = new Float32Array(Math.max(1, Math.round(seconds * sr)));
  let p = 0;
  return stage((x) => {
    for (let i = 0; i < x.length; i++) {
      const d = buf[p];
      buf[p] = x[i] + d * feedback;
      x[i] += d * mix;
      p = (p + 1) % buf.length;
    }
  });
}

/** Vibrato: a delay swept by a slow sine (linear interpolation) — the wobble of sound under water. */
function vibrato(rate: number, depthS: number, sr: number): VoiceStage {
  const max = Math.ceil(depthS * 2 * sr) + 2;
  const buf = new Float32Array(max + 1);
  let w = 0, ph = 0;
  const step = (2 * Math.PI * rate) / sr;
  return stage((x) => {
    for (let i = 0; i < x.length; i++) {
      buf[w] = x[i];
      const d = (1 + Math.sin(ph)) * depthS * sr + 1;
      let r = w - d;
      while (r < 0) r += buf.length;
      const i0 = Math.floor(r), f = r - i0;
      x[i] = buf[i0] * (1 - f) + buf[(i0 + 1) % buf.length] * f;
      w = (w + 1) % buf.length;
      ph += step;
    }
    ph %= 2 * Math.PI;
  });
}

/** Freeverb-style room (8 damped combs + 4 allpasses, Jezar's tunings scaled from 44.1 kHz). */
function reverb(room: number, damp: number, wet: number, dry: number, sr: number): VoiceStage {
  const k = sr / 44100;
  const combs = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map((n) => ({ buf: new Float32Array(Math.round(n * k)), p: 0, low: 0 }));
  const alls = [556, 441, 341, 225].map((n) => ({ buf: new Float32Array(Math.round(n * k)), p: 0 }));
  const fb = 0.7 + 0.28 * room;
  return stage((x) => {
    for (let i = 0; i < x.length; i++) {
      const v = x[i] * 0.015; // Freeverb's fixed input gain
      let s = 0;
      for (const c of combs) {
        const y = c.buf[c.p];
        c.low = y * (1 - damp) + c.low * damp;
        c.buf[c.p] = v + c.low * fb;
        c.p = (c.p + 1) % c.buf.length;
        s += y;
      }
      for (const a of alls) {
        const b = a.buf[a.p];
        a.buf[a.p] = s + b * 0.5;
        s = b - s;
        a.p = (a.p + 1) % a.buf.length;
      }
      x[i] = x[i] * dry + s * wet * 3;
    }
  });
}

/** The stages of a voice, after its pitch shift. Each call makes fresh state. */
export function voiceStages(id: VoiceId, sr: number): VoiceStage[] {
  switch (id) {
    case 'chipmunk': return [filter(Biquad.rbj('highpass', 120, Math.SQRT1_2, 0, sr))];
    case 'deep': return [gain(1.1)];
    case 'robot': return [ring(55, sr), delay(0.007, 0.45, 0.6, sr), ...band(150, 6000, sr), gain(1.6)];
    // Saturation before the band: its harmonics would otherwise refill the highs the band removes.
    // A phone line ends steeply above 3.4 kHz (48 dB/oct here), which is what makes it sound like a phone.
    case 'telephone': return [drive(2), ...band(300, 3200, sr, 2, 4), gain(2)];
    case 'megaphone': return [drive(6), ...band(500, 3000, sr, 2, 3), gain(1.6)];
    case 'radio': return [drive(3), ...band(400, 4500, sr), filter(Biquad.rbj('peaking', 1500, 1, 4, sr)), gain(1.3)];
    case 'echo': return [delay(0.28, 0.42, 0.5, sr)];
    case 'hall': return [reverb(0.78, 0.4, 0.35, 0.85, sr)];
    case 'cathedral': return [delay(0.04, 0, 0, sr), reverb(0.94, 0.25, 0.55, 0.7, sr)];
    case 'underwater': return [...band(80, 600, sr, 2), vibrato(0.9, 0.0025, sr), reverb(0.5, 0.6, 0.2, 0.9, sr), gain(2)];
  }
}
