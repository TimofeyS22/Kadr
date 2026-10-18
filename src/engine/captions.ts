// Auto-captions client: mixes the timeline sound to 16 kHz mono, cuts it into ≤30 s chunks at the
// quietest moments (so words are not split), and transcribes the chunks in the ASR worker.
import { alignToSpeech, dropArtifacts, speechOnset, speechWindows, vadSegments, wordsInSpeech } from '../core/captions';
import { projectDuration, soundAssetId } from '../core/timeline';
import type { ScriptCaptions } from '../core/script';
import type { CaptionWord, Project } from '../core/types';
import type { AsrModel, AsrRequest, AsrResponse } from './asr.worker';
import { renderAudioWindow, soundEntries } from './audio';
import { MediaError, MediaPool } from './media';

export type { AsrModel };
export const ASR_MODELS: Record<AsrModel, { label: string; mb: number }> = {
  tiny: { label: 'Fast', mb: 41 },
  base: { label: 'Accurate', mb: 77 },
  small: { label: 'Most accurate', mb: 249 },
};

export const CAPTION_LANGUAGES: { id: string | null; code: string; label: string }[] = [
  { id: null, code: '', label: 'Auto' }, { id: 'english', code: 'en', label: 'English' }, { id: 'russian', code: 'ru', label: 'Русский' },
  { id: 'spanish', code: 'es', label: 'Español' }, { id: 'portuguese', code: 'pt', label: 'Português' }, { id: 'german', code: 'de', label: 'Deutsch' },
  { id: 'french', code: 'fr', label: 'Français' }, { id: 'italian', code: 'it', label: 'Italiano' }, { id: 'ukrainian', code: 'uk', label: 'Українська' },
  { id: 'turkish', code: 'tr', label: 'Türkçe' }, { id: 'hindi', code: 'hi', label: 'हिन्दी' }, { id: 'japanese', code: 'ja', label: '日本語' },
];
/** The label of a speech language id ('russian' → 'Русский'). */
export const languageLabel = (id: string): string => CAPTION_LANGUAGES.find((l) => l.id === id)?.label ?? id;

export interface Transcript {
  words: CaptionWord[];
  /** The language the speech was recognized in (an id from CAPTION_LANGUAGES); null when there was no speech. */
  language: string | null;
  /** True when Kadr found the language itself (the caller passed none). */
  detected: boolean;
  /** Where there is speech (VAD), timeline seconds: tells a skipped stretch of a script from words recognition missed. */
  speech: [number, number][];
  /** Names of the files whose sound this browser could not decode: captioned without them. */
  unreadable: string[];
}

const SR = 16000;
const MAX_CHUNK_S = 28;
const MIN_CHUNK_S = 18;

export type CaptionProgress = { phase: 'download'; fraction: number; mb: number } | { phase: 'prepare' } | { phase: 'listen' } | { phase: 'transcribe'; fraction: number };

/**
 * Timeline mix as 16 kHz mono, rendered in windows to bound memory. A sound no decoder in this browser can read is
 * left out (its asset id goes to `skipped`) instead of failing the captions for everything else.
 */
