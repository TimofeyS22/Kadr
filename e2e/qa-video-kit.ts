// Shared steps of the sweep's lane C tests (docs/21, `qa-video-*.spec.ts`): video and canvas functions, checked by the
// 15 points of docs/11 §3. The same steps as in editor.spec.ts, so a number here means what it means there.
import { expect, test, type Locator, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
type Out = { outputPath: (n: string) => string };

/**
 * Every test of the file runs under the privacy audit of docs/11 §3.12 (only the CSP hosts, nothing sent), with no
 * uncaught page error and no error toast. Call once at the top of a spec.
 */
export function audited(): void {
  const ALLOWED = [/^localhost$/, /^127\.0\.0\.1$/, /^timofeys22\.github\.io$/, /^huggingface\.co$/, /\.huggingface\.co$/, /\.hf\.co$/];
  const KNOWN_BLOCKED = [/^odml\.pa\.googleapis\.com$/]; // MediaPipe's own telemetry; the CSP stops it
  const network: { method: string; url: string; body: number }[] = [];
  const pageErrors: string[] = [];
  const blocked: string[] = [];
  test.beforeEach(async ({ page }) => {
    network.length = 0; pageErrors.length = 0; blocked.length = 0;
    page.context().on('request', (r) => {
      if (/^(blob|data):/.test(r.url())) return;
      network.push({ method: r.method(), url: r.url(), body: r.postDataBuffer()?.length ?? 0 });
    });
    page.on('console', (m) => {
      const csp = /(?:Refused to connect to|Connecting to|cannot load) '?(https?:\/\/[^'\s]+)'?[^]*Content Security Policy/.exec(m.text());
      if (csp) blocked.push(csp[1]);
    });
    page.on('pageerror', (e) => pageErrors.push(e.message));
    await page.addInitScript(() => {
      localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
      localStorage.setItem('kadr.undoMoved.v1', '1');
      localStorage.setItem('kadr.locale', localStorage.getItem('kadr.locale') ?? 'en');
      localStorage.setItem('kadr.hint.move', '1');
      localStorage.setItem('kadr.iosVideoTip.v3', '1');
      if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
      Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
      // Every toast shown during the test is recorded: they leave after 3 s, a busy Mac may look later than that.
      const w = window as unknown as { __toastErrors: string[]; __toasts: string[] };
      const seen: string[] = (w.__toastErrors = []), all: string[] = (w.__toasts = []);
      new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
        const text = el.textContent ?? '';
        if (el.classList.contains('error') && !seen.includes(text)) seen.push(text);
        if (!all.includes(text)) all.push(text);
      })).observe(document, { subtree: true, childList: true });
    });
  });
  test.afterEach(async ({ page }) => {
    const outside = network.filter((r) => !ALLOWED.some((h) => h.test(new URL(r.url).hostname)));
    expect(outside.map((r) => `${r.method} ${r.url}`), 'requests to hosts outside the CSP allow-list').toEqual([]);
    const sent = network.filter((r) => r.method !== 'GET' && r.method !== 'HEAD' && !new URL(r.url).pathname.endsWith('/share-target'));
    expect(sent.map((r) => `${r.method} ${r.url} (${r.body} bytes)`), 'requests that send data').toEqual([]);
    expect(blocked.filter((u) => !KNOWN_BLOCKED.some((h) => h.test(new URL(u).hostname))), 'connections the CSP had to block').toEqual([]);
    expect(pageErrors, 'uncaught errors in the page').toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { __toastErrors?: string[] }).__toastErrors).catch(() => []) ?? [], 'error toasts').toEqual([]);
  });
}

export const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
export const sheet = (page: Page) => page.locator('.sheet');
export const mainClips = (page: Page) => page.locator('.tl-row.main .clip');
export const time = (page: Page) => page.locator('.time b').textContent();

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

export async function closeTools(page: Page) {
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
}

