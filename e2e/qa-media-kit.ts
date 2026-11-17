// Shared steps of the lane A checks (docs/21 §3: backup, import, iPhone codecs, scrubbing, camera — QA matrix Q-4,
// Q-5, Q-6, Q-9, Q-27). The privacy audit of editor.spec.ts runs here too (docs/11 §3.12): every scenario of these
// files is also a check that nothing leaves the device.
import { test as base, expect, type BrowserContext, type Locator, type Page, type PlaywrightWorkerArgs, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

/** What every page of these tests starts with: English, tips seen, downloads instead of a share sheet, toasts recorded. */
const setup = () => {
  localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
  localStorage.setItem('kadr.undoMoved.v1', '1');
  localStorage.setItem('kadr.locale', 'en');
  localStorage.setItem('kadr.hint.move', '1');
  localStorage.setItem('kadr.iosVideoTip.v3', '1');
  if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  const w = window as unknown as { __toasts: string[]; __toastErrors: string[] };
  w.__toasts = []; w.__toastErrors = [];
  new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
    const text = el.textContent ?? '';
    const list = el.classList.contains('error') ? w.__toastErrors : w.__toasts;
    if (!list.includes(text)) list.push(text);
  })).observe(document, { subtree: true, childList: true });
};

const ALLOWED_HOSTS = [/^localhost$/, /^127\.0\.0\.1$/, /^\[::1\]$/, /^timofeys22\.github\.io$/, /^huggingface\.co$/, /\.huggingface\.co$/, /\.hf\.co$/];

/** Starts the page's setup and the network audit; the returned check fails on any request that sends data out. */
export async function watch(page: Page): Promise<() => void> {
  const network: { method: string; url: string; body: number }[] = [];
  page.context().on('request', (r) => {
    if (/^(blob|data):/.test(r.url())) return;
    network.push({ method: r.method(), url: r.url(), body: r.postDataBuffer()?.length ?? 0 });
  });
  await page.addInitScript(setup);
  return () => {
    const outside = network.filter((r) => !ALLOWED_HOSTS.some((h) => h.test(new URL(r.url).hostname)));
    expect(outside.map((r) => `${r.method} ${r.url}`), 'requests to hosts outside the CSP allow-list').toEqual([]);
    const sent = network.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !new URL(r.url).pathname.endsWith('/share-target'));
    expect(sent.map((r) => `${r.method} ${r.url} (${r.body} bytes)`), 'requests that send data').toEqual([]);
  };
}

/**
 * A persistent context: IndexedDB keeps Blobs as Safari does (the default WebKit context refuses them and takes the
 * chunk path, docs/19). Closed and removed after; the privacy audit runs at the end.
 */
export async function withKadr(playwright: PlaywrightWorkerArgs['playwright'], info: TestInfo, body: (page: Page, ctx: BrowserContext) => Promise<void>, init?: () => void) {
  const { defaultBrowserType, ...use } = info.project.use as Record<string, unknown>;
  void defaultBrowserType;
  const type = info.project.name.includes('webkit') ? playwright.webkit : playwright.chromium;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-qa-media-'));
  let ctx: BrowserContext | undefined;
  try {
    ctx = await type.launchPersistentContext(dir, { ...use, serviceWorkers: 'block', acceptDownloads: true });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    const privateCheck = await watch(page);
    if (init) await page.addInitScript(init);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await body(page, ctx);
    privateCheck();
    expect(errors, 'uncaught errors in the page').toEqual([]);
  } finally {
    await ctx?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * The `page` and `context` of these tests live in a persistent context, as in qa-media-lease: IndexedDB keeps Blobs as
 * Safari does (the default WebKit context refuses them and takes the chunk path, docs/19). Service workers run as in
 * the browser. Each test gets its own empty profile, removed after.
 */
export const test = base.extend({
  context: async ({ playwright }, use, info) => {
    const { defaultBrowserType, trace, ...options } = info.project.use as Record<string, unknown>;
    void defaultBrowserType; void trace;
    const type = info.project.name.includes('webkit') ? playwright.webkit : playwright.chromium;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-qa-media-'));
    const ctx = await type.launchPersistentContext(dir, { ...options, acceptDownloads: true });
    try {
      await use(ctx);
    } finally {
      await ctx.close();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  },
  page: async ({ context }, use) => { await use(context.pages()[0] ?? await context.newPage()); },
});

export const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const time = (page: Page) => page.locator('.time b').textContent();
export const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
export const errorToasts = (page: Page) => page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors);

export async function newProject(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}

export async function importFiles(page: Page, button: string, files: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await tool(page, button).click();
  await (await chooser).setFiles(files.map(fx));
}

export async function closeTools(page: Page) {
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
}

/** Runs an export from the export sheet and returns the saved file. */
export async function exportAs(page: Page, info: TestInfo, format: 'Video' | 'Photo', button: string) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: format, exact: true }).click();
  if (format === 'Video') await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: button }).click();
  // A failed export is said at once, with the words under its Details: the cause, not a timeout four minutes later.
  const ready = page.getByText(/Ready: .* MB/), failed = page.locator('details.error-more');
  await expect(ready.or(failed).first()).toBeVisible({ timeout: 240_000 });
  if (await failed.isVisible()) {
    await failed.locator('summary').click();
    const said = (await failed.locator('xpath=..').innerText()).replace(/\s+/g, ' ');
    throw new Error(`the ${format.toLowerCase()} export failed: ${said.slice(0, 800)}`);
  }
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}

