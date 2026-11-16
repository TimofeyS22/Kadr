// Shared hooks and helpers of the sweep's lane D tests (docs/21 §3: qa-sound-*, qa-text-*, qa-export-*, qa-platform-*).
// The same audits as e2e/editor.spec.ts, plus one it only collects: a console error nobody has explained fails the test
// (QA matrix Q-2, docs/11 §1.6). Each explained one below says why it is not a defect of Kadr.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const ALLOWED_HOSTS = [/^localhost$/, /^127\.0\.0\.1$/, /^timofeys22\.github\.io$/, /^huggingface\.co$/, /\.huggingface\.co$/, /\.hf\.co$/];
const KNOWN_BLOCKED = [/^odml\.pa\.googleapis\.com$/];

/**
 * Console errors that are not Kadr's: each with the reason. Anything else fails the test (Q-2). A test that provokes an
 * error on purpose (a refused decoder, no network) passes its own patterns to `expectedConsole`.
 */
export const EXPLAINED_CONSOLE: { re: RegExp; why: string }[] = [
  // MediaPipe's own telemetry to Google; the CSP stops it (KNOWN_BLOCKED). Kadr never asks for it.
  { re: /odml\.pa\.googleapis\.com/, why: 'MediaPipe telemetry, blocked by the CSP' },
  { re: /^INFO: Created TensorFlow Lite XNNPACK delegate/, why: 'MediaPipe prints an info line through console.error' },
];

const state = { pageErrors: [] as string[], console: [] as string[], network: [] as { method: string; url: string; body: number }[], blocked: [] as string[], expected: [] as RegExp[] };

/** Patterns of console errors this test causes on purpose (a refused decoder, the network taken away). */
export function expectedConsole(...re: RegExp[]) { state.expected.push(...re); }

/** Registers the audits on every test of the spec file that calls it (privacy, page errors, error toasts, console). */
export function audits(opts: { locale?: 'en' | 'ru'; quick?: boolean } = {}) {
  test.beforeEach(async ({ page }) => {
    state.pageErrors.length = 0; state.console.length = 0; state.network.length = 0; state.blocked.length = 0; state.expected.length = 0;
    page.context().on('request', (r) => {
      if (/^(blob|data):/.test(r.url())) return;
      state.network.push({ method: r.method(), url: r.url(), body: r.postDataBuffer()?.length ?? 0 });
    });
    page.on('console', (m) => {
      if (m.type() === 'error') state.console.push(m.text().slice(0, 400));
      const csp = /(?:Refused to connect to|Connecting to|cannot load) '?(https?:\/\/[^'\s]+)'?[^]*Content Security Policy/.exec(m.text());
      if (csp) state.blocked.push(csp[1]);
    });
    page.on('pageerror', (e) => state.pageErrors.push(e.message));
    await page.addInitScript(({ locale, quick }) => {
      localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
      localStorage.setItem('kadr.undoMoved.v1', '1');
      localStorage.setItem('kadr.locale', locale);
      localStorage.setItem('kadr.hint.move', '1');
      if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick }));
      Object.defineProperty(navigator, 'canShare', { value: undefined });
      const w = window as unknown as { __toastErrors: string[]; __toasts: string[] };
      const seen: string[] = (w.__toastErrors = []);
      const all: string[] = (w.__toasts = []);
      new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
        const text = el.textContent ?? '';
        if (!all.includes(text)) all.push(text);
        if (el.classList.contains('error') && !seen.includes(text)) seen.push(text);
      })).observe(document, { subtree: true, childList: true });
    }, { locale: opts.locale ?? 'en', quick: opts.quick ?? false });
  });
  test.afterEach(async ({ page }, info) => {
    const outside = state.network.filter((r) => !ALLOWED_HOSTS.some((h) => h.test(new URL(r.url).hostname)));
    expect(outside.map((r) => `${r.method} ${r.url}`), 'requests to hosts outside the CSP allow-list').toEqual([]);
    const sent = state.network.filter((r) => (r.method !== 'GET' && r.method !== 'HEAD') && !(new URL(r.url).pathname.endsWith('/share-target')));
    expect(sent.map((r) => `${r.method} ${r.url} (${r.body} bytes)`), 'requests that send data').toEqual([]);
    expect(state.blocked.filter((u) => !KNOWN_BLOCKED.some((h) => h.test(new URL(u).hostname))), 'connections the CSP had to block').toEqual([]);
    expect(state.pageErrors, 'uncaught errors in the page').toEqual([]);
    const unexplained = [...new Set(state.console)].filter((m) => !EXPLAINED_CONSOLE.some((x) => x.re.test(m)) && !state.expected.some((re) => re.test(m)));
    if (unexplained.length) fs.writeFileSync(info.outputPath('console-errors.txt'), unexplained.join('\n'));
    expect(unexplained, 'console errors nobody has explained (QA matrix Q-2)').toEqual([]);
    if (!page.isClosed()) expect(await page.evaluate(() => (window as unknown as { __toastErrors?: string[] }).__toastErrors ?? []), 'error toasts').toEqual([]);
  });
}

