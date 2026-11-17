// The anonymous statistics sink (G-3, V-194): what leaves the device, when, and what never does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RU } from './locale-ru';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPAD = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15';
const PIXEL = 'Mozilla/5.0 (Linux; Android 15; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36';
const MAC_CHROME = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:144.0) Gecko/20100101 Firefox/144.0';

const MARKS = ['kadrfilemark7q.mp4', 'Секретнаястрока9', 'Мой отпуск'];
let store: Map<string, string>;
let sent: { url: string; init: RequestInit }[];

/** A page of the site: with a sink in its meta tag or not, run by a person or by a test robot. */
function page({ sink = true, webdriver = false, ua = IPHONE } = {}) {
  store = new Map();
  sent = [];
  const meta = sink ? { content: 'https://eu.aptabase.com/api/v0/event', dataset: { key: 'A-EU-123' } } : null;
  vi.stubGlobal('document', { querySelector: (s: string) => (s === 'meta[name="kadr-events"]' ? meta : null) });
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k),
  });
  vi.stubGlobal('navigator', { userAgent: ua, maxTouchPoints: 5, webdriver, language: 'ru-RU' });
  vi.stubGlobal('matchMedia', () => ({ matches: true }));
  vi.stubGlobal('fetch', (url: string, init: RequestInit) => { sent.push({ url, init }); return Promise.resolve(new Response(null, { status: 200 })); });
}
const load = async () => { vi.resetModules(); return import('./events'); };
const bodies = () => sent.map((s) => JSON.parse(String(s.init.body)) as { eventName: string; props: Record<string, unknown>; systemProps: Record<string, unknown> });

beforeEach(() => page());
afterEach(() => vi.unstubAllGlobals());

describe('what leaves the device (G-3)', () => {
  it('only the listed outcome events, only their listed values: no name, text or browser words, in any prop', async () => {
    const ev = await load();
    ev.sinkEvent('export_started', { format: 'video', resolution: 1080, fps: 30, quality: 'high', loudness: true, quick: false, duration: 12.6, name: MARKS[0] });
    ev.sinkEvent('export_failed', { resolution: 1080, fps: 30, quick: false, error: `Could not add ${MARKS[0]}: Load failed` });
    ev.sinkEvent('media_import_failed', { error: RU['Not enough storage for Kadr on this device. Delete old projects or free up space, then try again.'] }); // as a Russian interface says it
    ev.sinkEvent('captions_generated', { model: 'ru', engine: MARKS[1], seconds: 41.2, words: 120, lang: 'auto' });
    ev.sinkEvent('text_added', { text: MARKS[1] }); // not an outcome: stays in the tab
    ev.sinkEvent('project_renamed', { name: MARKS[2] });
    const b = bodies();
    expect(b.map((x) => x.eventName)).toEqual(['export_started', 'export_failed', 'media_import_failed', 'captions_generated']);
    expect(b[0].props).toMatchObject({ format: 'video', resolution: 1080, fps: 30, quick: 'no', duration: 13 });
    expect(b[0].props).not.toHaveProperty('quality');
    expect(b[0].props).not.toHaveProperty('name');
    expect(b[1].props.error, 'a sentence with a name filled in is «other»').toBe('other');
    expect(b[2].props.error, 'Kadr\'s own sentence, in English whatever the interface').toBe('Not enough storage for Kadr on this device. Delete old projects or free up space, then try again.');
    expect(b[3].props).toMatchObject({ model: 'ru', seconds: 41 });
    expect(b[3].props).not.toHaveProperty('engine'); // not one of the models
    expect(b[3].props).not.toHaveProperty('words');
    const all = JSON.stringify(sent);
    for (const m of MARKS) expect(all).not.toContain(m);
    // The request: no cookies, no referrer, the key, the one address.
    expect(sent.every((s) => s.url === 'https://eu.aptabase.com/api/v0/event')).toBe(true);
    expect(sent[0].init).toMatchObject({ method: 'POST', credentials: 'omit', referrerPolicy: 'no-referrer' });
    expect((sent[0].init.headers as Record<string, string>)['App-Key']).toBe('A-EU-123');
    expect(b[0].systemProps).toMatchObject({ isDebug: false, appVersion: expect.any(String) });
    expect(b[0].props).toMatchObject({ device: 'iphone', os: 26, browser: 'webkit', standalone: 'yes' });
  });

  it('nothing is sent without a sink, after the person says no, or under a test robot', async () => {
    page({ sink: false });
    (await load()).sinkEvent('export_started', { format: 'video' });
    expect(sent).toEqual([]);
    page();
    let ev = await load();
    ev.setOptedOut(true);
    ev.sinkEvent('export_started', { format: 'video' });
    expect(sent).toEqual([]);
    expect(ev.optedOut()).toBe(true);
    ev.setOptedOut(false);
    ev.sinkEvent('export_started', { format: 'video' });
    expect(sent).toHaveLength(1);
    page({ webdriver: true });
    ev = await load();
    ev.sinkEvent('export_started', { format: 'video' });
    expect(sent).toEqual([]);
  });

  it('an attempt left without an outcome is sent as abandoned when Kadr starts again, once; one that ended is not', async () => {
    let ev = await load();
    ev.sinkEvent('export_started', { format: 'video' });
    ev.sinkEvent('captions_started', { model: 'ru' });
    ev.sinkEvent('captions_generated', { model: 'ru' });
    ev.sinkEvent('media_import_started', { files: 2 });
    sent = [];
    ev = await load(); // the tab was killed during the export and the import; the page opens again
    ev.sendAbandoned();
    expect(bodies().map((b) => b.eventName).sort()).toEqual(['export_abandoned', 'media_import_abandoned']);
    sent = [];
    ev = await load();
    ev.sendAbandoned();
    expect(sent).toEqual([]);
  });

  it('a person who said no leaves no open attempts behind to be sent later', async () => {
    const ev = await load();
    ev.sinkEvent('export_started', { format: 'video' });
    ev.setOptedOut(true);
    sent = [];
    (await load()).sendAbandoned();
    expect(sent).toEqual([]);
  });

  it('a loop of failures sends at most 200 a page load', async () => {
    const ev = await load();
    for (let i = 0; i < 1000; i++) ev.sinkEvent('media_import_failed', { error: 'x' });
    expect(sent).toHaveLength(200);
  });
});

