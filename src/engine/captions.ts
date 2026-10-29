// Auto-captions client: mixes the timeline sound to 16 kHz mono, cuts it into ≤30 s chunks at the
// quietest moments (so words are not split), and transcribes the chunks in the ASR worker.
import { DEFAULT_VAD, GIGAAM_VAD, alignToSpeech, captionSource, dropArtifacts, speechOnset, speechWindows, vadSegments, wordsInSpeech } from '../core/captions';
import { projectDuration, soundAssetId } from '../core/timeline';
import type { ScriptCaptions } from '../core/script';
import type { CaptionWord, Project } from '../core/types';
import type { AsrModel, AsrRequest, AsrResponse } from './asr.worker';
import { renderAudioWindow, soundEntries } from './audio';
import { MediaError, MediaPool } from './media';
import { DOWNLOAD_STOPPED, PARTS_CACHE } from './modelFiles';
import type { HeapInfo } from './wasmMemory';
import { IOS } from '../lib/device';
import { useLocale } from '../lib/i18n';
import { isStaleCode, newerVersionDeployed, reloadIntoUpdate, updatingMessage } from '../lib/update';
import { keepAwake } from '../lib/wakeLock';

export type { AsrModel };
export const ASR_MODELS: Record<AsrModel, { label: string; mb: number }> = {
  tiny: { label: 'Fast', mb: 41 },
  base: { label: 'Accurate', mb: 77 },
  small: { label: 'Most accurate', mb: 249 },
  ru: { label: 'Russian speech', mb: 225 },
  'ru-fast': { label: 'Russian speech, compact', mb: 132 },
};
const isRussian = (m: AsrModel): m is 'ru' | 'ru-fast' => m === 'ru' || m === 'ru-fast';

/**
 * The next lighter model, for when one does not fit this device's memory: captions still come, from a smaller
 * model, instead of an error (docs/12 rule 10). GigaAM's heap peaks at ~480 MB, FastConformer's at a fraction.
 */
const LIGHTER: Partial<Record<AsrModel, AsrModel>> = { ru: 'ru-fast', small: 'base', base: 'tiny' };

// iOS gives no error when a tab takes too much memory: it ends the page and loads it again, in the same tab. A big
// model that was loading or listening in this tab, on screen, when that happened is too big for this device: it is
// not tried here again for TOO_BIG_MS (a browser update or a freer phone may fit it later). The mark lives in
// sessionStorage — this tab only, so another tab's work is never taken for this tab's crash — and only while the
// page is on screen: a page ended in the background, or swiped away, was not necessarily short of memory.
const WORKING_KEY = 'kadr.speech.working', TOO_BIG_KEY = 'kadr.speech.tooBig', TOO_BIG_MS = 14 * 864e5;
const tooBigAt = (): Partial<Record<AsrModel, number>> => { try { return JSON.parse(localStorage.getItem(TOO_BIG_KEY) ?? '{}') as Partial<Record<AsrModel, number>>; } catch { return {}; } };
const tooBig = (): AsrModel[] => Object.entries(tooBigAt()).filter(([, at]) => Date.now() - (at ?? 0) < TOO_BIG_MS).map(([m]) => m as AsrModel);
function rememberTooBig(m: AsrModel): void {
  try { localStorage.setItem(TOO_BIG_KEY, JSON.stringify({ ...tooBigAt(), [m]: Date.now() })); } catch { /* storage off */ }
}
let working: AsrModel | null = null;
function markWorking(): void {
  try {
    if (working && document.visibilityState === 'visible') sessionStorage.setItem(WORKING_KEY, JSON.stringify({ model: working, at: Date.now() }));
    else sessionStorage.removeItem(WORKING_KEY);
  } catch { /* storage off */ }
}
const setWorking = (m: AsrModel | null) => { working = m; markWorking(); };
if (typeof document !== 'undefined') {
  try {
    const died = JSON.parse(sessionStorage.getItem(WORKING_KEY) ?? 'null') as { model: AsrModel; at: number } | null;
    if (died && Date.now() - died.at < 30 * 60_000) { rememberTooBig(died.model); console.warn(`this tab ended while ${died.model} was working: it is too big for this device`); }
    sessionStorage.removeItem(WORKING_KEY);
  } catch { /* storage off */ }
  document.addEventListener('visibilitychange', markWorking);
  addEventListener('pagehide', () => { working = null; markWorking(); }); // closing the page on purpose
}