export const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const sheet = (page: Page) => page.locator('.sheet');
export const toastErrors = (page: Page) => page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
/** Every toast shown so far on this page (info and errors). */
export const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts.slice());

export async function newProject(page: Page, aspect = '9:16') {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: aspect }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}

export async function importFiles(page: Page, toolName: string, files: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: toolName, exact: true }).click();
  await (await chooser).setFiles(files.map((f) => (path.isAbsolute(f) ? f : fx(f))));
}

/** Selects a timeline clip (a tap on an already selected clip would deselect it). */
export async function selectClip(page: Page, clip: ReturnType<Page['locator']>) {
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

type Format = 'Video' | 'Photo' | 'GIF' | 'Audio';
const BUTTON: Record<Format, string> = { Video: 'Export video', Photo: 'Save photo', GIF: 'Export GIF', Audio: 'Export audio' };

/** Runs an export from the export sheet and returns the saved file (in the test's own output folder, numbered). */
export async function exportAs(page: Page, info: TestInfo, format: Format, opts: { loudness?: boolean; small?: boolean } = {}) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: format, exact: true }).click();
  if (format === 'Video' && opts.small !== false) await page.getByRole('radio', { name: 'Small file' }).click();
  if (opts.loudness === false) await page.getByRole('switch', { name: /Even loudness/ }).uncheck();
  if (opts.loudness === true) await page.getByRole('switch', { name: /Even loudness/ }).check();
  await page.getByRole('button', { name: BUTTON[format] }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const d = await dl;
  const file = info.outputPath(`${++exported}-${d.suggestedFilename()}`);
  await d.saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}
let exported = 0;

export interface Probe {
  duration: number;
  video?: { codec: string; width: number; height: number; fps: number; frames: number };
  audio?: { codec: string; sampleRate: number; channels: number };
}
/** ffprobe of an exported file (CLAUDE.md §4): duration, codecs, fps, frame count, sound. */
export function probe(file: string): Probe {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries',
    'stream=codec_name,codec_type,width,height,avg_frame_rate,nb_read_frames,sample_rate,channels:format=duration', '-of', 'json', file]).toString()) as {
    streams: { codec_name: string; codec_type: string; width?: number; height?: number; avg_frame_rate?: string; nb_read_frames?: string; sample_rate?: string; channels?: number }[];
    format: { duration?: string };
  };
  const v = j.streams.find((s) => s.codec_type === 'video');
  const a = j.streams.find((s) => s.codec_type === 'audio');
  const rate = (r?: string) => { const [n, d] = (r ?? '0/1').split('/').map(Number); return d ? n / d : 0; };
  return {
    duration: Number(j.format.duration),
    video: v && { codec: v.codec_name, width: v.width!, height: v.height!, fps: rate(v.avg_frame_rate), frames: Number(v.nb_read_frames) },
    audio: a && { codec: a.codec_name, sampleRate: Number(a.sample_rate), channels: a.channels! },
  };
}
/** Errors ffmpeg meets decoding the whole file: none in a whole file. */
export const decodeErrors = (file: string) => spawnSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { encoding: 'utf8' }).stderr.trim();