export function probe(file: string) {
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,codec_type,width,height,nb_read_frames:format=duration', '-of', 'json', file]).toString()) as {
    streams: { codec_name: string; codec_type: string; width?: number; height?: number; nb_read_frames?: string }[]; format: { duration?: string };
  };
}

/** The source frame a picture (or a video's frame `n`) shows, read from counter.mp4's 8-stripe binary code. */
export function counterAt(file: string, n?: number): number {
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=64:-2,format=gray`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-']);
  const W = 64, H = b.length / W;
  let v = 0;
  for (let k = 0; k < 8; k++) {
    let m = 0, c = 0;
    for (let y = Math.floor(H * 0.45); y <= Math.floor(H * 0.55); y++) for (let x = k * 8 + 2; x < k * 8 + 6; x++) { m += b[y * W + x]; c++; }
    if (m / c > 128) v |= 1 << k;
  }
  return v;
}

/** The preview canvas as a PNG once it holds still (a scrub shows a nearby keyframe first, then the exact frame). */
export async function previewShot(page: Page, info: TestInfo, name: string): Promise<string> {
  const canvas = page.locator('.preview-canvas');
  const shoot = () => canvas.screenshot({ style: '.toast { visibility: hidden !important; }' });
  let still = await shoot();
  for (let k = 1; k <= 20; k++) {
    await page.waitForTimeout(500);
    const next = await shoot();
    if (next.equals(still)) break;
    still = next;
  }
  const whole = info.outputPath(`${name}-element.png`);
  fs.writeFileSync(whole, still);
  // Only the canvas itself: the element screenshot spans whole CSS pixels around its fractional edges.
  const b = await canvas.evaluate((c) => { const r = c.getBoundingClientRect(); return [r.x - Math.floor(r.x), r.y - Math.floor(r.y), r.width, r.height].map((v) => v * devicePixelRatio); });
  const [x, y, w, h] = b.map(Math.round);
  const shot = info.outputPath(`${name}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', whole, '-vf', `crop=w='min(${w},iw-${x})':h='min(${h},ih-${y})':x=${x}:y=${y}`, shot]);
  return shot;
}

/** The project as saved now (IndexedDB), parsed. */
export type Saved = { tracks: { kind: string; clips: { kind: string; assetId?: string; start: number; duration: number; speed?: number }[] }[]; assets: Record<string, { name: string; duration?: number }> };
export async function savedProject(page: Page): Promise<Saved> {
  const id = /#\/p\/([^/?]+)/.exec(page.url())![1];
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const p = await new Promise<unknown>((ok, ko) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error);
    });
    db.close();
    return p as Saved;
  }, `p:${id}`);
}
/** The names of the main track's media, in order, as saved. */
export const mainNames = async (page: Page) => {
  const p = await savedProject(page);
  return p.tracks.find((t) => t.kind === 'main')!.clips.map((c) => (c.assetId ? p.assets[c.assetId]?.name : c.kind) ?? '?');
};

/** Selects a timeline clip (a tap on an already selected clip would deselect it). */
export async function selectClip(clip: Locator) {
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/** Moves the playhead by scrolling the timeline (60 px a second) and waits for the time it shows. */
export async function scrubTo(page: Page, seconds: number, shown: string) {
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, Math.round(seconds * 60));
  await expect.poll(() => time(page)).toBe(shown);
}

/** A picture (or a video's frame `n`) as 135×240 RGB. */
export function rgbAt(file: string, n?: number): Buffer {
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=135:240`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}
export const meanAbsDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

/** Kadr's store: every key with the size of the file under it (b: whole files, c: chunk records and chunks). */
export const stored = (page: Page) => page.evaluate(() => new Promise<{ key: string; size: number }[]>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const out: { key: string; size: number }[] = [];
    const cursor = open.result.transaction('kv').objectStore('kv').openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) { open.result.close(); resolve(out); return; }
      const k = String(c.key), v: unknown = c.value;
      if (/^[bc]:/.test(k)) out.push({ key: k, size: v instanceof Blob ? v.size : v instanceof ArrayBuffer ? v.byteLength : -1 });
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  };
}));
