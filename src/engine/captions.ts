// Auto-captions client: mixes the timeline sound to 16 kHz mono, cuts it into ≤30 s chunks at the
// quietest moments (so words are not split), and transcribes the chunks in the ASR worker.
import { DEFAULT_VAD, GIGAAM_VAD, alignToSpeech, captionSource, dropArtifacts, speechOnset, speechWindows, vadSegments, wordsInSpeech } from '../core/captions';
import { projectDuration, soundAssetId } from '../core/timeline';
import type { ScriptCaptions } from '../core/script';
import type { CaptionWord, Project } from '../core/types';
import type { AsrModel, AsrRequest, AsrResponse } from './asr.worker';
import { renderAudioWindow, soundEntries } from './audio';
import { MediaError, MediaPool } from './media';
import type { HeapInfo } from './wasmMemory';
import { useLocale } from '../lib/i18n';

export type { AsrModel };
export const ASR_MODELS: Record<AsrModel, { label: string; mb: number }> = {
  tiny: { label: 'Fast', mb: 41 },
  base: { label: 'Accurate', mb: 77 },
  small: { label: 'Most accurate', mb: 249 },
  ru: { label: 'Russian speech', mb: 225 },
};

/** GigaAM for Russian where the interface is Russian (its speech is mostly Russian), Whisper base elsewhere. */
export const defaultAsrModel = (): AsrModel => (useLocale.getState().locale === 'ru' ? 'ru' : 'base');

/**
 * GigaAM confirms Russian speech by itself (no Whisper download) when it is at least this sure and reads at least
 * this many letters per second; otherwise Whisper detects the language. Measured on the eval set (docs/10 §2):
 * Russian 0.96–0.99, Russian under music 0.88; Ukrainian 0.84, English 0.82–0.84, Spanish 0.92 with almost no letters.
 */
const RU_SURE = 0.93, RU_LETTERS_PER_S = 5;

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

/**
 * A worker whose engine failed is replaced: ONNX Runtime remembers a backend that did not start and refuses every
 * later request in that worker, so "try again" could never work (docs/12 §1.2). Requests to it run one at a time.
 */
function retire(w: Worker): void {
  if (worker === w) worker = null;
  w.terminate();
  w.dispatchEvent(new ErrorEvent('error', { message: 'the speech engine restarted' })); // nothing left waits forever
}

/** ONNX Runtime ran out of WASM memory (iPhone, docs/12): said plainly, the engine's own words go to the log. */
const outOfMemory = (message: string) => /out of memory|maximum memory|cannot enlarge memory|failed to allocate/i.test(message);
function engineError(message: string, error: string): MediaError {
  console.error('speech engine:', message);
  return outOfMemory(message)
    ? new MediaError('Not enough memory on this device for the speech model. Close other tabs and apps and try again, or choose a smaller model.')
    : new MediaError(error, { error: message });
}

/**
 * A model in the worker holds hundreds of MB (GigaAM 225 MB plus its runtime), and a phone tab has little memory: the
 * worker goes a minute after its last request (so "Create again" stays quick) and at once when an export starts.
 * It was never let go before (QA, docs/11 §3.7).
 */
const IDLE_MS = 60_000;
let inFlight = 0;
let idle: ReturnType<typeof setTimeout> | undefined;

/** Request ids, unique per page: a reply to a cancelled request can never be taken for a newer one. */
let seq = 0;

/**
 * Sends a request to the ASR worker. With a signal, Cancel (or Settings) is honoured at once, even mid-download or
 * mid-chunk: the worker finishes that job on its own (a model download is cached for next time), its reply is dropped.
 */