/** Integrated loudness and sample peak measured by ffmpeg's EBU R128 filter (silence reads -Infinity). */
export function loudnessOf(file: string) {
  const out = spawnSync('ffmpeg', ['-nostats', '-i', file, '-filter_complex', 'ebur128=peak=sample:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const summary = out.slice(out.lastIndexOf('Summary:'));
  const num = (re: RegExp) => { const m = re.exec(summary)?.[1]; return m === undefined || m.includes('inf') ? -Infinity : Number(m); };
  return { lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/), peak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

/** Mono 48 kHz samples of a file's sound. */
export function samples(file: string): Float32Array {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 512 << 20 });
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}

/** RMS in dBFS of `x` from `t0` to `t1` seconds (48 kHz). */
export function rmsDb(x: Float32Array, t0: number, t1: number): number {
  const a = Math.max(0, Math.round(t0 * 48000)), b = Math.min(x.length, Math.round(t1 * 48000));
  let s = 0;
  for (let i = a; i < b; i++) s += x[i] * x[i];
  return b > a ? 10 * Math.log10(s / (b - a) + 1e-20) : -Infinity;
}

/** The open project as the app stored it in IndexedDB. */
export const storedProject = <T = Record<string, unknown>>(page: Page) => page.evaluate(async () => {
  const id = /#\/p\/([\w-]+)/.exec(location.hash)![1];
  const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const p = await new Promise<unknown>((res) => { const r = db.transaction('kv').objectStore('kv').get(`p:${id}`); r.onsuccess = () => res(r.result); });
  db.close();
  return p;
}) as Promise<T>;

/** Exported frame at `t` seconds as gray pixels scaled to w×h. */
export function grayAt(file: string, t: number, w = 108, h = 192): Buffer {
  return execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
}

/** Writes a note next to the test's results (numbers a reader of the run wants to see). */
export const note = (info: TestInfo, name: string, text: string) => fs.writeFileSync(info.outputPath(name), text);

/** Writes the open project back to IndexedDB with `edit` applied and opens it again (a crafted project, many cases). */
export async function putProject<T>(page: Page, edit: (p: T) => void) {
  const p = await storedProject<T>(page);
  edit(p);
  await page.evaluate(async (next) => {
    const id = /#\/p\/([\w-]+)/.exec(location.hash)![1];
    localStorage.removeItem('kadr.journal'); // the saved version is the one to open
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    await new Promise<void>((res, rej) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(next, `p:${id}`); tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); });
    db.close();
  }, p);
  await page.reload();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
}

