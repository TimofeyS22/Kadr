// Auto-captions client: mixes the timeline sound to 16 kHz mono, cuts it into ≤30 s chunks at the
// quietest moments (so words are not split), and transcribes the chunks in the ASR worker.
import { DEFAULT_VAD, GIGAAM_VAD, alignToSpeech, captionSource, clipToRanges, dropArtifacts, normalizeRanges, speechOnset, speechWindows, vadSegments, wordsInSpeech } from '../core/captions';
import { liftGain } from '../core/speechLevel';
import { russianVerdict, type RussianReading } from '../core/speechLanguage';
import { projectDuration, soundAssetId } from '../core/timeline';
import type { ScriptCaptions } from '../core/script';
import type { CaptionWord, Project } from '../core/types';
import type { AsrModel, AsrRequest, AsrResponse } from './asr.worker';
import { renderAudioWindow, soundEntries } from './audio';
import { MediaError, MediaPool } from './media';
import { DOWNLOAD_STOPPED, PARTS_CACHE, SPEECH_REPOS, keepModelsThroughPressure, missingBytes } from './modelFiles';
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
 * What the person chooses under "Recognition": a model, or `auto` — the model that reads the speech's language best
 * on this device (docs/20 ADR-С2). Before, the choice was a model only, and its default came from the interface
 * language: Russian speech in an English interface was read by Whisper base, with three to four times the mistakes.
 */
export type AsrChoice = AsrModel | 'auto';
export const ASR_CHOICES: readonly AsrChoice[] = ['auto', 'ru', 'ru-fast', 'tiny', 'base', 'small'];

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
export const defaultAsrModel = (): AsrModel => (useLocale.getState().locale === 'ru' ? russianModel() : fittingModel('base'));
/** The model that reads Russian speech on this device: GigaAM, on a phone FastConformer, or the one that fits. */
const russianModel = (): AsrModel => fittingModel(smallMemory() ? 'ru-fast' : 'ru');
/**
 * The model `auto` starts a run with: the one for the language the person named; with no language named, the one
 * for the language the interface is in, as the likeliest speech. The speech itself decides after that (transcribeWith).
 */
const autoModel = (language: string | null): AsrModel => (language ? (language === 'russian' ? russianModel() : fittingModel('base')) : defaultAsrModel());

/**
 * A speech model download, as the person is asked about it before it starts (audit V-181: the first tap on Captions
 * took 132–225 MB without a word, on mobile data too). `mb` is what is still to come: the whole model the first
 * time, the rest of it after a download that broke. `why`: asked in the middle of a run, because the speech turned
 * out not to be Russian (Whisper reads it), because the model before did not fit this device's memory, or because
 * the speech turned out to be Russian and the Russian model reads it far better (`russian`: the one question a "no"
 * does not end the run on — the model at work goes on).
 */
export interface ModelDownload { model: AsrModel; mb: number; why?: 'language' | 'memory' | 'russian' }
/**
 * The person's say over downloads in one run. `agreed`: the model they said yes to before the run started
 * (firstDownload). `ask` is called for any other model this device does not keep, and the run waits for the answer.
 */
export interface DownloadConsent { agreed?: AsrModel | null; ask: (d: ModelDownload) => Promise<boolean> }

/** What loading `model` would download, or null when it is on this device already. */
async function download(model: AsrModel, why?: ModelDownload['why']): Promise<ModelDownload | null> {
  const bytes = await missingBytes(SPEECH_REPOS[model]);
  return bytes ? { model, mb: Math.max(1, Math.round(bytes / 1e6)), ...(why && { why }) } : null;
}

/** The model a run loads first. A Russian model reads Russian speech; speech in another language goes to Whisper base. */
function firstEngine(choice: AsrChoice, language: string | null): AsrModel {
  if (choice === 'auto') return autoModel(language);
  const model = fittingModel(choice);
  return isRussian(model) && language && language !== 'russian' ? fittingModel('base') : model;
}
/** The model a run with this choice starts with: for the progress bar's pace and the question before a download. */
export const startingModel = firstEngine;

/** Megabytes of each model this device does not keep yet (0: it is here, nothing to download), for the chips. */
export async function modelsToDownload(): Promise<Record<AsrModel, number>> {
  const out = {} as Record<AsrModel, number>;
  for (const m of Object.keys(ASR_MODELS) as AsrModel[]) out[m] = Math.round((await missingBytes(SPEECH_REPOS[m]).catch(() => ASR_MODELS[m].mb * 1e6)) / 1e6);
  return out;
}

