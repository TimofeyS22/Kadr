import { noteError } from './errorLog';
import { t } from './i18n';
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
  if (e instanceof TypeError && /^(Load failed|Failed to fetch|NetworkError)/i.test(e.message)) {
    return navigator.onLine ? t('Could not reach the network. Check the connection and try again.') : t('No internet connection.');
  }
  if (e instanceof Error) return t(e.message, (e as Error & { vars?: Record<string, string | number> }).vars);
  return typeof e === 'string' ? e : 'Something went wrong';
}