/** Selects a timeline clip (a tap on an already selected clip would deselect it); retried, as the clip may re-render. */
export async function selectClip(page: Page, clip: Locator) {
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

/** The playhead at `px` timeline pixels (60 a second), waiting for the clock to read `shown`. */
export async function scrubTo(page: Page, px: number, shown?: string) {
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, px);
  if (shown) await expect.poll(() => time(page)).toBe(shown);
}

/**
 * «Done» on a sheet. While the sheet processes sound on the device (natural pitch after a speed change, 0.8 s after it),
 * the first tap only warns that it is still running (`useSheetGuard`); then the job is waited out and Done tapped again.
 */
export async function doneSheet(page: Page) {
  await page.waitForTimeout(1200); // a speed change starts its pitch job 0.8 s later
  for (let i = 0; i < 3; i++) {
    await expect(page.locator('.inline-progress')).toHaveCount(0, { timeout: 180_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    if (await sheet(page).count() === 0) return;
    await page.waitForTimeout(500);
    if (await sheet(page).count() === 0) return;
  }
  await expect(sheet(page)).toHaveCount(0);
}

/** A speed preset from the Speed sheet (its sound processed before the sheet closes). */
export async function setSpeedPreset(page: Page, name: string) {
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name, exact: true }).click();
  await doneSheet(page);
}

/** Runs an export of the given format from the export sheet and returns the saved file. */
export async function exportAs(page: Page, info: Out, format: 'Video' | 'Photo' | 'GIF' | 'Audio', button: string) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: format, exact: true }).click();
  if (format === 'Video') await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}
export const exportVideo = (page: Page, info: Out) => exportAs(page, info, 'Video', 'Export video');
export const exportPhoto = (page: Page, info: Out) => exportAs(page, info, 'Photo', 'Save photo');

export type Probe = { streams: { codec_name: string; codec_type: string; width?: number; height?: number; nb_read_frames?: string; r_frame_rate?: string }[]; format: { duration?: string } };
/** ffprobe of a file (frames counted) — and ffmpeg decodes it whole without one error (CLAUDE.md §4). */
export function probe(file: string): Probe {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,codec_type,width,height,nb_read_frames,r_frame_rate:format=duration', '-of', 'json', file]).toString()) as Probe;
  const errors = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  expect(errors, `ffmpeg decodes ${path.basename(file)} without errors`).toBe('');
  return j;
}
export const durationOf = (file: string) => Number(probe(file).format.duration);

/** The preview canvas as a picture once it holds still with the playhead at `t` (60 px per second on the timeline). */
export async function previewAt(page: Page, info: Out, t: number): Promise<string> {
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, t * 60);
  await page.waitForTimeout(1000);
  const canvas = page.locator('.preview-canvas');
  const whole = info.outputPath(`preview-${t.toFixed(3)}-element.png`);
  const shoot = () => canvas.screenshot({ style: '.toast { visibility: hidden !important; }' });
  let still = await shoot();
  for (let k = 1; k <= 20; k++) {
    await page.waitForTimeout(500);
    const next = await shoot();
    if (next.equals(still)) break;
    still = next;
  }
  fs.writeFileSync(whole, still);
  // Only the canvas itself: the element screenshot spans whole CSS pixels around a canvas with fractional edges.
  const b = await canvas.evaluate((c) => { const r = c.getBoundingClientRect(); return [r.x - Math.floor(r.x), r.y - Math.floor(r.y), r.width, r.height].map((v) => v * devicePixelRatio); });
  const [x, y, w, h] = b.map(Math.round);
  const shot = info.outputPath(`preview-${t.toFixed(3)}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', whole, '-vf', `crop=w='min(${w},iw-${x})':h='min(${h},ih-${y})':x=${x}:y=${y}`, shot]);
  return shot;
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

/** Every toast shown so far in the test (any kind), for edges that must say something. */
export const toastsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
/** Waits until a toast with this text has been shown. */
export const expectToast = (page: Page, text: string | RegExp) =>
  expect.poll(async () => (await toastsSeen(page)).some((x) => (typeof text === 'string' ? x.includes(text) : text.test(x))), { message: `a toast "${text}"` }).toBe(true);