/** `m`, or the lighter model that replaces it on this device (it did not fit before). */
export function fittingModel(m: AsrModel): AsrModel {
  const banned = tooBig();
  while (banned.includes(m) && LIGHTER[m]) m = LIGHTER[m]!;
  return m;
}

/** A phone or tablet whose memory does not hold GigaAM: every iPhone and iPad (docs/12 §1.2), Android with ≤ 4 GB. */
const smallMemory = () => IOS || ((navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8) <= 4;

/**
 * Where the interface is Russian (its speech is mostly Russian): GigaAM, or on a phone FastConformer (docs/12 §6.3).
 * Elsewhere Whisper base.
 */
export const defaultAsrModel = (): AsrModel => fittingModel(useLocale.getState().locale === 'ru' ? (smallMemory() ? 'ru-fast' : 'ru') : 'base');

/**
 * A Russian model confirms Russian speech by itself (no Whisper download) when it is at least this sure and reads at
 * least this many letters per second; otherwise Whisper detects the language. Measured on the eval set:
 * - GigaAM (docs/10 §2): Russian 0.96–0.99, under music 0.88; Ukrainian 0.84, English 0.82–0.84, Spanish 0.92 with
 *   almost no letters.
 * - FastConformer (2026-10-29): Russian 0.925–0.96, under music 0.85; Ukrainian 0.79, German 0.68, English 0.69,
 *   Italian 0.59, Spanish 0.55. Russian reads 7–12 letters/s.
 */
const SURE: Record<'ru' | 'ru-fast', { confidence: number; letters: number }> = {
  ru: { confidence: 0.93, letters: 5 },
  'ru-fast': { confidence: 0.88, letters: 5 },
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
/**
 * The page holds the model parts' cache open: where the browser keeps site data only in memory (Safari Private
 * Browsing; WebKit test sessions), what a worker alone wrote is dropped when it ends, and a download that broke
 * would start over instead of going on (FACT, WebKit 2026-10-28).
 */
let partsHeld: Promise<Cache | null> | null = null;
function getWorker(): Worker {
  partsHeld ??= typeof caches === 'undefined' ? Promise.resolve(null) : caches.open(PARTS_CACHE).catch(() => null);
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
// ONNX Runtime words it as "std::bad_alloc" when a session does not fit the heap it has (FACT, 2026-10-29: GigaAM in a
// 384 MB heap).
const outOfMemory = (message: string) => /out of memory|maximum memory|cannot enlarge memory|failed to allocate|bad_alloc|\bOOM\b/i.test(message);
/**
 * The model, not the device, is the problem: the engine had its heap and the model outgrew it. Without a heap the
 * engine did not start at all, and a lighter model would not either.
 */
const tooBigFor = (r: Extract<AsrResponse, { type: 'error' }>) => outOfMemory(r.message) && r.heap?.capMb != null;
function engineError(message: string, error: string): MediaError {
  console.error('speech engine:', message);
  if (message.includes(DOWNLOAD_STOPPED)) return new MediaError('The speech model download stopped. Check the connection and tap again: it continues from where it stopped.');
  if (/quota/i.test(message)) return new MediaError('Not enough storage for Kadr on this device. Delete old projects or free up space, then try again.');
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
/** The screen stays on while the worker downloads or listens (a dark phone suspends the page, docs/12 stage 2). */
let awake: (() => void) | null = null;

/** Request ids, unique per page: a reply to a cancelled request can never be taken for a newer one. */
let seq = 0;

/**
 * Sends a request to the ASR worker. With a signal, Cancel (or Settings) is honoured at once, even mid-download or
 * mid-chunk: the worker finishes that job on its own (a model download is cached for next time), its reply is dropped.
 */
function request(w: Worker, msg: AsrRequest, onDownload?: (loaded: number, total: number) => void, signal?: AbortSignal): Promise<AsrResponse> {
  return new Promise((resolve, reject) => {
    const id = (msg.id = ++seq);
    let settled = false;
    const done = () => {
      w.removeEventListener('message', onMessage); w.removeEventListener('error', onError); signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      if (--inFlight === 0) { idle = setTimeout(releaseSpeechModel, IDLE_MS); awake?.(); awake = null; }
    };
    const onAbort = () => { done(); reject(new DOMException('Cancelled', 'AbortError')); };
    // While the version check below runs, Cancel still works (the request is no longer in flight).
    const cancellable = () => signal?.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    // The worker script itself failed to load (offline before captions were ever used, or a deploy removed it under
    // this tab — docs/12): fail, never wait forever; after a deploy the page reloads into the new version.
    const onError = (e: ErrorEvent) => {
      done();
      if (worker === w) worker = null; // a new one next time
      if (!navigator.onLine) {
        reject(new MediaError('No internet. The speech model ({mb} MB) downloads once; after that captions work offline.', { mb: msg.type === 'load' ? ASR_MODELS[msg.model].mb : 0 }));
        return;
      }
      cancellable();
      void newerVersionDeployed().then((updated) => reject(updated && reloadIntoUpdate(true)
        ? new Error(updatingMessage())
        : new MediaError('Could not load the speech model ({error})', { error: e.message || 'worker' })));
    };
    const onMessage = (e: MessageEvent<AsrResponse>) => {
      const r = e.data;
      // Every answer names its request: a load given up on (Cancel) still runs in the worker, and its progress or
      // its error must not be taken for a later request's.
      if (r.type === 'download') { if (r.id === id) onDownload?.(r.loaded, r.total); return; }
      const mine = r.id === id && (msg.type === 'load' ? r.type === 'ready' || r.type === 'error' : r.type !== 'ready');
      if (!mine) return;
      done();
      if (r.type === 'error') {
        retire(w);
        // ONNX Runtime could not import its own files: a deploy removed them under this tab (docs/12).
        if (isStaleCode(r.message)) { cancellable(); void newerVersionDeployed().then((updated) => { if (updated) reloadIntoUpdate(true); resolve(r); }); return; }
      }
      resolve(r);
    };
    if (signal?.aborted) { reject(new DOMException('Cancelled', 'AbortError')); return; }
    if (inFlight++ === 0) awake ??= keepAwake();
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
  model = fittingModel(model);
  try {
    return await transcribeWith(p, model, language, onProgress, signal);
  } finally {
    setWorking(null);
  }
}

async function transcribeWith(
  p: Project, model: AsrModel, language: string | null, onProgress: (p: CaptionProgress) => void, signal: AbortSignal,
): Promise<Transcript> {
  // A Russian model reads Russian speech; speech in another language goes to Whisper base.
  let engine: AsrModel = isRussian(model) && language && language !== 'russian' ? fittingModel('base') : model;
  // The Russian model of this run: the chosen one, or the lighter one that replaced it.
  let russian: AsrModel = model;
  /** Loads `m`, or the lighter model when `m` does not fit in memory; returns the one loaded. */
  const load = async (m: AsrModel): Promise<AsrModel> => {
    for (;;) {
      onProgress({ phase: 'download', fraction: 0, mb: ASR_MODELS[m].mb });
      setWorking(m);
      // A worker whose engine failed was replaced (retire): each request goes to the current one.
      const loaded = await request(getWorker(), { type: 'load', id: 0, model: m }, (l, t) => onProgress({ phase: 'download', fraction: t ? l / t : 0, mb: ASR_MODELS[m].mb }), signal);
      if (loaded.type !== 'error') return m;
      // Offline before the first download: say what to do, not "Failed to fetch" (docs/11 QA).
      if (!navigator.onLine) throw new MediaError('No internet. The speech model ({mb} MB) downloads once; after that captions work offline.', { mb: ASR_MODELS[m].mb });
      const lighter = tooBigFor(loaded) ? LIGHTER[m] : undefined;
      if (!lighter) throw engineError(loaded.message, 'Could not load the speech model ({error})');
      console.warn(`speech model ${m} does not fit in this device's memory; ${lighter} takes over:`, loaded.message);
      rememberTooBig(m);
      m = lighter;
    }
  };
  /** Moves to the lighter model after the current one ran out of memory; false if there is none. */
  const lighten = async (r: Extract<AsrResponse, { type: 'error' }>): Promise<boolean> => {
    const lighter = tooBigFor(r) ? LIGHTER[engine] : undefined;
    if (!lighter) return false;
    console.warn(`speech model ${engine} ran out of memory; ${lighter} takes over:`, r.message);
    rememberTooBig(engine);
    engine = await load(lighter);
    if (isRussian(engine)) russian = engine;
    segment();
    return true;
  };
  engine = await load(engine);
  if (isRussian(engine)) russian = engine;
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
  const vad = await request(getWorker(), { type: 'vad', id: 0, audio: audio.slice() }, undefined, signal);
  if (vad.type === 'error') throw engineError(vad.message, 'Speech detection failed ({error})');
  // Speech segments for the engine at work: lenient for the Russian CTC models, strict for Whisper (it invents text
  // over music; CTC models do not).
  let speech: [number, number][] = [], windows: [number, number][] = [];
  function segment() {
    speech = vad.type === 'vad' ? vadSegments(vad.probs, 512 / SR, isRussian(engine) ? GIGAAM_VAD : DEFAULT_VAD) : [];
    windows = speechWindows(speech);
  }
  segment();
  const transcribe = async (i: number): Promise<Extract<AsrResponse, { type: 'result' }> | null> => {
    const [a0, a1] = windows[i];
    const r = await request(getWorker(), { type: 'transcribe', id: 0, audio: audio.slice(Math.floor(a0 * SR), Math.ceil(a1 * SR)), language: isRussian(engine) ? null : language, model: engine }, undefined, signal);
    if (r.type === 'error') {
      if (await lighten(r)) return transcribe(i);
      throw engineError(r.message, 'Transcription failed ({error})');
    }
    return r.type === 'result' ? r : null;
  };
  const done = new Map<number, NonNullable<Awaited<ReturnType<typeof transcribe>>>>();
  const detected = !language && windows.length > 0;
  if (detected) {
    const longest = windows.reduce((best, x, i) => (x[1] - x[0] > windows[best][1] - windows[best][0] ? i : best), 0);
    const [a0, a1] = windows[longest];
    if (isRussian(engine)) {
      const r = await transcribe(longest);
      const sure = SURE[isRussian(engine) ? engine : 'ru'];
      if (r && (r.confidence ?? 0) >= sure.confidence && (r.chars ?? 0) / (a1 - a0) >= sure.letters) { language = 'russian'; done.set(longest, r); }
      else { engine = await load(fittingModel('base')); segment(); }
    }
    if (!language) {
      const r = await request(getWorker(), { type: 'detect', id: 0, audio: audio.slice(Math.floor(a0 * SR), Math.ceil(a1 * SR)), candidates: CAPTION_LANGUAGES.filter((l) => l.code).map((l) => l.code) }, undefined, signal);
      if (r.type === 'error') throw engineError(r.message, 'Speech detection failed ({error})');
      if (r.type === 'language') language = CAPTION_LANGUAGES.find((l) => l.code === r.code)?.id ?? null;
      // The Russian model was unsure (Russian under loud music) but it is Russian: it still reads it best.
      if (isRussian(model) && language === 'russian') { engine = await load(russian); segment(); }
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
  const loaded = await request(w, { type: 'load', id: 0, model }, (l, t) => onDownload(t ? l / t : 0));
  const loadMs = performance.now() - t0;
  if (loaded.type === 'error') return { ok: false, loadMs, error: loaded.message, heap: loaded.heap };
  const t1 = performance.now();
  const r = await request(w, { type: 'transcribe', id: 0, audio, language: isRussian(model) ? null : language, model });
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
