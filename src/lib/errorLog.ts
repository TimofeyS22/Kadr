// Errors the person saw, kept on this device (docs/12 stage 4, no server yet): the last 50 in IndexedDB, each with
// the kind of error, where in Kadr it happened, the version and the device — never file names, captions or other
// text of the person's. Nothing is sent: "Copy for support" puts one entry on the clipboard, `?diag` lists them all.
import { createStore, get, set, type UseStore } from 'idb-keyval';

export interface ErrorEntry {
  at: number;
  version: string;
  /** Where in Kadr: the open sheet ('captions', 'export', 'reel'…), 'editor', 'home', 'diag' or 'page'. */
  where: string;
  /** The error's class: MediaError (Kadr's own message), TypeError, RangeError, QuotaExceededError… */
  kind: string;
  /** Its message with anything personal blanked (scrub). */
  message: string;
  device: string;
}

const MAX = 50;
let store: UseStore | null = null;
const db = () => (store ??= createStore('kadr-log', 'log'));

const FILE = /[^\s/\\:"'«»“”]+\.(mp4|mov|m4v|webm|mkv|avi|3gp|jpe?g|png|heic|heif|webp|gif|avif|bmp|tiff?|m4a|mp3|wav|aiff?|aac|ogg|opus|flac|srt|vtt|zip|cube|ttf|otf|woff2?)\b/gi;

/** A message with nothing of the person's in it: quoted text, file names, paths and query strings are blanked. */
export function scrub(message: string): string {
  return message
    .replace(/(https?:\/\/[^/\s'"]+)[^\s'"]*/g, '$1/…')
    .replace(/(["«“„])[^"»”“]*(["»”“])/g, '$1…$2') // typed text, names (an API name in 'single quotes' stays)
    .replace(FILE, '[file]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 300);
}

/** Phone or computer, system and browser with their versions: enough to reproduce, nothing to single anyone out. */
export function deviceSummary(ua = navigator.userAgent): string {
  const v = (re: RegExp) => re.exec(ua)?.[1]?.replace(/_/g, '.');
  const system = /iPhone|iPad|iPod/.test(ua) ? `${/iPad/.test(ua) ? 'iPad' : 'iPhone'}, iOS ${v(/OS (\d+[_.]\d+)/) ?? '?'}`
    : /Android/.test(ua) ? `Android ${v(/Android (\d+(?:\.\d+)?)/) ?? '?'}`
    : /Mac OS X/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'other';
  const browser = /YaBrowser\/(\d+)/.test(ua) ? `Yandex ${v(/YaBrowser\/(\d+)/)}`
    : /SamsungBrowser\/(\d+)/.test(ua) ? `Samsung ${v(/SamsungBrowser\/(\d+)/)}`
    : /Edg\/(\d+)/.test(ua) ? `Edge ${v(/Edg\/(\d+)/)}`
    : /CriOS\/(\d+)/.test(ua) ? `Chrome ${v(/CriOS\/(\d+)/)}`
    : /Firefox\/(\d+)|FxiOS\/(\d+)/.test(ua) ? `Firefox ${v(/(?:Firefox|FxiOS)\/(\d+)/)}`
    : /Chrome\/(\d+)/.test(ua) ? `Chrome ${v(/Chrome\/(\d+)/)}`
    : /Version\/(\d+(?:\.\d+)?).*Safari/.test(ua) ? `Safari ${v(/Version\/(\d+(?:\.\d+)?)/)}` : 'browser ?';
  const app = typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches ? ', from the Home Screen' : '';
  return `${system}, ${browser}${app}`;
}

/** The entry for an error: Kadr's own messages keep their template and only the engine's words ({error}). */
export function entryFor(e: unknown, where: string): ErrorEntry {
  const err = e instanceof Error ? e as Error & { vars?: Record<string, string | number> } : null;
  const engine = err?.vars?.error;
  const message = err ? `${err.message}${engine !== undefined ? ` — ${engine}` : ''}` : typeof e === 'string' ? e : String(e);
  return { at: Date.now(), version: __APP_VERSION__, where, kind: err?.name || typeof e, message: scrub(message), device: deviceSummary() };
}

/** Adds an entry to the ring on this device. Never fails the caller. */
export async function logError(entry: ErrorEntry): Promise<void> {
  try {
    const list = (await get<ErrorEntry[]>('entries', db())) ?? [];
    await set('entries', [...list.slice(-(MAX - 1)), entry], db());
  } catch { /* storage blocked or full: the toast still says what happened */ }
}

/** The kept entries, oldest first. */
export async function errorLog(): Promise<ErrorEntry[]> {
  try { return (await get<ErrorEntry[]>('entries', db())) ?? []; } catch { return []; }
}

/** One entry as text to paste into a message to support. */
export const reportText = (x: ErrorEntry): string =>
  `Kadr ${x.version}, ${new Date(x.at).toISOString()}\n${x.device}\n${x.where}: ${x.kind}: ${x.message}`;

/** Keeps an error that is shown outside a toast (the export sheet, a crash) and returns its entry. */
export function keepError(e: unknown, where: string): ErrorEntry {
  const n = takeNoted();
  const x = entryFor(n?.e ?? e, where);
  void logError(x);
  return x;
}

// errorMessage() (telemetry.ts) notes the raw error behind the text it makes; the error toast that shows the text
// a moment later takes it, so every error toast can offer its details without each caller passing the error along.
let noted: { e: unknown; at: number } | null = null;
export function noteError(e: unknown): void { noted = { e, at: Date.now() }; }
export function takeNoted(): { e: unknown } | null {
  const n = noted;
  noted = null;
  return n && Date.now() - n.at < 1000 ? { e: n.e } : null;
}