/** The preview canvas as a PNG once the playhead rests at `t` and the picture holds still (60 px a second). */
export async function previewAt(page: Page, info: TestInfo, t: number): Promise<string> {
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, t * 60);
  await page.waitForTimeout(600);
  const canvas = page.locator('.preview-canvas');
  // The editing chrome over the picture (a toast, the selection box, the snap guides) is not in the file.
  const shoot = () => canvas.screenshot({ style: '.toast, .sel-box, .guide { visibility: hidden !important; }' });
  let still = await shoot();
  for (let k = 1; k <= 20; k++) {
    await page.waitForTimeout(400);
    const next = await shoot();
    if (next.equals(still)) break;
    still = next;
  }
  const whole = info.outputPath(`preview-${t.toFixed(3)}-element.png`);
  fs.writeFileSync(whole, still);
  const b = await canvas.evaluate((c) => { const r = c.getBoundingClientRect(); return [r.x - Math.floor(r.x), r.y - Math.floor(r.y), r.width, r.height].map((v) => v * devicePixelRatio); });
  const [x, y, w, h] = b.map(Math.round);
  const shot = info.outputPath(`preview-${t.toFixed(3)}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', whole, '-vf', `crop=w='min(${w},iw-${x})':h='min(${h},ih-${y})':x=${x}:y=${y}`, shot]);
  return shot;
}

/** A picture (or frame `n` of a video) as 135×240 RGB. */
export function rgbOf(file: string, n?: number): Buffer {
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=135:240`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}
export const meanAbsDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
/** The largest mean |R, G or B difference| of any 15×15 block of two 135×240 pictures: a missing or moved element. */
export function worstBlock(a: Buffer, b: Buffer): number {
  let worst = 0;
  for (let by = 0; by < 240; by += 15) for (let bx = 0; bx < 135; bx += 15) {
    const sum = [0, 0, 0];
    for (let y = by; y < by + 15; y++) for (let x = bx; x < bx + 15; x++) for (let c = 0; c < 3; c++) { const i = (y * 135 + x) * 3 + c; sum[c] += Math.abs(a[i] - b[i]); }
    worst = Math.max(worst, ...sum.map((v) => v / (15 * 15)));
  }
  return worst;
}

/** The value `name` of a sheet on the Scale, its tab chosen if the part has more than one. */
async function valueOf(page: Page, name: string) {
  const tab = sheet(page).getByRole('tab', { name: new RegExp(`^${name}( ?,|$)`) });
  if (await tab.count()) await tab.click();
  return sheet(page).getByRole('slider', { name, exact: true });
}
/** Sets a value on the Scale with the keys, from its start, one step at a time (the step read from the first one). */
export async function setValue(page: Page, name: string, to: number) {
  const s = await valueOf(page, name);
  const now = async () => Number(await s.getAttribute('aria-valuenow'));
  await s.press('Home');
  const min = await now();
  await s.press('ArrowRight');
  const step = (await now()) - min;
  for (let i = 1; i < Math.round((to - min) / step); i++) await s.press('ArrowRight');
  await expect.poll(now).toBeCloseTo(to, 5);
}

/** Left and right channels of a file's sound, 48 kHz. */
export function stereo(file: string): [Float32Array, Float32Array] {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ar', '48000', '-ac', '2', '-f', 'f32le', '-'], { maxBuffer: 512 << 20 });
  const x = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const l = new Float32Array(x.length / 2), r = new Float32Array(x.length / 2);
  for (let i = 0; i < l.length; i++) { l[i] = x[2 * i]; r[i] = x[2 * i + 1]; }
  return [l, r];
}

/** Frequency of a steady tone from its zero crossings between `t0` and `t1` s (48 kHz). */
export function toneHz(x: Float32Array, t0: number, t1: number): number {
  const a = Math.round(t0 * 48000), b = Math.min(x.length, Math.round(t1 * 48000));
  let n = 0;
  for (let i = a + 1; i < b; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) n++;
  return n / 2 / ((b - a) / 48000);
}
/**
 * The largest mean signed R, G or B difference of any 15×15 block of two 135×240 pictures: a colour that is in one
 * and not the other (missing copies, a missing glow). Edge noise of matching text is of both signs and cancels out.
 */
export function worstCast(a: Buffer, b: Buffer): number {
  let worst = 0;
  for (let by = 0; by < 240; by += 15) for (let bx = 0; bx < 135; bx += 15) {
    const sum = [0, 0, 0];
    for (let y = by; y < by + 15; y++) for (let x = bx; x < bx + 15; x++) for (let c = 0; c < 3; c++) { const i = (y * 135 + x) * 3 + c; sum[c] += a[i] - b[i]; }
    worst = Math.max(worst, ...sum.map((v) => Math.abs(v) / (15 * 15)));
  }
  return worst;
}
