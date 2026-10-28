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

export const telemetryEvents = (): readonly { name: string; props: Props; at: number }[] => buffer;

/** User-facing, translated message; MediaError-style errors carry `vars` for their placeholders. */
export function errorMessage(e: unknown): string {
  noteError(e); // the error toast showing this text keeps the details (lib/errorLog.ts)
  if (isStaleCode(e)) return updatingMessage(); // the page is reloading into a new version (lib/update.ts)
  // The browser's own words ("Load failed", "The quota has been exceeded.") say nothing a person can act on.
  if (e instanceof DOMException && e.name === 'QuotaExceededError') return t('Not enough storage for Kadr on this device. Delete old projects or free up space, then try again.');
  if (e instanceof TypeError && /^(Load failed|Failed to fetch|NetworkError)/i.test(e.message)) {
    return navigator.onLine ? t('Could not reach the network. Check the connection and try again.') : t('No internet connection.');
  }
  if (e instanceof Error) return t(e.message, (e as Error & { vars?: Record<string, string | number> }).vars);
  return typeof e === 'string' ? e : 'Something went wrong';
}