describe('the device classes docs/16 Z3 counts by', () => {
  it('iPhone, iPad (which says «Macintosh»), Android, computers', async () => {
    const { deviceProps } = await load();
    expect(deviceProps(IPHONE, 5, false)).toEqual({ device: 'iphone', os: 26, browser: 'webkit', standalone: 'no' });
    expect(deviceProps(IPAD, 5, true)).toEqual({ device: 'ipad', os: 26, browser: 'webkit', standalone: 'yes' });
    expect(deviceProps(PIXEL, 5, false)).toEqual({ device: 'android', os: 15, browser: 'blink', standalone: 'no' });
    expect(deviceProps(MAC_CHROME, 0, false)).toEqual({ device: 'desktop', os: 0, browser: 'blink', standalone: 'no' });
    expect(deviceProps(FIREFOX, 0, false)).toMatchObject({ device: 'desktop', browser: 'gecko' });
  });
});

describe('the lists match what the app says', () => {
  it('the speech models are the captions sheet\'s choices', async () => {
    const src = readFileSync(join(import.meta.dirname, '..', 'engine', 'captions.ts'), 'utf8');
    const choices = [...src.match(/ASR_CHOICES: readonly AsrChoice\[\] = \[([^\]]+)\]/)![1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect([...(await load()).SPEECH_MODELS]).toEqual(choices);
  });

  it('every error a sink may name is a sentence of the catalog, in either language', async () => {
    const { errorCode } = await load();
    const [en, ru] = Object.entries(RU).find(([k]) => !k.includes('{'))!;
    expect(errorCode(en)).toBe(en);
    expect(errorCode(ru)).toBe(en);
    expect(errorCode('Load failed')).toBe('other');
    expect(errorCode(undefined)).toBe('other');
  });
});