/**
 * What the first tap would download for captions with `model` in `language`: the sheet asks about it before it
 * starts anything. Null when that model is on this device: no question, one tap as before. Null offline too: there
 * is nothing to say yes to, and the run itself says there is no internet.
 */
export const firstDownload = async (choice: AsrChoice, language: string | null): Promise<ModelDownload | null> =>
  (navigator.onLine ? download(firstEngine(choice, language)) : null);

export const CAPTION_LANGUAGES: { id: string | null; code: string; label: string }[] = [
  { id: null, code: '', label: 'Auto' }, { id: 'english', code: 'en', label: 'English' }, { id: 'russian', code: 'ru', label: 'Русский' },
  { id: 'spanish', code: 'es', label: 'Español' }, { id: 'portuguese', code: 'pt', label: 'Português' }, { id: 'german', code: 'de', label: 'Deutsch' },
  { id: 'french', code: 'fr', label: 'Français' }, { id: 'italian', code: 'it', label: 'Italiano' }, { id: 'ukrainian', code: 'uk', label: 'Українська' },
  { id: 'turkish', code: 'tr', label: 'Türkçe' }, { id: 'hindi', code: 'hi', label: 'हिन्दी' }, { id: 'japanese', code: 'ja', label: '日本語' },
  // The rest Whisper reads: speech outside this list was given the nearest language in it and came out as nonsense (audit V-162).
  { id: 'polish', code: 'pl', label: 'Polski' }, { id: 'bulgarian', code: 'bg', label: 'Български' }, { id: 'kazakh', code: 'kk', label: 'Қазақша' },
  { id: 'uzbek', code: 'uz', label: 'Oʻzbekcha' }, { id: 'czech', code: 'cs', label: 'Čeština' }, { id: 'dutch', code: 'nl', label: 'Nederlands' },
  { id: 'romanian', code: 'ro', label: 'Română' }, { id: 'greek', code: 'el', label: 'Ελληνικά' }, { id: 'swedish', code: 'sv', label: 'Svenska' },
  { id: 'hebrew', code: 'he', label: 'עברית' }, { id: 'arabic', code: 'ar', label: 'العربية' }, { id: 'persian', code: 'fa', label: 'فارسی' },
  { id: 'chinese', code: 'zh', label: '中文' }, { id: 'korean', code: 'ko', label: '한국어' }, { id: 'vietnamese', code: 'vi', label: 'Tiếng Việt' },
  { id: 'indonesian', code: 'id', label: 'Bahasa Indonesia' }, { id: 'thai', code: 'th', label: 'ไทย' },
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
  /** The model that read the speech: the chosen one, or the one that took over (language, memory). */
  engine: AsrModel;
  /** The parts of the timeline that were listened to (seconds); null: the whole video. */
  ranges: [number, number][] | null;
}

const SR = 16000;

/**
 * What a run is doing. `download`: bytes are coming from the network, `mb` of them in this run (what the device did
 * not keep yet; the person said yes to this number). `load`: the model is on the device and is being started — no
 * network. Before docs/20 both were one phase, worded "Getting the speech model (77 MB, once)…" on every run: the
 * owner read it, rightly, as a download every time (2026-11-13).
 */
export type CaptionProgress =
  | { phase: 'download'; fraction: number; mb: number } | { phase: 'load' }
  | { phase: 'prepare' } | { phase: 'listen' } | { phase: 'transcribe'; fraction: number };

/**
 * Timeline mix as 16 kHz mono, rendered in windows to bound memory. A sound no decoder in this browser can read is
 * left out (its asset id goes to `skipped`) instead of failing the captions for everything else.
 */
