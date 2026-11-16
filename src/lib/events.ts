// Anonymous outcome events (G-3, V-194; docs/16 stage 3; CLAUDE.md §3.1): whether an export, captions, a reel or an
// import worked on people's phones, by device class and Kadr version — never what was in them. Only the events and the
// values listed in RULES leave the device: a name, a text or a word not on a list stays in the tab (telemetry.ts).
// Off until the site is built with a sink (KADR_EVENTS_KEY, vite.config.ts writes the meta tag and adds its one host to
// the CSP), off when the person says no (the switch at the bottom of the home screen), off under automation: tests and
// the team's own runs on a phone are not people. A failed send is dropped without a word: it is no one's error.
import { useLocale } from './i18n';
import { RU } from './locale-ru';

type Value = string | number | boolean;
type Props = Record<string, Value>;
/** A number (a whole one, 0 to a million), a yes/no, Kadr's own sentence for an error, or one of the listed words. */
type Rule = 'count' | 'flag' | 'error' | readonly string[];

/** The speech models a run can ask for or end up with (src/engine/captions.ts ASR_CHOICES; events.test.ts keeps them equal). */
export const SPEECH_MODELS = ['auto', 'ru', 'ru-fast', 'tiny', 'base', 'small'] as const;
const FORMATS = ['video', 'gif', 'audio', 'photo'] as const;

const RULES: Record<string, Record<string, Rule>> = {
  export_started: { format: FORMATS, resolution: 'count', fps: 'count', quick: 'flag', duration: 'count' },
  export_completed: { resolution: 'count', fps: 'count', quick: 'flag', seconds: 'count', mb: 'count' },
  export_failed: { resolution: 'count', fps: 'count', quick: 'flag', error: 'error' },
  export_cancelled: {},
  captions_started: { model: SPEECH_MODELS, seconds: 'count' },
  captions_generated: { model: SPEECH_MODELS, engine: SPEECH_MODELS, seconds: 'count' },
  captions_failed: { model: SPEECH_MODELS, error: 'error' },
  captions_cancelled: {},
  reel_started: { seconds: 'count', clips: 'count' },
  reel_done: { seconds: 'count', noSpeech: 'flag' },
  reel_failed: { error: 'error' },
  reel_cancelled: {},
  media_import_started: { files: 'count' },
  media_import_ended: { added: 'count', failed: 'count' },
  media_import_failed: { error: 'error' },
};

/**
 * An attempt and what ends it. One still open when Kadr starts again ended badly — the tab was killed, the phone
 * slept, the page was reloaded — and is sent then as `<kind>_abandoned` (docs/16 Z3: an attempt without an outcome is a failure).
 */
const ATTEMPTS: Record<string, { start: string; end: readonly string[] }> = {
  export: { start: 'export_started', end: ['export_completed', 'export_failed', 'export_cancelled'] },
  captions: { start: 'captions_started', end: ['captions_generated', 'captions_failed', 'captions_cancelled'] },
  reel: { start: 'reel_started', end: ['reel_done', 'reel_failed', 'reel_cancelled'] },
  media_import: { start: 'media_import_started', end: ['media_import_ended'] },
};
for (const kind of Object.keys(ATTEMPTS)) RULES[`${kind}_abandoned`] = {};

const OPT_OUT_KEY = 'kadr.telemetry.optout';
const PENDING_KEY = 'kadr.events.pending';
/** At most this many a page load: a loop of failures must not become a flood from one phone. */
const PER_LOAD = 200;

type Sink = { url: string; key: string };
let sink: Sink | null | undefined;
let sent = 0;
/** Random for this page load, kept nowhere: ties an outcome to its start, and nothing to a person (Aptabase's format). */
const sessionId = `${Math.floor(Date.now() / 1000)}${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`;

/** Where events go, from the page the site was built with; null when it was built without (every local and test build). */
export function sinkConfig(): Sink | null {
  if (sink !== undefined) return sink;
  const meta = typeof document === 'undefined' ? null : document.querySelector<HTMLMetaElement>('meta[name="kadr-events"]');
  const url = meta?.content ?? '', key = meta?.dataset.key ?? '';
  sink = /^https:\/\/[^/]+\//.test(url) && /^[\w-]+$/.test(key) ? { url, key } : null;
  return sink;
}

export function optedOut(): boolean {
  try { return localStorage.getItem(OPT_OUT_KEY) === '1'; } catch { return false; }
}

export function setOptedOut(no: boolean): void {
  try {
    if (no) { localStorage.setItem(OPT_OUT_KEY, '1'); localStorage.removeItem(PENDING_KEY); } else localStorage.removeItem(OPT_OUT_KEY);
  } catch { /* storage blocked: the choice lasts this page */ }
}

