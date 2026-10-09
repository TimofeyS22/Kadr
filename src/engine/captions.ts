// Auto-captions client: mixes the timeline sound to 16 kHz mono, cuts it into ≤30 s chunks at the
// quietest moments (so words are not split), and transcribes the chunks in the ASR worker.
import { alignToSpeech, dropArtifacts, speechOnset, speechWindows, vadSegments, wordsInSpeech } from '../core/captions';
import { projectDuration } from '../core/timeline';
import type { CaptionWord, Project } from '../core/types';
import type { AsrModel, AsrRequest, AsrResponse } from './asr.worker';
import { renderAudioWindow } from './audio';
import { MediaPool } from './media';

export type { AsrModel };
export const ASR_MODELS: Record<AsrModel, { label: string; mb: number }> = {
  tiny: { label: 'Fast', mb: 41 },
  base: { label: 'Accurate', mb: 77 },
  small: { label: 'Most accurate', mb: 249 },
};

export const CAPTION_LANGUAGES: { id: string | null; label: string }[] = [
  { id: null, label: 'Auto' }, { id: 'english', label: 'English' }, { id: 'russian', label: 'Русский' },
  { id: 'spanish', label: 'Español' }, { id: 'portuguese', label: 'Português' }, { id: 'german', label: 'Deutsch' },
  { id: 'french', label: 'Français' }, { id: 'italian', label: 'Italiano' }, { id: 'ukrainian', label: 'Українська' },
  { id: 'turkish', label: 'Türkçe' }, { id: 'hindi', label: 'हिन्दी' }, { id: 'japanese', label: '日本語' },
];

const SR = 16000;
const MAX_CHUNK_S = 28;
const MIN_CHUNK_S = 18;

export type CaptionProgress = { phase: 'download'; fraction: number; mb: number } | { phase: 'prepare' } | { phase: 'listen' } | { phase: 'transcribe'; fraction: number };

/** Timeline mix as 16 kHz mono, rendered in windows to bound memory. */
async function timelineAudio(p: Project, signal: AbortSignal): Promise<Float32Array> {
  const duration = projectDuration(p);
  const total = Math.round(duration * SR);
  const out = new Float32Array(total);
  const pool = new MediaPool(16);
  // Render at 48 kHz (supported everywhere) and decimate by 3 with a box filter; plenty for speech.
  try {
    for (let i = 0; i < total; i += SR * 20) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const j = Math.min(total, i + SR * 20);
      const buf = await renderAudioWindow(p, pool, i / SR, j / SR, SR * 3);
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      for (let k = 0; k < j - i; k++) {
        const q = k * 3;
        out[i + k] = (l[q] + r[q] + (l[q + 1] ?? 0) + (r[q + 1] ?? 0) + (l[q + 2] ?? 0) + (r[q + 2] ?? 0)) / 6;
      }
    }
  } finally {
    pool.dispose();
  }
  return out;
}

/** Chunk boundaries (sample indices) at the quietest 100 ms between MIN and MAX chunk length (kept for long speech). */
export function chunkBounds(audio: Float32Array, sr = SR): number[] {
  const bounds = [0];
  const win = Math.round(sr * 0.1);
  while (audio.length - bounds[bounds.length - 1] > MAX_CHUNK_S * sr) {
    const from = bounds[bounds.length - 1] + MIN_CHUNK_S * sr;
    const to = bounds[bounds.length - 1] + MAX_CHUNK_S * sr;
    let best = to, bestE = Infinity;
    for (let s = from; s + win <= to; s += win) {
      let e = 0;
      for (let k = s; k < s + win; k++) e += audio[k] * audio[k];
      if (e < bestE) { bestE = e; best = s + Math.round(win / 2); }
    }
    bounds.push(best);
  }
  bounds.push(audio.length);
  return bounds;
}

let worker: Worker | null = null;
function getWorker(): Worker {
  worker ??= new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
  return worker;
}

function request(w: Worker, msg: AsrRequest, onDownload?: (loaded: number, total: number) => void): Promise<AsrResponse> {
  return new Promise((resolve) => {
    const id = msg.type !== 'load' ? msg.id : undefined;
    const onMessage = (e: MessageEvent<AsrResponse>) => {
      const r = e.data;
      if (r.type === 'download') { onDownload?.(r.loaded, r.total); return; }
      if (msg.type === 'load' && (r.type === 'ready' || r.type === 'error')) { w.removeEventListener('message', onMessage); resolve(r); }
      if (msg.type !== 'load' && (r.type === 'result' || r.type === 'vad' || r.type === 'error') && 'id' in r && r.id === id) { w.removeEventListener('message', onMessage); resolve(r); }
    };
    w.addEventListener('message', onMessage);
    w.postMessage(msg, msg.type !== 'load' ? [msg.audio.buffer] : []);
  });
}

/** Transcribes the whole timeline; returns words in timeline seconds. */
export async function transcribeProject(
  p: Project, model: AsrModel, language: string | null, onProgress: (p: CaptionProgress) => void, signal: AbortSignal,
): Promise<CaptionWord[]> {
  const w = getWorker();
  onProgress({ phase: 'download', fraction: 0, mb: ASR_MODELS[model].mb });
  const loaded = await request(w, { type: 'load', model }, (l, t) => onProgress({ phase: 'download', fraction: t ? l / t : 0, mb: ASR_MODELS[model].mb }));
  if (loaded.type === 'error') throw new Error(`Could not load the speech model: ${loaded.message}`);
  onProgress({ phase: 'prepare' });
  const audio = await timelineAudio(p, signal);
  // Whisper invents text over music and silence, so only speech found by the VAD is transcribed.
  onProgress({ phase: 'listen' });
  const vad = await request(w, { type: 'vad', id: -1, audio: audio.slice() });
  if (vad.type === 'error') throw new Error(`Speech detection failed: ${vad.message}`);
  const speech = vad.type === 'vad' ? vadSegments(vad.probs, 512 / SR) : [];
  const windows = speechWindows(speech);
  const words: CaptionWord[] = [];
  for (let i = 0; i < windows.length; i++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    onProgress({ phase: 'transcribe', fraction: i / windows.length });
    const [a0, a1] = windows[i];
    const chunk = audio.slice(Math.floor(a0 * SR), Math.ceil(a1 * SR));
    const r = await request(w, { type: 'transcribe', id: i, audio: chunk, language });
    if (r.type === 'error') throw new Error(`Transcription failed: ${r.message}`);
    if (r.type !== 'result') continue;
    for (const x of r.words) words.push({ t0: x.t0 + a0, t1: Math.max(x.t0 + 0.05, x.t1) + a0, text: x.text });
  }
  onProgress({ phase: 'transcribe', fraction: 1 });
  return alignToSpeech(dropArtifacts(wordsInSpeech(words, speech)), speech, speech.map(([a, b]) => speechOnset(audio, SR, a, b)));
}

/** Frees the model memory (the files stay cached for next time). */
export function releaseSpeechModel(): void {
  worker?.terminate();
  worker = null;
}
