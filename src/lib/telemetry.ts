import { noteError } from './errorLog';
import { t } from './i18n';
import { RU } from './locale-ru';
import { isStaleCode, updatingMessage } from './update';
// Privacy-first product telemetry: event names and coarse numbers only, never media or text content.
// v0.1 keeps events in memory (and logs them in dev); a backend can be plugged in later behind opt-in.
type Props = Record<string, string | number | boolean>;

const OPT_OUT_KEY = 'kadr.telemetry.optout';
const buffer: { name: string; props: Props; at: number }[] = [];

export function track(name: string, props: Props = {}): void {
  try {
    if (localStorage.getItem(OPT_OUT_KEY) === '1') return;
  } catch { /* storage blocked */ }
  buffer.push({ name, props, at: Date.now() });
  if (buffer.length > 500) buffer.shift();
  if (import.meta.env.DEV) console.debug('[telemetry]', name, props);
}

/** User-facing, translated message; MediaError-style errors carry `vars` for their placeholders. */
export function errorMessage(e: unknown): string {
  noteError(e); // the error toast showing this text keeps the details (lib/errorLog.ts)
  if (isStaleCode(e)) return updatingMessage(); // the page is reloading into a new version (lib/update.ts)
  // The browser's own words ("Load failed", "The quota has been exceeded.") say nothing a person can act on.
  // Browsers report a codec taken back under the same name ("Codec reclaimed…"): that is no reason to delete projects (audit V-170).
  if (e instanceof DOMException && e.name === 'QuotaExceededError' && /codec|decod|encod/i.test(e.message)) return t('The video decoder of this device stopped. Close other apps, or restart the browser, and try again.');
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return t('Not enough storage for Kadr on this device. Delete old projects or free up space, then try again.');
  // The browser's own words are in Details; these say what happened in the person's language (audit V-139, V-113).
  if (e instanceof DOMException && e.name === 'NotReadableError') return t('This file can no longer be read. It may have been moved or deleted. Add it again.');
  if (e instanceof DOMException && ['EncodingError', 'OperationError', 'NotSupportedError', 'DataError'].includes(e.name)) return t('This device could not process the video. Close other apps and try again.');
  if (e instanceof TypeError && NETWORK.test(e.message)) {
    return navigator.onLine ? t('The server did not answer. Try again in a minute, or on another network.') : t('No internet connection.');
  }
  if (e instanceof Error && OUT_OF_MEMORY.test(e.message)) return t('This device ran out of memory for this. Close other apps and try again.');
  // Only Kadr's own sentences are said (S-1-7): a library's or an engine's words ("This audio track cannot be decoded in
  // this environment…", "Out of memory") reached Russian messages as they were. They stay in the details.
  if (e instanceof Error) return ours(e.message) ? t(e.message, (e as Error & { vars?: Record<string, string | number> }).vars) : t('Something went wrong. The details are under “Details”.');
  return typeof e === 'string' && ours(e) ? e : t('Something went wrong. The details are under “Details”.');
}

/**
 * A request that did not get through. WebKit with a service worker says it its own way (S-1-6): the worker found
 * neither the network nor a cached copy. iOS also names the connection itself.
 */
const NETWORK = /^(Load failed|Failed to fetch|NetworkError)|FetchEvent\.respondWith received an error|^no-response|The Internet connection appears to be offline|The network connection was lost/i;
const OUT_OF_MEMORY = /out of memory|allocation failed|Array buffer allocation/i;
const SAID = new Set(Object.values(RU));
/** A sentence of Kadr's: an English key of the catalog, or one already translated (a message made with t()). */
const ours = (s: string): boolean => s in RU || SAID.has(s);