const on = (): boolean => !!sinkConfig() && !optedOut() && !navigator.webdriver;

// Kadr's sentences in either language → the English one; with a placeholder ({name}) the filled text may hold a name.
const SENTENCES = new Map<string, string>();
for (const [en, ru] of Object.entries(RU)) if (!en.includes('{')) { SENTENCES.set(en, en); SENTENCES.set(ru, en); }

/** A failure as one of Kadr's own whole sentences, in English; anything else — a browser's words, a name — is «other». */
export function errorCode(v: unknown): string {
  return (typeof v === 'string' && SENTENCES.get(v.trim())) || 'other';
}

/** Only what the event's rule lets through; other keys and values stay in the tab. */
export function cleanProps(name: string, props: Record<string, unknown>): Props | null {
  const rules = RULES[name];
  if (!rules) return null;
  const out: Props = {};
  for (const [k, rule] of Object.entries(rules)) {
    const v = props[k];
    if (v === undefined) continue;
    if (rule === 'count') { if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.min(1e6, Math.max(0, Math.round(v))); }
    else if (rule === 'flag') { if (typeof v === 'boolean') out[k] = v ? 'yes' : 'no'; }
    else if (rule === 'error') out[k] = errorCode(v);
    else if (typeof v === 'string' && rule.includes(v)) out[k] = v;
  }
  return out;
}

/** The kind of device, its system's major version and the browser's engine: the classes docs/16 Z3 counts by. */
export function deviceProps(ua: string, touchPoints: number, standalone: boolean): Props {
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && touchPoints > 1); // iPadOS says «Macintosh»
  const device = /iPhone|iPod/.test(ua) ? 'iphone' : ios ? 'ipad' : /Android/.test(ua) ? 'android' : 'desktop';
  // iOS 26 Safari keeps «OS 18_6» in its User-Agent; its own version (Version/26.x) follows the system.
  const v = (re: RegExp) => Number(ua.match(re)?.[1] ?? 0);
  const os = ios ? Math.max(v(/OS (\d+)_/), v(/Version\/(\d+)/)) : /Android/.test(ua) ? v(/Android (\d+)/) : 0;
  const browser = ios ? 'webkit' : /Firefox\//.test(ua) ? 'gecko' : /Chrome\/|Chromium\//.test(ua) ? 'blink' : /AppleWebKit\//.test(ua) ? 'webkit' : 'other';
  return { device, os, browser, standalone: standalone ? 'yes' : 'no' };
}

function here(): Props {
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  return deviceProps(navigator.userAgent, navigator.maxTouchPoints ?? 0, standalone);
}

function pending(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(PENDING_KEY) ?? '{}') as Record<string, number>; } catch { return {}; }
}

function keepPending(p: Record<string, number>): void {
  try {
    if (Object.keys(p).length) localStorage.setItem(PENDING_KEY, JSON.stringify(p)); else localStorage.removeItem(PENDING_KEY);
  } catch { /* storage blocked: an open attempt is not counted later */ }
}

function send(name: string, props: Props): void {
  const s = sinkConfig();
  if (!s || sent >= PER_LOAD) return;
  sent++;
  const body = JSON.stringify({
    timestamp: new Date().toISOString(), sessionId, eventName: name,
    systemProps: { isDebug: false, locale: useLocale.getState().locale, appVersion: __APP_VERSION__, sdkVersion: 'kadr-events@1' },
    props: { ...here(), ...props },
  });
  void fetch(s.url, {
    method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'App-Key': s.key }, body,
  }).catch(() => undefined);
}

/** An event from `track()`: sent if it is one of RULES and the person has not said no; its attempt is kept or ended. */
export function sinkEvent(name: string, props: Record<string, unknown>): void {
  if (!on()) return;
  const clean = cleanProps(name, props);
  if (!clean) return;
  const p = pending();
  let changed = false;
  for (const [kind, a] of Object.entries(ATTEMPTS)) {
    if (a.start === name) { p[kind] = Date.now(); changed = true; }
    else if (a.end.includes(name) && kind in p) { delete p[kind]; changed = true; }
  }
  if (changed) keepPending(p);
  send(name, clean);
}

/** As Kadr starts: every attempt the last run left open is sent as abandoned, once. */
export function sendAbandoned(): void {
  const p = pending();
  if (!Object.keys(p).length) return;
  keepPending({});
  if (!on()) return;
  for (const kind of Object.keys(p)) if (kind in ATTEMPTS) send(`${kind}_abandoned`, {});
}