function request(w: Worker, msg: AsrRequest, onDownload?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<AsrResponse> {
  return new Promise((resolve, reject) => {
    const id = msg.type !== 'load' ? (msg.id = ++seq) : undefined;
    let settled = false;
    const done = () => {
      w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      if (--inFlight === 0) idle = setTimeout(releaseSpeechModel, IDLE_MS);
    };
    const onAbort = () => { done(); reject(new DOMException('Cancelled', 'AbortError')); };
    // The worker script itself failed to load (offline before captions were ever used): fail, never wait forever.
    const onError = (e: ErrorEvent) => {
      done();
      if (worker === w) worker = null; // a new one next time
      reject(navigator.onLine ? new MediaError('Could not load the speech model ({error})', { error: e.message || 'worker' })
        : new MediaError('No internet. The speech model ({mb} MB) downloads once; after that captions work offline.', { mb: msg.type === 'load' ? ASR_MODELS[msg.model].mb : 0 }));
    };
    const onMessage = (e: MessageEvent<AsrResponse>) => {
      const r = e.data;
      if (r.type === 'download') { onDownload?.(r.loaded, r.total); return; }
      const mine = msg.type === 'load'
        ? r.type === 'ready' || r.type === 'error'
        : (r.type === 'result' || r.type === 'vad' || r.type === 'language' || r.type === 'aligned' || r.type === 'heap' || r.type === 'error') && r.id === id;
      if (!mine) return;
      done();
      if (r.type === 'error') retire(w);
      resolve(r);
    };
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    inFlight++;
    clearTimeout(idle);
    signal?.addEventListener('abort', onAbort);
    w.addEventListener('message', onMessage);
    w.addEventListener('error', onError);
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
  // 'ru' is GigaAM for Russian speech; speech in another language goes to Whisper base.
  let engine: AsrModel = model === 'ru' && language && language !== 'russian' ? 'base' : model;
  const load = async (m: AsrModel) => {
    onProgress({ phase: 'download', fraction: 0, mb: ASR_MODELS[m].mb });
    const loaded = await request(w, { type: 'load', model: m }, (l, t) => onProgress({ phase: 'download', fraction: t ? l / t : 0, mb: ASR_MODELS[m].mb }), signal);
    if (loaded.type === 'error') {
      // Offline before the first download: say what to do, not "Failed to fetch" (docs/11 QA).
      if (!navigator.onLine) throw new MediaError('No internet. The speech model ({mb} MB) downloads once; after that captions work offline.', { mb: ASR_MODELS[m].mb });
      throw engineError(loaded.message, 'Could not load the speech model ({error})');
    }
  };
  await load(engine);
  onProgress({ phase: 'prepare' });
  const skipped = new Set<string>();
  const heard = captionSource(p); // the voice, without background music (v1.4.1)
  const audio = await timelineAudio(heard, signal, skipped);
  const unreadable = [...skipped].map((id) => p.assets[id]?.name ?? '?');
  if (skipped.size && soundEntries(heard).every((e) => skipped.has(soundAssetId(e.clip)))) {
    throw new MediaError('The sound of “{name}” cannot be decoded in this browser', { name: unreadable.join(', ') });
  }
  // Whisper invents text over music and silence, so only speech found by the VAD is transcribed.
  onProgress({ phase: 'listen' });
  const vad = await request(w, { type: 'vad', id: 0, audio: audio.slice() }, undefined, signal);
  if (vad.type === 'error') throw engineError(vad.message, 'Speech detection failed ({error})');
  // Speech segments for the engine at work: lenient for GigaAM, strict for Whisper (it invents text over music).
  let speech: [number, number][] = [], windows: [number, number][] = [];
  const segment = () => {
    speech = vad.type === 'vad' ? vadSegments(vad.probs, 512 / SR, engine === 'ru' ? GIGAAM_VAD : DEFAULT_VAD) : [];
    windows = speechWindows(speech);
  };
  segment();
  const transcribe = async (i: number) => {
    const [a0, a1] = windows[i];
    const r = await request(w, { type: 'transcribe', id: 0, audio: audio.slice(Math.floor(a0 * SR), Math.ceil(a1 * SR)), language: engine === 'ru' ? null : language, model: engine }, undefined, signal);
    if (r.type === 'error') throw engineError(r.message, 'Transcription failed ({error})');
    return r.type === 'result' ? r : null;
  };
  const done = new Map<number, NonNullable<Awaited<ReturnType<typeof transcribe>>>>();
  const detected = !language && windows.length > 0;
  if (detected) {
    const longest = windows.reduce((best, x, i) => (x[1] - x[0] > windows[best][1] - windows[best][0] ? i : best), 0);
    const [a0, a1] = windows[longest];
    if (engine === 'ru') {
      const r = await transcribe(longest);
      if (r && (r.confidence ?? 0) >= RU_SURE && (r.chars ?? 0) / (a1 - a0) >= RU_LETTERS_PER_S) { language = 'russian'; done.set(longest, r); }
      else { engine = 'base'; segment(); await load(engine); }
    }
    if (!language) {
      const r = await request(w, { type: 'detect', id: 0, audio: audio.slice(Math.floor(a0 * SR), Math.ceil(a1 * SR)), candidates: CAPTION_LANGUAGES.filter((l) => l.code).map((l) => l.code) }, undefined, signal);
      if (r.type === 'error') throw engineError(r.message, 'Speech detection failed ({error})');
      if (r.type === 'language') language = CAPTION_LANGUAGES.find((l) => l.code === r.code)?.id ?? null;
      // GigaAM was unsure (Russian under loud music) but it is Russian: GigaAM still reads it best.
      if (model === 'ru' && language === 'russian') { engine = 'ru'; segment(); await load(engine); }
    }
  }
  const words: CaptionWord[] = [];
  for (let i = 0; i < windows.length; i++) {
    if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
    onProgress({ phase: 'transcribe', fraction: i / windows.length });
    const r = done.get(i) ?? (await transcribe(i));
    if (!r) continue;
    const a0 = windows[i][0];
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

export interface SpeechCheck {
  ok: boolean;
  /** Milliseconds: start of the engine, or download and start of a model. */
  loadMs: number;
  /** Milliseconds to read the sample (model check). */
  runMs?: number;
  text?: string;
  error?: string;
  heap: HeapInfo | null;
}

async function heapOf(w: Worker): Promise<HeapInfo | null> {
  const r = await request(w, { type: 'heap', id: 0 });
  return r.type === 'heap' ? { capMb: r.capMb, mb: r.mb, refused: r.refused } : null;
}

/** Diagnostics (`?diag`, docs/12 stage 0): starts ONNX Runtime with the 2 MB speech detector on a second of silence. */
export async function checkSpeechEngine(): Promise<SpeechCheck> {
  const w = getWorker();
  const t0 = performance.now();
  const r = await request(w, { type: 'vad', id: 0, audio: new Float32Array(SR) });
  const loadMs = performance.now() - t0;
  return r.type === 'error' ? { ok: false, loadMs, error: r.message, heap: r.heap } : { ok: true, loadMs, heap: await heapOf(w) };
}

/** Diagnostics: downloads and starts `model`, then reads `audio` (16 kHz mono, ≤ 28 s) in one piece. */
export async function checkSpeechModel(model: AsrModel, audio: Float32Array, language: string | null, onDownload: (fraction: number) => void): Promise<SpeechCheck> {
  const w = getWorker();
  const t0 = performance.now();
  const loaded = await request(w, { type: 'load', model }, (l, t) => onDownload(t ? l / t : 0));
  const loadMs = performance.now() - t0;
  if (loaded.type === 'error') return { ok: false, loadMs, error: loaded.message, heap: loaded.heap };
  const t1 = performance.now();
  const r = await request(w, { type: 'transcribe', id: 0, audio, language: model === 'ru' ? null : language, model });
  const runMs = performance.now() - t1;
  if (r.type === 'error') return { ok: false, loadMs, runMs, error: r.message, heap: r.heap };
  const text = r.type === 'result' ? r.words.map((x) => x.text).join(' ') : '';
  return { ok: true, loadMs, runMs, text, heap: await heapOf(w) };
}

/** Frees the model memory (the files stay cached for next time). Waits while a request is running. */
export function releaseSpeechModel(): void {
  clearTimeout(idle);
  if (inFlight > 0) return;
  worker?.terminate();
  worker = null;
}
