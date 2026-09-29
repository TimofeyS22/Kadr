// Sound effects synthesized on the fly (no files, no licensing): rendered with OfflineAudioContext, saved as WAV.
const SR = 48000;

type Build = (ctx: OfflineAudioContext, out: AudioNode) => void;
export interface Sfx { id: string; name: string; duration: number; build: Build }

/** Deterministic white noise so a sound is identical every time it is added. */
function noise(ctx: OfflineAudioContext, seconds: number, seed = 1): AudioBufferSourceNode {
  const b = ctx.createBuffer(1, Math.ceil(seconds * SR), SR);
  const d = b.getChannelData(0);
  let x = seed * 2654435761;
  for (let i = 0; i < d.length; i++) { x = (x * 1664525 + 1013904223) >>> 0; d[i] = x / 2147483648 - 1; }
  const s = ctx.createBufferSource();
  s.buffer = b;
  return s;
}

function env(ctx: OfflineAudioContext, out: AudioNode, points: [number, number][]): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(points[0][1], points[0][0]);
  for (const [t, v] of points.slice(1)) g.gain.linearRampToValueAtTime(v, t);
  g.connect(out);
  return g;
}

function tone(ctx: OfflineAudioContext, out: AudioNode, type: OscillatorType, f0: number, f1: number, t0: number, dur: number, peak = 0.4): void {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(f0, t0);
  o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(peak, t0 + 0.005);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur);
}

function filteredNoise(ctx: OfflineAudioContext, out: AudioNode, t0: number, dur: number, type: BiquadFilterType, f: [number, number][], gain: [number, number][], seed = 1): void {
  const n = noise(ctx, dur, seed);
  const flt = ctx.createBiquadFilter();
  flt.type = type;
  flt.Q.value = 1.2;
  flt.frequency.setValueAtTime(f[0][1], t0 + f[0][0]);
  for (const [t, v] of f.slice(1)) flt.frequency.exponentialRampToValueAtTime(v, t0 + t);
  const g = env(ctx, out, gain.map(([t, v]) => [t0 + t, v]));
  n.connect(flt).connect(g);
  n.start(t0);
}

export const SFX: Sfx[] = [
  { id: 'whoosh', name: 'Whoosh', duration: 0.7, build: (c, o) => filteredNoise(c, o, 0, 0.7, 'bandpass', [[0, 300], [0.35, 3200], [0.7, 500]], [[0, 0], [0.3, 0.9], [0.7, 0]]) },
  { id: 'riser', name: 'Riser', duration: 1.5, build: (c, o) => { filteredNoise(c, o, 0, 1.5, 'bandpass', [[0, 200], [1.5, 6000]], [[0, 0], [1.4, 0.7], [1.5, 0]], 2); tone(c, o, 'sawtooth', 110, 880, 0, 1.5, 0.12); } },
  { id: 'pop', name: 'Pop', duration: 0.15, build: (c, o) => tone(c, o, 'sine', 900, 250, 0, 0.14, 0.7) },
  { id: 'click', name: 'Click', duration: 0.06, build: (c, o) => filteredNoise(c, o, 0, 0.05, 'highpass', [[0, 3000], [0.05, 2500]], [[0, 0.9], [0.05, 0]], 3) },
  { id: 'ding', name: 'Ding', duration: 1.4, build: (c, o) => { tone(c, o, 'sine', 1320, 1318, 0, 1.4, 0.35); tone(c, o, 'sine', 2640, 2636, 0, 0.9, 0.12); } },
  { id: 'boom', name: 'Boom', duration: 1.6, build: (c, o) => { tone(c, o, 'sine', 70, 32, 0, 1.6, 0.9); filteredNoise(c, o, 0, 0.6, 'lowpass', [[0, 900], [0.6, 120]], [[0, 0.6], [0.6, 0]], 4); } },
  { id: 'shutter', name: 'Shutter', duration: 0.3, build: (c, o) => { filteredNoise(c, o, 0, 0.06, 'bandpass', [[0, 2500], [0.06, 1800]], [[0, 0.8], [0.06, 0]], 5); filteredNoise(c, o, 0.14, 0.08, 'bandpass', [[0, 2000], [0.08, 1500]], [[0, 0.7], [0.08, 0]], 6); } },
  { id: 'notify', name: 'Notify', duration: 0.6, build: (c, o) => { tone(c, o, 'triangle', 880, 878, 0, 0.25, 0.4); tone(c, o, 'triangle', 1320, 1318, 0.15, 0.4, 0.4); } },
  { id: 'success', name: 'Success', duration: 0.8, build: (c, o) => [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(c, o, 'triangle', f, f, i * 0.09, 0.45, 0.3)) },
  { id: 'fail', name: 'Fail', duration: 0.9, build: (c, o) => { tone(c, o, 'square', 392, 380, 0, 0.3, 0.15); tone(c, o, 'square', 311, 290, 0.3, 0.55, 0.15); } },
  { id: 'heartbeat', name: 'Heartbeat', duration: 1.1, build: (c, o) => { tone(c, o, 'sine', 80, 45, 0, 0.18, 0.9); tone(c, o, 'sine', 70, 40, 0.25, 0.2, 0.7); } },
  { id: 'typing', name: 'Typing', duration: 1.6, build: (c, o) => { for (let i = 0; i < 12; i++) filteredNoise(c, o, i * 0.12 + (i % 3) * 0.02, 0.03, 'highpass', [[0, 4000], [0.03, 3000]], [[0, 0.5], [0.03, 0]], 10 + i); } },
];

export async function renderSfx(s: Sfx): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.ceil(s.duration * SR), SR);
  const master = ctx.createGain();
  master.gain.value = 0.9;
  master.connect(ctx.destination);
  s.build(ctx, master);
  return ctx.startRendering();
}

/** 16-bit PCM WAV. */
export function toWav(b: AudioBuffer): Blob {
  const ch = b.numberOfChannels, n = b.length;
  const view = new DataView(new ArrayBuffer(44 + n * ch * 2));
  const str = (o: number, s: string) => { for (let i = 0; i < s.length; i++) view.setUint8(o + i, s.charCodeAt(i)); };
  str(0, 'RIFF'); view.setUint32(4, 36 + n * ch * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, ch, true); view.setUint32(24, b.sampleRate, true);
  view.setUint32(28, b.sampleRate * ch * 2, true); view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
  str(36, 'data'); view.setUint32(40, n * ch * 2, true);
  const data = Array.from({ length: ch }, (_, i) => b.getChannelData(i));
  let o = 44;
  for (let i = 0; i < n; i++) for (let c = 0; c < ch; c++, o += 2) view.setInt16(o, Math.max(-1, Math.min(1, data[c][i])) * 0x7fff, true);
  return new Blob([view], { type: 'audio/wav' });
}
