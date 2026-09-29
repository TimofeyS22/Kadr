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

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return typeof e === 'string' ? e : 'Something went wrong';
}
