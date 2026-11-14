// Shared steps of the sweep's lane C tests (docs/21, `qa-video-*.spec.ts`): video and canvas functions, checked by the
// 15 points of docs/11 §3. The same steps as in editor.spec.ts, so a number here means what it means there.
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
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

/** Selects a timeline clip (a tap on an already selected clip would deselect it); retried, as the clip may re-render
 *  (at load 40 on the shared Mac one try took over 3 s). */
export async function selectClip(page: Page, clip: Locator) {
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 3000 });
  }).toPass({ timeout: 30_000 });
}

/** The playhead at `px` timeline pixels (60 a second), waiting for the clock to read `shown`. */
export async function scrubTo(page: Page, px: number, shown?: string) {
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, px);
  if (shown) await expect.poll(() => time(page)).toBe(shown);
}

/** The value `name` of a sheet on the Scale, its tab chosen if the part has more than one. */
export async function valueOf(page: Page, name: string) {
  const tab = sheet(page).getByRole('tab', { name: new RegExp(`^${name}( ?,|$)`) });
  if (await tab.count()) await tab.click();
  return sheet(page).getByRole('slider', { name, exact: true });
}
/** Drives a Scale value to an end with the keys (`Home` or `End`) and returns where it stopped. */
export async function valueToEnd(page: Page, name: string, key: 'Home' | 'End') {
  const s = await valueOf(page, name);
  await s.press(key);
  return Number(await s.getAttribute('aria-valuenow'));
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

/** Opens a tool sheet, nudges its first value, picks its second option and closes it. */
export async function useSheet(page: Page, name: string) {
  await tool(page, name).click();
  await expect(sheet(page)).toBeVisible();
  const slider = sheet(page).locator('.ck-scale-strip, input[type=range]:not([aria-label="Position in the clip"])').first();
  if (await slider.count()) { await slider.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); }
  const radios = sheet(page).getByRole('radio');
  if ((await radios.count()) > 1) await radios.nth(1).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toHaveCount(0);
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

/** RGB 135×240 of a picture, or of a video's frame number `n`. */
export function rgbAt(file: string, n?: number): Buffer {
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=135:240`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}
export const meanAbsDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
/** Share of pixels that differ by more than `thr` levels. */
export const changed = (a: Buffer, b: Buffer, thr: number) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thr) n++; return n / a.length; };
/** The largest mean signed R, G or B difference of two RGB pictures, 0–255. */
export function colourCast(a: Buffer, b: Buffer): number {
  const sum = [0, 0, 0];
  for (let i = 0; i < a.length; i++) sum[i % 3] += a[i] - b[i];
  return Math.max(...sum.map((v) => Math.abs(v) / (a.length / 3)));
}
/** The largest mean signed channel difference of any 15×15 block of two 135×240 RGB pictures. */
export function worstBlockCast(a: Buffer, b: Buffer): number {
  let worst = 0;
  for (let by = 0; by < 240; by += 15) for (let bx = 0; bx < 135; bx += 15) {
    const sum = [0, 0, 0];
    for (let y = by; y < by + 15; y++) for (let x = bx; x < bx + 15; x++) for (let c = 0; c < 3; c++) { const i = (y * 135 + x) * 3 + c; sum[c] += a[i] - b[i]; }
    worst = Math.max(worst, ...sum.map((v) => Math.abs(v) / (15 * 15)));
  }
  return worst;
}

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

/**
 * WYSIWYG (docs/11 §3.2): exports the video once, then at each point compares the preview with the photo export and the
 * video's frame, in colour — the limits of editor.spec.ts «WYSIWYG for every look tool» (matching frames: mean ≤ 2,
 * worst block ≤ 5; an export without the cutout gave 91).
 */
/** `maxCast` per point overrides the call's: a bright full frame matches with a larger cast (editor.spec «in motion»: ≤ 0.83). */
export async function expectSameFrames(page: Page, info: TestInfo, title: string, points: { name: string; t: number; maxCast?: number }[], maxCast: number, fps = 30) {
  const video = await exportVideo(page, info);
  const rows: string[] = [];
  for (const { name, t: at, maxCast: own } of points) {
    const t = Math.round(at * fps) / fps;
    const limit = own ?? maxCast;
    const preview = rgbAt(await previewAt(page, info, t));
    const photo = rgbAt(await exportPhoto(page, info));
    const frame = rgbAt(video, Math.round(t * fps));
    const [dp, df, cp, cf] = [meanAbsDiff(preview, photo), meanAbsDiff(preview, frame), colourCast(preview, photo), colourCast(preview, frame)];
    const [bp, bf] = [worstBlockCast(preview, photo), worstBlockCast(preview, frame)];
    rows.push(`${name} @ ${t.toFixed(2)} s (playhead ${await time(page)}): photo ${dp.toFixed(2)} / cast ${cp.toFixed(2)} / block ${bp.toFixed(1)}, video ${df.toFixed(2)} / cast ${cf.toFixed(2)} / block ${bf.toFixed(1)}`);
    expect.soft(dp, `photo, ${name}`).toBeLessThan(4);
    expect.soft(df, `video frame, ${name}`).toBeLessThan(6);
    expect.soft(cp, `photo colour cast, ${name}`).toBeLessThan(limit);
    expect.soft(cf, `video frame colour cast, ${name}`).toBeLessThan(limit);
    expect.soft(bp, `photo, worst block, ${name}`).toBeLessThan(20);
    expect.soft(bf, `video frame, worst block, ${name}`).toBeLessThan(20);
  }
  console.log(`${title} (${info.project.name}):\n${rows.join('\n')}`);
  return video;
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

/** Mono 8 kHz samples of a file's sound. */
export function pcmOf(file: string, rate = 8000): Float32Array {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', String(rate), '-f', 'f32le', '-']);
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
export const rmsOf = (x: Float32Array, from = 0, to = x.length) => { let s = 0; for (let i = from; i < to; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, to - from)); };

// ---------- docs/11 §3.3–3.4: history and persistence ----------

/** The project as saved in IndexedDB ('kadr'/'kv', key p:<id>), without its save time and bookkeeping. */
export async function savedProject(page: Page): Promise<string> {
  const id = /#\/p\/([^/?]+)/.exec(page.url())![1];
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const p = await new Promise<Record<string, unknown> | undefined>((ok, ko) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => ok(r.result as Record<string, unknown> | undefined); r.onerror = () => ko(r.error);
    });
    db.close();
    if (!p) return '';
    delete p.updatedAt; delete p.rev; delete p.writer;
    return JSON.stringify(p);
  }, `p:${id}`);
}
/** The saved project once the autosave after the last edit has landed. */
export async function settledProject(page: Page, prev?: string): Promise<string> {
  if (prev !== undefined) await expect.poll(() => savedProject(page), { timeout: 10_000 }).not.toBe(prev);
  let cur = await savedProject(page);
  for (;;) { await page.waitForTimeout(900); const next = await savedProject(page); if (next === cur) return cur; cur = next; }
}
export const firstDiff = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `at ${i}: …${a.slice(Math.max(0, i - 80), i + 80)}… vs …${b.slice(Math.max(0, i - 80), i + 80)}…`; };

/** What a viewer sees and hears: gray 45×80 frames at 20/40/60/80% and the sound's 100 ms RMS envelope. */
export function fingerprint(file: string) {
  const duration = durationOf(file);
  const frames = [0.2, 0.4, 0.6, 0.8].map((f) => execFileSync('ffmpeg', ['-v', 'error', '-ss', (f * duration).toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=45:80', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']));
  const pcm = pcmOf(file);
  const env = Array.from({ length: Math.floor(pcm.length / 800) }, (_, i) => rmsOf(pcm, i * 800, (i + 1) * 800));
  return { duration, frames, env };
}

/**
 * docs/11 §3.3–3.4 for a chain of actions, as editor.spec.ts «history and persistence…»: the saved project after each
 * one; every undo gives exactly the project before its action and every redo the one after; a reload keeps the
 * project byte for byte and exports the same picture and sound.
 */
export function historyProof(page: Page, info: TestInfo, opts: { sound?: boolean } = {}) {
  const states: string[] = [], names: string[] = [];
  return {
    async start() { states.push(await settledProject(page)); names.push('start'); },
    /** One user action; it must change the project. */
    async act(name: string, run: () => Promise<void>) {
      await run();
      names.push(name);
      states.push(await settledProject(page, states[states.length - 1]).catch((e: Error) => { throw new Error(`"${name}" changed nothing in the saved project: ${e.message.split('\n')[0]}`); }));
      await closeTools(page);
    },
    async undoRedo() {
      const undo = page.getByRole('button', { name: 'Undo' }), redo = page.getByRole('button', { name: 'Redo' });
      let cur = states[states.length - 1];
      for (let k = states.length - 2; k >= 0; k--) {
        await undo.click();
        cur = await settledProject(page, cur).catch((e: Error) => { throw new Error(`undo of "${names[k + 1]}" changed nothing: ${e.message.split('\n')[0]}`); });
        expect(cur === states[k], `undo of "${names[k + 1]}" gives the project before it; ${firstDiff(cur, states[k])}`).toBe(true);
      }
      for (let k = 1; k < states.length; k++) {
        expect(await redo.isEnabled(), `redo is still possible before "${names[k]}"`).toBe(true);
        await redo.click();
        cur = await settledProject(page, cur).catch((e: Error) => { throw new Error(`redo of "${names[k]}" changed nothing: ${e.message.split('\n')[0]}`); });
        expect(cur === states[k], `redo of "${names[k]}" gives the project after it; ${firstDiff(cur, states[k])}`).toBe(true);
      }
      await expect(redo).toBeDisabled();
      console.log(`history (${info.project.name}): ${names.slice(1).join(', ')} — each one undo step, exact both ways`);
    },
    async reload() {
      const clips = page.locator('.tl-row .clip'), n = await clips.count();
      const before = fingerprint(await exportVideo(page, info));
      const saved = await settledProject(page);
      await page.reload();
      await expect(clips).toHaveCount(n);
      expect(await settledProject(page) === saved, `the reload keeps the project; ${firstDiff(await savedProject(page), saved)}`).toBe(true);
      const after = fingerprint(await exportVideo(page, info));
      expect(Math.abs(after.duration - before.duration)).toBeLessThan(0.05);
      const frameDiff = before.frames.map((f, k) => meanAbsDiff(f, after.frames[k]));
      const moved = before.frames.map((f, k) => changed(f, after.frames[k], 24));
      const envDiff = Math.max(0, ...before.env.map((v, i) => Math.abs(v - (after.env[i] ?? 0))));
      console.log(`reload (${info.project.name}): frame diff ${frameDiff.map((d) => d.toFixed(2)).join(', ')} of 255, pixels changed ${moved.map((c) => `${(c * 100).toFixed(1)}%`).join(', ')}; sound envelope diff ${envDiff.toFixed(4)}`);
      for (const d of frameDiff) expect(d, 'frames after the reload, mean difference').toBeLessThan(1);
      for (const c of moved) expect(c, 'frames after the reload, share of changed pixels').toBeLessThan(0.005);
      if (opts.sound !== false) {
        expect(Math.max(...before.env), 'there is sound to compare').toBeGreaterThan(0.01);
        expect(envDiff).toBeLessThan(0.01);
      }
    },
  };
}

/** Every toast shown so far in the test (any kind), for edges that must say something. */
export const toastsSeen = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
/** Waits until a toast with this text has been shown. */
export const expectToast = (page: Page, text: string | RegExp, timeout = 20_000) =>
  expect.poll(async () => (await toastsSeen(page)).some((x) => (typeof text === 'string' ? x.includes(text) : text.test(x))), { message: `a toast "${text}"`, timeout }).toBe(true);