async function timelineAudio(p: Project, signal: AbortSignal, skipped: Set<string>, parts: [number, number][]): Promise<Float32Array> {
  const duration = projectDuration(p);
  const total = Math.round(duration * SR);
  const out = new Float32Array(total); // silence outside the parts asked for: nothing there is decoded
  const pool = new MediaPool(16);
  // Render at 48 kHz (supported everywhere) and decimate by 3 with a box filter; plenty for speech. (A real
  // low-pass in its place was measured on 2026-11-13 and changed nothing: core/speechLevel, docs/20 Г2.)
  try {
    for (const [from, to] of parts) {
      const end = Math.min(total, Math.ceil(to * SR));
      for (let i = Math.max(0, Math.floor(from * SR)); i < end; i += SR * 20) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const j = Math.min(end, i + SR * 20);
        const buf = await renderAudioWindow(p, pool, i / SR, j / SR, SR * 3, skipped);
        const l = buf.getChannelData(0), r = buf.getChannelData(1);
        for (let k = 0; k < j - i; k++) {
          const q = k * 3;
          out[i + k] = (l[q] + r[q] + (l[q + 1] ?? 0) + (r[q + 1] ?? 0) + (l[q + 2] ?? 0) + (r[q + 2] ?? 0)) / 6;
        }
      }
    }
  } finally {
    pool.dispose();
  }
  return out;
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
  if (message.includes(DOWNLOAD_STOPPED)) return new MediaError(navigator.onLine ? 'The speech model download stopped: the server stopped answering. Tap again: it continues from where it stopped.' : 'No internet. The speech model download stopped. Tap again when you are online: it continues from where it stopped.');
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
function request(w: Worker, msg: AsrRequest, onDownload?: (loaded: number, total: number, fetched: number) => void, signal?: AbortSignal): Promise<AsrResponse> {
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
        // Online, and no newer version: the site did not answer the worker's script (S-1-10). Its own words go to the details.
        : new MediaError('The speech model did not load: the site did not answer. Try again in a minute, or on another network.', { error: e.message || 'the worker script did not load' })));
    };
    const onMessage = (e: MessageEvent<AsrResponse>) => {
      const r = e.data;
      // Every answer names its request: a load given up on (Cancel) still runs in the worker, and its progress or
      // its error must not be taken for a later request's.
      if (r.type === 'download') { if (r.id === id) onDownload?.(r.loaded, r.total, r.fetched); return; }
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
 * Transcribes the timeline, or the `ranges` of it that were asked for (seconds; docs/20 ADR-С6); returns words in
 * timeline seconds. Without a language, it is found once and then used for every chunk (one language per video, no
 * per-chunk flips). No model is downloaded without `consent`: a "no" ends the run like Cancel (AbortError), with
 * nothing changed.
 */
export async function transcribeProject(
  p: Project, choice: AsrChoice, language: string | null, onProgress: (p: CaptionProgress) => void, signal: AbortSignal, consent: DownloadConsent,
  ranges?: readonly (readonly [number, number])[] | null,
): Promise<Transcript> {
  try {
    return await transcribeWith(p, choice, language, onProgress, signal, consent, ranges ?? null);
  } finally {
    setWorking(null);
  }
}

/** How many of the longest stretches of speech a Russian model reads before it says what language this is. */
const EVIDENCE_WINDOWS = 3;

async function transcribeWith(
  p: Project, choice: AsrChoice, language: string | null, onProgress: (p: CaptionProgress) => void, signal: AbortSignal, consent: DownloadConsent,
  ranges: readonly (readonly [number, number])[] | null,
): Promise<Transcript> {
  const auto = choice === 'auto';
  let engine: AsrModel = firstEngine(choice, language);
  // The Russian model of this run: the chosen one, the one `auto` takes on this device, or the lighter one that replaced it.
  let russian: AsrModel = !auto && isRussian(fittingModel(choice)) ? fittingModel(choice) : russianModel();
  /** Models the person has said yes to in this run, or that need no download. */
  const agreed = new Set<AsrModel>(consent.agreed ? [consent.agreed] : []);
  /**
   * Every model of a run is loaded through here, the ones that take over later too (Whisper for speech that is not
   * Russian, a lighter model after one that did not fit): none of them is downloaded before the person says yes.
   * False only for `russian`, the one switch a "no" leaves the run going without (the model at work reads on).
   */
  const agree = async (m: AsrModel, why?: ModelDownload['why']): Promise<boolean> => {
    if (agreed.has(m)) return true;
    const d = await download(m, why);
    if (d) {
      if (!navigator.onLine) {
        if (why === 'russian') return false;
        // Offline before the first download: say what to do, not ask about a download that cannot start (docs/11 QA).
        throw new MediaError('No internet. The speech model ({mb} MB) downloads once; after that captions work offline.', { mb: ASR_MODELS[m].mb });
      }
      const yes = await consent.ask(d);
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      if (!yes) {
        if (why === 'russian') return false;
        throw new DOMException('Cancelled', 'AbortError');
      }
    }
    agreed.add(m);
    return true;
  };
  /** Loads `m`, or the lighter model when `m` does not fit in memory; returns the one loaded. */
  const load = async (m: AsrModel, why?: ModelDownload['why']): Promise<AsrModel> => {
    for (;;) {
      await agree(m, why === 'russian' ? undefined : why);
      // What this load takes from the network: nothing when the device keeps the model — then it only starts.
      const missing = await missingBytes(SPEECH_REPOS[m]);
      const mb = Math.max(1, Math.round(missing / 1e6));
      if (missing) void keepModelsThroughPressure();
      onProgress(missing ? { phase: 'download', fraction: 0, mb } : { phase: 'load' });
      setWorking(m);
      // A worker whose engine failed was replaced (retire): each request goes to the current one.
      const loaded = await request(getWorker(), { type: 'load', id: 0, model: m }, (_l, _t, fetched) => {
        if (missing) onProgress(fetched >= missing ? { phase: 'load' } : { phase: 'download', fraction: fetched / missing, mb });
      }, signal);
      if (loaded.type !== 'error') return m;
      // Offline before the first download: say what to do, not "Failed to fetch" (docs/11 QA).
      if (!navigator.onLine) throw new MediaError('No internet. The speech model ({mb} MB) downloads once; after that captions work offline.', { mb: ASR_MODELS[m].mb });
      const lighter = tooBigFor(loaded) ? LIGHTER[m] : undefined;
      if (!lighter) throw engineError(loaded.message, 'Could not load the speech model ({error})');
      console.warn(`speech model ${m} does not fit in this device's memory; ${lighter} takes over:`, loaded.message);
      rememberTooBig(m);
      m = lighter;
      why = 'memory';
    }
  };
  /** Moves to the lighter model after the current one ran out of memory; false if there is none. */
  const lighten = async (r: Extract<AsrResponse, { type: 'error' }>): Promise<boolean> => {
    const lighter = tooBigFor(r) ? LIGHTER[engine] : undefined;
    if (!lighter) return false;
    console.warn(`speech model ${engine} ran out of memory; ${lighter} takes over:`, r.message);
    rememberTooBig(engine);
    engine = await load(lighter, 'memory');
    if (isRussian(engine)) russian = engine;
    segment();
    return true;
  };
  engine = await load(engine);
  if (isRussian(engine)) russian = engine;
  onProgress({ phase: 'prepare' });
  const skipped = new Set<string>();
  const heard = captionSource(p); // the voice, without background music (v1.4.1)
  const duration = projectDuration(heard);
  // The parts to listen to: the ones asked for, or the whole video. Nothing outside them is decoded or read.
  const parts: [number, number][] = ranges ? normalizeRanges(ranges, duration) : [[0, duration]];
  const audio = await timelineAudio(heard, signal, skipped, parts);
  // A quiet recording is lifted before speech is looked for in it (core/speechLevel); a normal one is untouched.
  const lift = liftGain(audio, SR);
  if (lift !== 1) { for (let k = 0; k < audio.length; k++) audio[k] *= lift; console.info(`speech: a quiet recording, lifted ×${lift.toFixed(1)}`); }
  const unreadable = [...skipped].map((id) => p.assets[id]?.name ?? '?');
  if (skipped.size && soundEntries(heard).every((e) => skipped.has(soundAssetId(e.clip)))) {
    throw new MediaError('The sound of “{name}” cannot be decoded in this browser', { name: unreadable.join(', ') });
  }
  // Whisper invents text over music and silence, so only speech found by the VAD is transcribed.
  onProgress({ phase: 'listen' });
  const FRAME = 512;
  const probs = new Float32Array(Math.floor(audio.length / FRAME));
  for (const [from, to] of parts) {
    // Each part from a frame boundary, with a detector that starts fresh: what came before the part is not its past.
    const f0 = Math.floor((from * SR) / FRAME), f1 = Math.min(probs.length, Math.ceil((to * SR) / FRAME));
    if (f1 <= f0) continue;
    const vad = await request(getWorker(), { type: 'vad', id: 0, audio: audio.slice(f0 * FRAME, f1 * FRAME) }, undefined, signal);
    if (vad.type === 'error') throw engineError(vad.message, 'Speech detection failed. Try again; the details are under “Details”.');
    if (vad.type === 'vad') probs.set(vad.probs.subarray(0, f1 - f0), f0);
  }
  // Speech segments for the engine at work: lenient for the Russian CTC models, strict for Whisper (it invents text
  // over music; CTC models do not).
  let speech: [number, number][] = [], windows: [number, number][] = [];
  function segment() {
    const found = vadSegments(probs, FRAME / SR, isRussian(engine) ? GIGAAM_VAD : DEFAULT_VAD);
    speech = ranges ? clipToRanges(found, parts) : found; // the detector's padding does not reach outside a part
    windows = speechWindows(speech);
  }
  segment();
  const cut = (i: number) => audio.slice(Math.floor(windows[i][0] * SR), Math.ceil(windows[i][1] * SR));
  const transcribe = async (i: number): Promise<Extract<AsrResponse, { type: 'result' }> | null> => {
    const r = await request(getWorker(), { type: 'transcribe', id: 0, audio: cut(i), language: isRussian(engine) ? null : language, model: engine }, undefined, signal);
    if (r.type === 'error') {
      if (await lighten(r)) return transcribe(i);
      throw engineError(r.message, 'Speech recognition failed. Try again; the details are under “Details”.');
    }
    return r.type === 'result' ? r : null;
  };
  /** Windows already read by the engine at work (the evidence of the language): not read twice. */
  const done = new Map<number, NonNullable<Awaited<ReturnType<typeof transcribe>>>>();
  const longestFirst = () => windows.map((_, i) => i).sort((x, y) => (windows[y][1] - windows[y][0]) - (windows[x][1] - windows[x][0]));
  const detected = !language && windows.length > 0;
  if (detected) {
    if (isRussian(engine)) {
      // The Russian model says whether this is Russian speech by reading it (core/speechLanguage): no Whisper, no
      // download, and what it read is kept. Only speech it does not take for Russian goes to Whisper.
      const readings: RussianReading[] = [];
      let verdict = russianVerdict(engine, readings);
      for (const i of longestFirst().slice(0, EVIDENCE_WINDOWS)) {
        const was: AsrModel = engine;
        const r = await transcribe(i);
        if (engine !== was) { done.clear(); readings.length = 0; } // a lighter model took over: its own evidence
        if (!r) continue;
        done.set(i, r);
        readings.push({ confidence: r.confidence ?? 0, seconds: windows[i][1] - windows[i][0], words: r.words.map((w) => w.text) });
        if (isRussian(engine)) verdict = russianVerdict(engine, readings);
        if (verdict !== 'unsure') break;
      }
      console.info(`speech language by ${engine}: ${verdict}`, JSON.stringify(readings.map((x) => ({ confidence: +x.confidence.toFixed(3), seconds: +x.seconds.toFixed(1), text: x.words.join(' ').slice(0, 160) }))));
      if (verdict === 'russian') language = 'russian';
      else { done.clear(); engine = await load(fittingModel('base'), 'language'); segment(); }
    }
    if (!language && windows.length) {
      const r = await request(getWorker(), { type: 'detect', id: 0, audio: cut(longestFirst()[0]), candidates: CAPTION_LANGUAGES.filter((l) => l.code).map((l) => l.code), model: engine }, undefined, signal);
      if (r.type === 'error') throw engineError(r.message, 'Speech detection failed. Try again; the details are under “Details”.');
      if (r.type === 'language') language = CAPTION_LANGUAGES.find((l) => l.code === r.code)?.id ?? null;
      console.info(`speech language by ${engine}: ${language}`, r.type === 'language' ? r.p.toFixed(3) : '');
    }
  }
  // Russian speech is read by the Russian model whenever the choice allows it (docs/20 ADR-С2): `auto` always — also
  // when the run began with Whisper (an interface that is not Russian, or a language found by Whisper); a chosen
  // Russian model that was unsure under loud music comes back, it still reads Russian best. A chosen Whisper stays:
  // the person named it, and the sheet says the Russian model makes fewer mistakes.
  if (language === 'russian' && !isRussian(engine) && (auto || isRussian(fittingModel(choice as AsrModel))) && windows.length) {
    if (await agree(russian, 'russian')) { done.clear(); engine = await load(russian, 'russian'); if (isRussian(engine)) russian = engine; segment(); }
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
    engine,
    ranges: ranges ? parts : null,
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