async function timelineAudio(p: Project, signal: AbortSignal, skipped: Set<string>): Promise<Float32Array> {
  const duration = projectDuration(p);
  const total = Math.round(duration * SR);
  const out = new Float32Array(total);
  const pool = new MediaPool(16);
  // Render at 48 kHz (supported everywhere) and decimate by 3 with a box filter; plenty for speech.
  try {
    for (let i = 0; i < total; i += SR * 20) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const j = Math.min(total, i + SR * 20);
      const buf = await renderAudioWindow(p, pool, i / SR, j / SR, SR * 3, skipped);
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

/** Request ids, unique per page: a reply to a cancelled request can never be taken for a newer one. */
let seq = 0;

/**
 * Sends a request to the ASR worker. With a signal, Cancel (or Settings) is honoured at once, even mid-download or
 * mid-chunk: the worker finishes that job on its own (a model download is cached for next time), its reply is dropped.
 */
function request(w: Worker, msg: AsrRequest, onDownload?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<AsrResponse> {
  return new Promise((resolve, reject) => {
    const id = msg.type !== 'load' ? (msg.id = ++seq) : undefined;
    const done = () => { w.removeEventListener('message', onMessage); signal?.removeEventListener('abort', onAbort); };
    const onAbort = () => { done(); reject(new DOMException('Cancelled', 'AbortError')); };
    const onMessage = (e: MessageEvent<AsrResponse>) => {
      const r = e.data;
      if (r.type === 'download') { onDownload?.(r.loaded, r.total); return; }
      if (msg.type === 'load' && (r.type === 'ready' || r.type === 'error')) { done(); resolve(r); }
      if (msg.type !== 'load' && (r.type === 'result' || r.type === 'vad' || r.type === 'language' || r.type === 'aligned' || r.type === 'error') && 'id' in r && r.id === id) { done(); resolve(r); }
    };
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    signal?.addEventListener('abort', onAbort);
    w.addEventListener('message', onMessage);
    w.postMessage(msg, 'audio' in msg ? [msg.audio.buffer] : []);
  });
}

/**
 * Transcribes the whole timeline; returns words in timeline seconds. Without a language, it is detected once on the
 * longest stretch of speech and then used for every chunk (one language per video, no per-chunk flips).
 */
export async function transcribeProject(
  p: Project, model: AsrModel, language: string | null, onProgress: (p: CaptionProgress) => void, signal: AbortSignal,
): Promise<Transcript> {
  const w = getWorker();
  onProgress({ phase: 'download', fraction: 0, mb: ASR_MODELS[model].mb });
  const loaded = await request(w, { type: 'load', model }, (l, t) => onProgress({ phase: 'download', fraction: t ? l / t : 0, mb: ASR_MODELS[model].mb }), signal);
  if (loaded.type === 'error') throw new Error(`Could not load the speech model: ${loaded.message}`);
  onProgress({ phase: 'prepare' });
  const skipped = new Set<string>();
  const audio = await timelineAudio(p, signal, skipped);
  const unreadable = [...skipped].map((id) => p.assets[id]?.name ?? '?');
  if (skipped.size && soundEntries(p).every((e) => skipped.has(soundAssetId(e.clip)))) {
    throw new MediaError('The sound of “{name}” cannot be decoded in this browser', { name: unreadable.join(', ') });
  }
  // Whisper invents text over music and silence, so only speech found by the VAD is transcribed.
  onProgress({ phase: 'listen' });
  const vad = await request(w, { type: 'vad', id: 0, audio: audio.slice() }, undefined, signal);
  if (vad.type === 'error') throw new Error(`Speech detection failed: ${vad.message}`);
  const speech = vad.type === 'vad' ? vadSegments(vad.probs, 512 / SR) : [];
  const windows = speechWindows(speech);
  const detected = !language && windows.length > 0;
  if (detected) {
    const [a0, a1] = windows.reduce((x, y) => (y[1] - y[0] > x[1] - x[0] ? y : x));
    const r = await request(w, { type: 'detect', id: 0, audio: audio.slice(Math.floor(a0 * SR), Math.ceil(a1 * SR)), candidates: CAPTION_LANGUAGES.filter((l) => l.code).map((l) => l.code) }, undefined, signal);
    if (r.type === 'error') throw new Error(`Speech detection failed: ${r.message}`);
    if (r.type === 'language') language = CAPTION_LANGUAGES.find((l) => l.code === r.code)?.id ?? null;
  }
  const words: CaptionWord[] = [];
  for (let i = 0; i < windows.length; i++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    onProgress({ phase: 'transcribe', fraction: i / windows.length });
    const [a0, a1] = windows[i];
    const chunk = audio.slice(Math.floor(a0 * SR), Math.ceil(a1 * SR));
    const r = await request(w, { type: 'transcribe', id: 0, audio: chunk, language }, undefined, signal);
    if (r.type === 'error') throw new Error(`Transcription failed: ${r.message}`);
    if (r.type !== 'result') continue;
    for (const x of r.words) words.push({ t0: x.t0 + a0, t1: Math.max(x.t0 + 0.05, x.t1) + a0, text: x.text });
  }
  onProgress({ phase: 'transcribe', fraction: 1 });
  return {
    words: alignToSpeech(dropArtifacts(wordsInSpeech(words, speech)), speech, speech.map(([a, b]) => speechOnset(audio, SR, a, b))),
    language: windows.length ? language : null,
    detected,
    speech,
    unreadable,
  };
}

/**
 * Captions with the words of `script` and the timing of the speech (docs/09 S1), computed in the speech worker.
 * Null when the text does not belong to this speech: the caller keeps the recognized words.
 */
export async function alignToScript(script: string, tr: Transcript): Promise<ScriptCaptions | null> {
  if (!script.trim() || !tr.words.length) return null;
  const r = await request(getWorker(), { type: 'align', id: 0, script, words: tr.words, speech: tr.speech });
  if (r.type === 'error') throw new Error(r.message);
  return r.type === 'aligned' ? r.result : null;
}

/** Frees the model memory (the files stay cached for next time). */
export function releaseSpeechModel(): void {
  worker?.terminate();
  worker = null;
}
