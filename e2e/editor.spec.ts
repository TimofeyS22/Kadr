import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const pageErrors: string[] = [];
// Privacy audit on every scenario (docs/11 §3.12): the page talks only to its own origin and to the hosts the CSP
// allows for models, and never sends anything out. A request with a body to anywhere but the share target fails.
const ALLOWED_HOSTS = [/^localhost$/, /^127\.0\.0\.1$/, /^timofeys22\.github\.io$/, /^huggingface\.co$/, /\.huggingface\.co$/, /\.hf\.co$/, /^cdn\.jsdelivr\.net$/];
const network: { method: string; url: string; body: number }[] = [];
const consoleErrors: string[] = [];
// Connections the CSP blocked (they never reach the network log above). MediaPipe's own telemetry tries Google's
// ODML logging endpoint; the CSP stops it. Any other blocked destination is a new attempt to phone home: it fails.
const KNOWN_BLOCKED = [/^odml\.pa\.googleapis\.com$/];
const blocked: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  network.length = 0;
  consoleErrors.length = 0;
  blocked.length = 0;
  page.context().on('request', (r) => {
    if (/^(blob|data):/.test(r.url())) return;
    network.push({ method: r.method(), url: r.url(), body: r.postDataBuffer()?.length ?? 0 });
  });
  page.on('console', (m) => {
    // Errors, and the app's own decoder warnings (the only trace of why a file is reported as having no sound).
    if (m.type() === 'error' || (m.type() === 'warning' && /does not decode|refused to decode|Content Security Policy/.test(m.text()))) consoleErrors.push(m.text().slice(0, 300));
    const csp = /(?:Refused to connect to|Connecting to|cannot load) '?(https?:\/\/[^'\s]+)'?[^]*Content Security Policy/.exec(m.text());
    if (csp) blocked.push(csp[1]);
  });
  page.context().on('response', (r) => { if (r.status() >= 400) consoleErrors.push(`HTTP ${r.status()} ${r.url().slice(0, 200)}`); });
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    // Export tests pick their settings; quick export (on by default, v1.3) has its own test.
    if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    // Headless WebKit has no share sheet (share() never settles): take the download path like desktop browsers.
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
  // Error toasts disappear after a few seconds, so every one shown during the test is recorded.
  await page.addInitScript(() => {
    const seen: string[] = ((window as unknown as { __toastErrors: string[] }).__toastErrors = []);
    new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => {
      if (!seen.includes(el.textContent ?? '')) seen.push(el.textContent ?? '');
    })).observe(document, { subtree: true, childList: true });
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(async ({ page }, info) => {
  const outside = network.filter((r) => !ALLOWED_HOSTS.some((h) => h.test(new URL(r.url).hostname)));
  expect(outside.map((r) => `${r.method} ${r.url}`), 'requests to hosts outside the CSP allow-list').toEqual([]);
  const sent = network.filter((r) => (r.method !== 'GET' && r.method !== 'HEAD') && !(new URL(r.url).pathname.endsWith('/share-target')));
  expect(sent.map((r) => `${r.method} ${r.url} (${r.body} bytes)`), 'requests that send data').toEqual([]);
  expect(blocked.filter((u) => !KNOWN_BLOCKED.some((h) => h.test(new URL(u).hostname))), 'connections the CSP had to block').toEqual([]);
  // Console errors are collected for triage (docs/11), not failed on: some come from the browser itself.
  if (consoleErrors.length) fs.appendFileSync(path.join(import.meta.dirname, '..', 'test-results', 'console-errors.txt'), `## ${info.project.name} › ${info.title}\n${[...new Set(consoleErrors)].join('\n')}\n\n`);
  expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  expect(await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors) ?? [], 'error toasts').toEqual([]);
});

async function newProject(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}

async function importFiles(page: Page, tool: string, files: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: tool, exact: true }).click();
  await (await chooser).setFiles(files.map(fx));
}

const selBox = (page: Page) => page.locator('.sel-box');
/** Bounding box once the preview has stopped re-laying out (sheets animate the preview size). */
async function stableBox(page: Page) {
  let prev = await selBox(page).boundingBox();
  for (let i = 0; i < 20; i++) {
    await page.waitForTimeout(100);
    const cur = await selBox(page).boundingBox();
    if (prev && cur && Math.abs(prev.x - cur.x) + Math.abs(prev.y - cur.y) + Math.abs(prev.width - cur.width) < 0.5) return cur;
    prev = cur;
  }
  return prev!;
}

test('adds a photo and a video from the file picker', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png', 'landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('adds a JPEG photo and a portrait video as overlays', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Overlay', ['portrait.mp4']);
  await expect(page.locator('.tl-row.overlay .clip')).toHaveCount(1);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('text can be enlarged with the corner handle', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(selBox(page)).toBeVisible();
  const before = await stableBox(page);
  const h = (await page.locator('.sel-handle').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2 + 30, { steps: 8 });
  await page.mouse.up();
  const after = (await selBox(page).boundingBox())!;
  expect(after.width).toBeGreaterThan(before.width * 1.3);
});

test('an emoji sticker can be enlarged by pinching (touch)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'multi-touch injection needs the Chromium DevTools protocol');
  await newProject(page);
  await page.getByRole('button', { name: 'Stickers' }).click();
  await page.getByRole('button', { name: 'Add 🔥' }).click();
  await expect(selBox(page)).toBeVisible();
  const b = (await selBox(page).boundingBox())!;
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: string, d: number) => cdp.send('Input.dispatchTouchEvent', {
    type, touchPoints: type === 'touchEnd' ? [] : [{ x: cx - d, y: cy, id: 1 }, { x: cx + d, y: cy, id: 2 }],
  });
  await touch('touchStart', 10);
  for (let d = 14; d <= 60; d += 6) await touch('touchMove', d);
  await touch('touchEnd', 60);
  const after = (await selBox(page).boundingBox())!;
  expect(after.width).toBeGreaterThan(b.width * 2);
});

test('exports a video', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 60_000 });
});

const time = (page: Page) => page.locator('.time b').textContent();
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test('media survives a reload (storage fallback on Safari)', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png', 'landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.waitForTimeout(1000); // autosave
  await page.reload();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await expect(page.locator('.clip-canvas').first()).toBeVisible();
});

test('split, undo and redo', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 60 * 2; });
  await expect.poll(() => time(page)).toBe('0:02.0');
  await tool(page, 'Split').click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
});

test('playback moves the playhead', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => parseFloat((await time(page))!.split(':')[1]), { timeout: 8000 }).toBeGreaterThan(0.8);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
});

test('text can be moved by dragging it in the preview', async ({ page }) => {
  await newProject(page);
  await tool(page, 'Text').click();
  await page.getByRole('button', { name: 'Done' }).click();
  const b = await stableBox(page);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2 + 120, { steps: 8 });
  await page.mouse.up();
  const a = (await selBox(page).boundingBox())!;
  expect(a.y - b.y).toBeGreaterThan(80);
});

test('dragging text shows center guides and snaps to the middle', async ({ page }) => {
  await newProject(page);
  await tool(page, 'Text').click();
  await page.getByRole('button', { name: 'Done' }).click();
  const b = await stableBox(page);
  const x = b.x + b.width / 2, y = b.y + b.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 40, y + 80, { steps: 6 });
  await expect(page.locator('.guide.v')).toBeHidden(); // 40 px off center: no guide
  await page.mouse.move(x + 4, y + 80, { steps: 4 });
  await expect(page.locator('.guide.v')).toBeVisible(); // within 8 px: snaps and shows the vertical center line
  await page.mouse.up();
  await expect(page.locator('.guide.v')).toBeHidden();
  const a = await stableBox(page);
  expect(Math.abs(a.x + a.width / 2 - x)).toBeLessThan(1.5); // exactly centered again
});

test('imports subtitles from an .srt file', async ({ page }) => {
  await newProject(page);
  await tool(page, 'Captions').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .srt or .vtt' }).click();
  await (await chooser).setFiles(fx('test.srt'));
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  await expect(page.locator('.caption-row input').first()).toHaveValue('Hello from Kadr');
});

test('imports a MediaRecorder voice recording (what voice-over produces)', async ({ page }, info) => {
  await newProject(page);
  // Record 1.5 s of a tone with the browser's own MediaRecorder: WebM/Opus in Chromium, MP4/AAC in WebKit.
  const { data, type } = await page.evaluate(async () => {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const mime = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'].find((t) => MediaRecorder.isTypeSupported(t))!;
    const rec = new MediaRecorder(dest.stream, { mimeType: mime });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(250);
    await new Promise((r) => setTimeout(r, 1500));
    rec.stop();
    await done;
    const buf = new Uint8Array(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return { data: btoa(s), type: rec.mimeType };
  });
  const file = info.outputPath(type.includes('mp4') ? 'voice.m4a' : 'voice.webm');
  (await import('node:fs')).writeFileSync(file, Buffer.from(data, 'base64'));
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Audio').click();
  await (await chooser).setFiles(file);
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
});

test('builds a slideshow from a template', async ({ page }) => {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.template-card', { hasText: 'Slideshow' }).click();
  await (await chooser).setFiles([fx('photo.png'), fx('person.jpg'), fx('music.m4a')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
});

test('crop, filters and cutout tools work on a photo', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await tool(page, 'Crop').click();
  await page.getByRole('radio', { name: '1:1' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await tool(page, 'Filters').click();
  await page.getByRole('radio', { name: 'Noir' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await tool(page, 'Cutout').click();
  // The state, not the 3-second toast: in software-rendered CI the first segmentation can outlast the toast.
  await expect(tool(page, 'Cutout')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
});

// ---------- Every tool, end to end ----------

const sheet = (page: Page) => page.locator('.sheet');
const mainVideo = (page: Page) => page.locator('.tl-row.main .clip-video').first();
/** Selects a timeline clip (a tap on an already selected clip would deselect it). */
async function selectClip(page: Page, clip: ReturnType<Page['locator']>) {
  // Retried: right after an edit the clip element can be re-rendered under the pointer.
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}


/** Opens a tool sheet, nudges its first slider, picks its second option and closes it. */
async function useSheet(page: Page, name: string) {
  await tool(page, name).click();
  await expect(sheet(page)).toBeVisible();
  const slider = sheet(page).locator('input[type=range]').first();
  if (await slider.count()) { await slider.focus(); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); }
  const radios = sheet(page).getByRole('radio');
  if ((await radios.count()) > 1) await radios.nth(1).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toHaveCount(0);
}

/** Exports with the smallest preset, saves the file and checks it with ffprobe/ffmpeg. */
async function exportAndProbe(page: Page, info: { outputPath: (n: string) => string }, expectAudio = true) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  const { execFileSync } = await import('node:child_process');
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', file]).toString();
  const j = JSON.parse(probe) as { format: { duration: string }; streams: { codec_type: string }[] };
  expect(j.streams.map((x) => x.codec_type)).toContain('video');
  if (expectAudio) expect(j.streams.map((x) => x.codec_type)).toContain('audio');
  const decodeErrors = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-f', 'null', '-'], { stdio: ['ignore', 'pipe', 'pipe'] }).toString();
  expect(decodeErrors).toBe('');
  return Number(j.format.duration);
}

test('every video tool works, then the result exports cleanly', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await selectClip(page, mainVideo(page));
  for (const name of ['Speed', 'Volume', 'Remove pauses', 'Crop', 'Adjust', 'Filters', 'Transform', 'Mask']) await useSheet(page, name);
  for (const name of ['Auto reframe', 'Cutout', 'Extract audio', 'Freeze', 'Duplicate', 'Split', 'Reverse']) {
    await selectClip(page, mainVideo(page));
    await tool(page, name).click();
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
  }
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
  // Photo tools
  await selectClip(page, page.locator('.tl-row.main .clip-image').last());
  for (const name of ['Crop', 'Adjust', 'Filters', 'Transform', 'Mask']) await useSheet(page, name);
  await tool(page, 'Delete').click();
  // Undo everything and redo it back
  const undo = page.getByRole('button', { name: 'Undo' }), redo = page.getByRole('button', { name: 'Redo' });
  const clips = await page.locator('.tl-row .clip').count();
  for (let i = 0; i < 8; i++) await undo.click();
  for (let i = 0; i < 8; i++) await redo.click();
  await expect(page.locator('.tl-row .clip')).toHaveCount(clips);
  await expect(redo).toBeDisabled();
  const duration = await exportAndProbe(page, info);
  expect(duration).toBeGreaterThan(3);
});

test('music: beat detection, cut to the beat, ducking, export', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Audio', ['beat120.m4a']);
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
  await page.locator('.tl-row.audio .clip').click();
  await tool(page, 'Beat').click();
  await page.getByRole('button', { name: 'Find the beat' }).click();
  await expect(page.getByText('BPM')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.beat-bpm b')).toHaveText(/^(119|120|121)$/);
  await page.getByRole('radio', { name: 'every beat' }).click();
  await expect(page.getByText(/cuts now land on the beat/)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('.tl-row.audio .clip').first().click();
  await tool(page, 'Volume').click();
  await page.getByLabel('Lower when others speak').check();
  await page.getByRole('button', { name: 'Done' }).click();
  await exportAndProbe(page, info);
});

test('auto captions, edit by text, .srt export', async ({ page }) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click(); // one tap: no settings on the way (v1.3)
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 240_000 });
  if (!(await sheet(page).isVisible())) await tool(page, 'Edit captions').click();
  await expect(page.getByRole('button', { name: 'Save as .srt' })).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as .srt' }).click();
  const srt = await (await import('node:fs')).promises.readFile(await (await dl).path(), 'utf8');
  expect(srt).toMatch(/00:00:0\d,\d{3} --> /);
  expect(srt).toMatch(/[A-Za-z]{3,}/); // recognized words, not an empty file
  await page.getByRole('button', { name: 'Edit video by text' }).click();
  const before = await time(page);
  await sheet(page).locator('.word').nth(1).click();
  await page.getByRole('button', { name: /^Cut 1 words/ }).click();
  await expect(page.getByText(/Cut 1 words, .* s shorter/)).toBeVisible();
  expect(before).toBeTruthy();
});

test('home: sample, backup, restore, rename, delete and every template', async ({ page }, info) => {
  test.setTimeout(240_000);
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('Renamed') : d.accept()));
  await page.goto('./');
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.tl-row.main .clip').first()).toBeVisible();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const first = page.locator('.project-open').first();
  await expect(first).toBeVisible();
  const name = (await first.getAttribute('aria-label'))!.replace(/^Open /, '');
  await page.getByRole('button', { name: `Rename ${name}` }).click();
  await expect(page.getByRole('button', { name: 'Open Renamed' })).toBeVisible();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a backup of Renamed' }).click();
  const backup = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(backup);
  await page.getByRole('button', { name: 'Delete Renamed' }).click();
  await expect(page.getByRole('button', { name: 'Open Renamed' })).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore backup' }).click();
  await (await chooser).setFiles(backup);
  await expect(page.locator('.tl-row.main .clip').first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const cards = page.locator('.template-card');
  await expect(cards.first()).toBeVisible();
  const n = await cards.count();
  expect(n).toBeGreaterThanOrEqual(6);
  for (let i = 0; i < n; i++) {
    const c = page.waitForEvent('filechooser');
    await cards.nth(i).click();
    await (await c).setFiles(['photo.png', 'person.jpg', 'landscape.mp4', 'music.m4a'].map(fx));
    await expect(page.locator('.tl-row .clip').first()).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Back to projects' }).click();
  }
});

// ---------- v0.6: sound and export formats ----------

/** Runs an export of the given format from the export sheet and returns the saved file path. */
async function exportAs(page: Page, info: { outputPath: (n: string) => string }, format: 'Video' | 'Photo' | 'GIF' | 'Audio', button: string, opts: { loudness?: boolean } = {}) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: format, exact: true }).click();
  if (format === 'Video') await page.getByRole('radio', { name: 'Small file' }).click();
  if (opts.loudness === false) await page.getByRole('switch', { name: /Even loudness/ }).uncheck();
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}

/** Integrated loudness and sample peak measured by ffmpeg's EBU R128 filter. */
async function loudnessOf(file: string) {
  const { spawnSync } = await import('node:child_process');
  const out = spawnSync('ffmpeg', ['-nostats', '-i', file, '-filter_complex', 'ebur128=peak=sample', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const summary = out.slice(out.lastIndexOf('Summary:'));
  // Pure silence reads as -inf (or -70) LUFS.
  const num = (re: RegExp) => { const m = re.exec(summary)?.[1]; return m === undefined || m.includes('inf') ? -Infinity : Number(m); };
  return { lufs: num(/I:\s+(-?[\d.]+|-inf) LUFS/), peak: num(/Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}

async function probe(file: string) {
  const { execFileSync } = await import('node:child_process');
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_name,codec_type,width,height,nb_read_frames:format=duration', '-of', 'json', file]).toString()) as {
    streams: { codec_name: string; codec_type: string; width?: number; height?: number; nb_read_frames?: string }[]; format: { duration?: string };
  };
}

test('enhance voice: processed to -16 LUFS; exports normalize to -14 LUFS', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Audio', ['noisy_en.m4a']);
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
  await page.locator('.tl-row.audio .clip').click();
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Enhance voice' }).check();
  await expect(page.getByRole('switch', { name: 'Enhance voice' })).toBeChecked({ timeout: 120_000 });
  await expect(page.getByRole('switch', { name: 'Reduce background noise' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();
  const raw = await loudnessOf(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  expect(raw.lufs).toBeGreaterThan(-17.5);
  expect(raw.lufs).toBeLessThan(-14.5);
  expect(raw.peak).toBeLessThanOrEqual(-0.9);
  const video = await loudnessOf(await exportAs(page, info, 'Video', 'Export video'));
  expect(Math.abs(video.lufs + 14)).toBeLessThan(1);
  expect(video.peak).toBeLessThanOrEqual(-0.9);
  // Undo returns to the plain sound in one step.
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.locator('.tl-row.audio .clip').click();
  await tool(page, 'Volume').click();
  await expect(page.getByRole('switch', { name: 'Enhance voice' })).not.toBeChecked();
});

test('exports a photo of the current frame and a looping GIF', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const photo = await probe(await exportAs(page, info, 'Photo', 'Save photo'));
  expect(photo.streams[0].codec_name).toBe('mjpeg');
  expect([photo.streams[0].width, photo.streams[0].height]).toEqual([1080, 1920]);
  const gif = await probe(await exportAs(page, info, 'GIF', 'Export GIF'));
  expect(gif.streams[0].codec_name).toBe('gif');
  expect([gif.streams[0].width, gif.streams[0].height]).toEqual([270, 480]);
  expect(Number(gif.streams[0].nb_read_frames)).toBe(72); // 6 s × 12 fps
});

// ---------- v0.6: effects, LUTs, hiding faces ----------

/** Exported frame as 270×480 grayscale pixels. */
async function gray(file: string): Promise<Buffer> {
  const { execFileSync } = await import('node:child_process');
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=270:480', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
}
/** Share of pixels that differ by more than `thr` levels. */
const changed = (a: Buffer, b: Buffer, thr: number) => { let n = 0; for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > thr) n++; return n / a.length; };
const photo = async (page: Page, info: { outputPath: (n: string) => string }) => gray(await exportAs(page, info, 'Photo', 'Save photo'));
/** Samples the progress bar every 200 ms until `done` appears (docs/09 Q4: never backwards, keeps moving). */
const sampleProgress = (page: Page, done: string) => page.evaluate((sel) => new Promise<number[]>((res) => {
  const out: number[] = [];
  const id = setInterval(() => {
    const el = document.querySelector('[role=progressbar]');
    if (el) out.push(Number(el.getAttribute('aria-valuenow')));
    if (document.querySelector(sel)) { clearInterval(id); res(out); }
  }, 200);
}), done);
function expectHonestProgress(v: number[]) {
  expect(v.length, 'the bar was shown').toBeGreaterThan(5);
  v.forEach((x, i) => { if (i) expect(x, `sample ${i}`).toBeGreaterThanOrEqual(v[i - 1]); });
  expect(new Set(v.map((x) => x.toFixed(3))).size, 'it keeps moving').toBeGreaterThan(5);
  expect(Math.max(...v)).toBeLessThan(1);
}

/** The 270×480 gray frame mirrored left–right (`x`) and/or upside down (`y`). */
function mirrored(g: Buffer, x: boolean, y: boolean): Buffer {
  const [W, H] = [270, 480];
  const o = Buffer.alloc(g.length);
  for (let r = 0; r < H; r++) for (let c = 0; c < W; c++) o[r * W + c] = g[(y ? H - 1 - r : r) * W + (x ? W - 1 - c : c)];
  return o;
}

test('video effects change the exported picture', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const base = await photo(page, info);
  for (const name of ['Blur', 'VHS', 'RGB split', 'Zoom punch']) {
    await selectClip(page, page.locator('.tl-row.main .clip').first());
    await tool(page, 'Effects').click();
    await page.getByRole('radio', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    expect(changed(base, await photo(page, info), 8), name).toBeGreaterThan(0.02);
  }
});

test('mirror: one tap flips the picture left to right, Transform turns it upside down, undo restores', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const base = await photo(page, info);
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Mirror').click();
  await expect(tool(page, 'Mirror')).toHaveAttribute('aria-pressed', 'true');
  const flipped = await photo(page, info);
  expect(changed(base, flipped, 8), 'the picture changed').toBeGreaterThan(0.05);
  expect(changed(mirrored(base, true, false), flipped, 12), 'into its mirror image').toBeLessThan(0.02);
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Transform').click();
  await page.getByRole('button', { name: 'Upside down' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  expect(changed(mirrored(base, true, true), await photo(page, info), 12), 'and upside down').toBeLessThan(0.02);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  expect(changed(base, await photo(page, info), 8), 'undo restores').toBeLessThan(0.01);
});

test('LUT import: identity keeps the picture, invert inverts it', async ({ page }, info) => {
  test.setTimeout(180_000);
  const fs = await import('node:fs');
  const cube = (name: string, f: (v: number[]) => number[]) => {
    const lines = ['TITLE "' + name + '"', 'LUT_3D_SIZE 9'];
    for (let b = 0; b < 9; b++) for (let g = 0; g < 9; g++) for (let r = 0; r < 9; r++) lines.push(f([r / 8, g / 8, b / 8]).join(' '));
    const file = info.outputPath(`${name}.cube`);
    fs.writeFileSync(file, lines.join('\n'));
    return file;
  };
  const importLut = async (file: string) => {
    await selectClip(page, page.locator('.tl-row.main .clip').first());
    await tool(page, 'Filters').click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import LUT (.cube)' }).click();
    await (await chooser).setFiles(file);
    await expect(page.getByRole('radio', { name: file.split('/').pop()!.replace('.cube', '') })).toBeChecked();
    await page.getByRole('button', { name: 'Done' }).click();
  };
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const base = await photo(page, info);
  await importLut(cube('identity', (v) => v));
  expect(changed(base, await photo(page, info), 6)).toBeLessThan(0.01);
  await importLut(cube('invert', (v) => v.map((x) => 1 - x)));
  const inv = await photo(page, info);
  let err = 0, n = 0;
  for (let i = 0; i < base.length; i++) {
    if (base[i] < 3 && inv[i] < 3) continue; // letterbox bars are canvas background, not the clip
    err += Math.abs(base[i] + inv[i] - 255);
    n++;
  }
  expect(n / base.length).toBeGreaterThan(0.3);
  expect(err / n).toBeLessThan(10);
});

test('hide faces automatically and with an area', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const base = await photo(page, info);
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Hide faces').click();
  await page.getByRole('switch', { name: 'Hide faces automatically' }).click(); // switches after the detector loads
  await expect(page.getByRole('switch', { name: 'Hide faces automatically' })).toBeChecked({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  const hidden = await photo(page, info);
  const faces = changed(base, hidden, 20);
  expect(faces).toBeGreaterThan(0.004); // the face is hidden…
  expect(faces).toBeLessThan(0.2); // …and only the face
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Hide faces').click();
  await page.getByRole('radio', { name: 'Pixelate' }).click();
  await page.getByRole('button', { name: 'Add area' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const covered = await photo(page, info);
  expect(changed(hidden, covered, 20)).toBeGreaterThan(0.01); // the area hides more
  // Mirrored, the face and the area stay hidden: the whole frame is the mirror image of the covered one (v1.2).
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Mirror').click();
  expect(changed(mirrored(covered, true, false), await photo(page, info), 12)).toBeLessThan(0.02);
});

test('multi-select: pick clips on several tracks, delete, undo, duplicate', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png', 'landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Text').click();
  await page.getByRole('button', { name: 'Done' }).click();
  const text = page.locator('.clip-text');
  await expect(text).toHaveCount(1);
  await tool(page, 'Select several').click();
  await expect(text).toHaveClass(/picked/);
  await page.locator('.tl-row.main .clip-image').click();
  await expect(page.getByRole('status').filter({ hasText: '2 selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await expect(text).toHaveCount(0);
  await page.getByRole('button', { name: 'Undo' }).click(); // one step restores both
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await expect(text).toHaveCount(1);
  await text.click();
  await page.locator('.tl-row.main .clip-image').click();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(3);
  await expect(page.locator('.clip-text')).toHaveCount(2);
  await expect(page.locator('.clip.picked')).toHaveCount(2); // the copies are now picked
  await page.getByRole('button', { name: 'Finish selecting' }).click();
  await expect(page.locator('.clip.picked')).toHaveCount(0);
});

/** A synthetic camera: white left half, black right half, a moving strip on top, plus a tone, so tests run headless. */
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __tracks: MediaStreamTrack[] };
    w.__tracks = [];
    MediaDevices.prototype.getUserMedia = async function () {
      const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const g = c.getContext('2d')!;
      let f = 0;
      setInterval(() => {
        g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
        g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 360);
        g.fillStyle = `hsl(${(f++ * 7) % 360} 70% 50%)`; g.fillRect(0, 0, 640, 20);
      }, 33);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      const s = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
      w.__tracks.push(...s.getTracks());
      return s;
    };
  });
}

test('camera with teleprompter scrolls the script, records a mirrored clip onto the main track and releases the camera', async ({ page }, info) => {
  test.setTimeout(120_000);
  await fakeCamera(page);
  await newProject(page);
  await tool(page, 'Camera').click();
  await page.getByRole('button', { name: 'Edit script' }).click();
  await page.getByRole('textbox', { name: 'Script' }).fill('Hello! This is a teleprompter test.\nSecond line.');
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 }); // after 3-2-1
  await expect(page.getByLabel('Teleprompter')).toContainText('teleprompter test');
  await page.waitForTimeout(2500);
  expect(await page.getByLabel('Teleprompter').evaluate((el) => el.scrollTop), 'the script scrolls while recording').toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(1, { timeout: 30_000 });
  expect(await page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((tr) => tr.readyState === 'ended'))).toBe(true);
  const file = await exportAs(page, info, 'Video', 'Export video');
  const pr = await probe(file);
  expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Number(pr.format.duration)).toBeGreaterThan(1.5);
  // The teleprompter text stays with the recording: Auto captions offer it as the words (docs/09 S1).
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'From my text' })).toHaveAttribute('aria-checked', 'true');
  await expect(page.getByRole('textbox', { name: 'Your text' })).toHaveValue('Hello! This is a teleprompter test.\nSecond line.');
  await page.getByRole('button', { name: 'Done' }).click();
  // The front camera is recorded as the mirrored preview shows it: the white half ends up on the right.
  const { execFileSync } = await import('node:child_process');
  const g = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-i', file, '-frames:v', '1', '-vf', 'scale=90:160', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  const mean = (x0: number, x1: number) => { let sum = 0; for (let x = x0; x < x1; x++) sum += g[80 * 90 + x]; return sum / (x1 - x0); };
  expect(mean(55, 85), 'right side is the white half').toBeGreaterThan(mean(5, 35) + 100);
});

test('Russian text renders in each chosen font, not a fallback', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await tool(page, 'Text').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Привет, мир! Съешь ещё');
  const shots: Buffer[] = [];
  const at = await time(page);
  for (const font of ['Montserrat', 'Lobster', 'Caveat', 'Pixel', 'Anton']) {
    if (!(await sheet(page).isVisible())) await tool(page, 'Edit text').click();
    await page.getByRole('radiogroup', { name: 'Font' }).getByRole('radio', { name: font, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    shots.push(await photo(page, info));
    expect(await time(page), 'opening the export sheet must not move the playhead').toBe(at);
  }
  // Two script fonts share the same generic fallback: if Cyrillic fell back, they would look identical.
  for (let i = 0; i < shots.length; i++) for (let j = i + 1; j < shots.length; j++) expect(changed(shots[i], shots[j], 30), `${i} vs ${j}`).toBeGreaterThan(0.001);
  expect(await page.evaluate(() => ['400 32px "Lobster"', '700 32px "Caveat"', '400 32px "Oswald"'].every((f) => document.fonts.check(f, 'Привет')))).toBe(true);
});

test('scrolling the timeline by hand still scrubs the playhead', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const before = await time(page);
  // A user scroll: an input event (wheel) followed by the scroll it causes.
  await page.locator('.tl-scroll').evaluate((el) => { el.dispatchEvent(new WheelEvent('wheel', { deltaX: 120, bubbles: true })); el.scrollLeft += 120; });
  await expect.poll(() => time(page)).not.toBe(before);
});

test('new transitions render mid-cut and "Apply to all cuts" sets every cut', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png', 'person.jpg', 'photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(3);
  await page.getByRole('button', { name: 'Close tools' }).click(); // a selected clip hides the cut buttons at its edges
  const cuts = page.getByRole('button', { name: 'Transition' });
  await expect(cuts).toHaveCount(2);
  // Mid-cut frame: the playhead goes to the middle of the first cut (clip 2 starts 0.5 s early, transition 0.5 s).
  // Photos last 3 s; with a 0.5 s transition clip 2 starts at 2.5 s, so 2.75 s is mid-cut (60 px per second).
  const midCut = () => page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 2.75 * 60; });
  await cuts.first().click();
  await page.getByRole('radio', { name: 'None' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await midCut();
  const plain = await photo(page, info);
  for (const name of ['Whip pan', 'Circle', 'Pixelate', 'Flash']) {
    await cuts.first().click();
    await page.getByRole('radio', { name, exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await midCut();
    expect(changed(plain, await photo(page, info), 20), name).toBeGreaterThan(0.02);
  }
  await cuts.first().click();
  await page.getByRole('radio', { name: 'Spin', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to all cuts' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await cuts.nth(1).click();
  await expect(page.getByRole('radio', { name: 'Spin', exact: true })).toBeChecked();
});

test('music library: track fits the video, beat is ready, guide track is not exported', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']); // 3 s, no sound of its own
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Music').click();
  await page.getByRole('radiogroup', { name: 'Mood' }).getByRole('radio', { name: 'Energetic' }).click();
  const row = page.locator('.music-row', { hasText: 'BPM' }).first();
  await row.getByRole('button', { name: 'Listen to', exact: false }).click();
  await expect(row).toHaveClass(/on/);
  await row.getByRole('button', { name: 'Add', exact: false }).click();
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1, { timeout: 60_000 });
  // Fitted to the 3 s video with a fade-out; loudness-normalized library audio.
  const plain = await probe(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  expect(Math.abs(Number(plain.format.duration) - 3)).toBeLessThan(0.15);
  // Beat grid came with the track: no analysis step.
  await page.locator('.tl-row.audio .clip').click();
  await tool(page, 'Beat').click();
  await expect(page.locator('.beat-bpm b')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Find the beat' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Done' }).click();
  // Guide track: heard while editing, silent in the file.
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: /Guide track/ }).check();
  await expect(page.getByRole('button', { name: 'Copy license' })).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.tl-row.audio .clip')).toContainText('Guide');
  const guided = await loudnessOf(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  expect(guided.lufs).toBeLessThan(-60);
});

test('text style pack and a custom font that survives backup and restore', async ({ page }, info) => {
  test.setTimeout(240_000);
  const fs = await import('node:fs');
  const fontFile = info.outputPath('MyFont.woff2');
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2'), fontFile);
  page.on('dialog', (d) => void d.accept());
  await newProject(page);
  await tool(page, 'Text').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Kadr 2026');
  const styles = page.getByRole('radiogroup', { name: 'Style' }).getByRole('radio');
  expect(await styles.count()).toBeGreaterThanOrEqual(40);
  await page.getByRole('button', { name: 'Done' }).click();
  // Every photo at 0.6 s: past any style's entrance animation, the same moment the restored project is checked at.
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0.6 * 60; });
  const plain = await photo(page, info);
  await tool(page, 'Edit text').click();
  await page.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Comic' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  expect(changed(plain, await photo(page, info), 30), 'Comic style').toBeGreaterThan(0.002);
  // Custom font
  await tool(page, 'Edit text').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add font' }).click();
  await (await chooser).setFiles(fontFile);
  await expect(page.getByRole('radiogroup', { name: 'Font' }).getByRole('radio', { name: 'MyFont' })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
  const custom = await photo(page, info);
  expect(changed(plain, custom, 30), 'custom font').toBeGreaterThan(0.002);
  // Backup → restore: the font comes back with the project
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: /^Save a backup of/ }).first().click();
  const backup = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(backup);
  const c2 = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore backup' }).click();
  await (await c2).setFiles(backup);
  await expect(page.locator('.clip-text')).toHaveCount(1, { timeout: 60_000 });
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0.6 * 60; });
  const restored = await photo(page, info);
  expect(changed(custom, restored, 30), 'restored text uses the custom font').toBeLessThan(0.002);
});

test('background removal leaves clean edges (no light halo around dark clothes)', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Cutout').click();
  await expect(tool(page, 'Cutout')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  const { execFileSync } = await import('node:child_process');
  const w = 540, h = 960;
  const g = execFileSync('ffmpeg', ['-v', 'error', '-i', await exportAs(page, info, 'Photo', 'Save photo'), '-vf', `scale=${w}:${h}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
  // Halo: a light pixel between the black background and the dark suit (within 3 px). 578 before the
  // edge matting of docs/05 M4, ~260 after.
  let halo = 0;
  for (let y = 3; y < h - 3; y++) for (let x = 3; x < w - 3; x++) {
    if (g[y * w + x] <= 110) continue;
    for (const d of [1, w]) {
      const a = g[y * w + x - 3 * d], b = g[y * w + x + 3 * d];
      if ((a < 8 && b >= 8 && b < 80) || (b < 8 && a >= 8 && a < 80)) { halo++; break; }
    }
  }
  expect(halo).toBeLessThan(400);
});

// ---------- Full functional sweep (everything not covered above) ----------

test('timeline: trim, reorder main clips and move an overlay by dragging', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png', 'person.jpg']);
  const main = page.locator('.tl-row.main .clip');
  await expect(main).toHaveCount(2);
  const ids = await main.evaluateAll((els) => els.map((e) => e.getAttribute('data-clip')));
  // Trim the end of the selected first clip by ~1 s (60 px per second).
  await selectClip(page, main.first());
  const w0 = (await main.first().boundingBox())!.width;
  const h = (await main.first().getByLabel('Trim end').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 60, h.y + h.height / 2, { steps: 6 });
  await page.mouse.up();
  await expect.poll(async () => (await main.first().boundingBox())!.width).toBeLessThan(w0 - 40);
  // Drag the first clip past the second: the order swaps.
  const b = (await main.first().boundingBox())!, b2 = (await main.nth(1).boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b2.x + b2.width - 4, b.y + b.height / 2, { steps: 10 });
  await page.mouse.up();
  await expect.poll(() => main.evaluateAll((els) => els.map((e) => e.getAttribute('data-clip')))).toEqual([ids[1], ids[0]]);
  // A text clip on an overlay track moves in time.
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Text').click();
  await page.getByRole('button', { name: 'Done' }).click();
  const text = page.locator('.clip-text');
  const t0 = (await text.boundingBox())!;
  await page.mouse.move(t0.x + t0.width / 2, t0.y + t0.height / 2);
  await page.mouse.down();
  await page.mouse.move(t0.x + t0.width / 2 + 60, t0.y + t0.height / 2, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await text.boundingBox())!.x - t0.x).toBeGreaterThan(40);
});

test('sound effects and a voice-over from the Record sheet', async ({ page }) => {
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async function () {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
  });
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Sounds').click();
  await page.getByRole('button', { name: 'Add Whoosh at the playhead' }).click();
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Record').click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 });
  // The fake microphone is a full-scale sine: the clip mark and the hint light up (v1.2 Q5).
  await expect(page.getByText('Too loud: hold the phone a little further away')).toBeVisible();
  await expect(page.locator('.meter.clip')).toHaveCount(1);
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(2, { timeout: 30_000 });
});

test('remove pauses shortens speech; speed 2× halves a clip', async ({ page }) => {
  test.setTimeout(120_000);
  await newProject(page);
  await importFiles(page, 'Audio', ['speech_pauses.m4a']);
  const audio = page.locator('.tl-row.audio .clip');
  await expect(audio).toHaveCount(1);
  const before = (await audio.first().boundingBox())!.width;
  await selectClip(page, audio.first());
  await tool(page, 'Remove pauses').click();
  await sheet(page).getByRole('button', { name: 'Remove pauses' }).click({ timeout: 60_000 });
  await expect(page.getByText(/Removed \d+ pauses/)).toBeVisible();
  await expect.poll(async () => (await audio.evaluateAll((els) => els.reduce((s, e) => s + e.getBoundingClientRect().width, 0)))).toBeLessThan(before - 20);
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Media', ['landscape.mp4']);
  const video = page.locator('.tl-row.main .clip-video');
  await expect(video).toHaveCount(1);
  const w = (await video.boundingBox())!.width;
  await selectClip(page, video);
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await video.boundingBox())!.width / w).toBeLessThan(0.55);
});

test('auto reframe follows a walking person in a vertical project', async ({ page }) => {
  test.setTimeout(120_000);
  await newProject(page);
  await importFiles(page, 'Media', ['walk.mp4']);
  const clip = page.locator('.tl-row.main .clip-video');
  await expect(clip).toHaveCount(1);
  await selectClip(page, clip);
  await tool(page, 'Auto reframe').click();
  await expect(page.getByText(/Reframed/)).toBeVisible({ timeout: 90_000 });
  await tool(page, 'Transform').click();
  await expect(page.getByRole('button', { name: /Position X keyframe/ })).toHaveClass(/animated/);
});

test('keyframes, chroma key and a mask change the picture', async ({ page }, info) => {
  test.setTimeout(150_000);
  await newProject(page);
  // Half pure green screen, half red: a working chroma key removes about half of the picture.
  const { execFileSync } = await import('node:child_process');
  const gs = info.outputPath('greenscreen.png');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=c=0x00ff00:s=540x960,drawbox=x=0:y=480:w=540:h=480:color=0xd02020:t=fill', '-frames:v', '1', gs]);
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(gs);
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0.5 * 60; });
  const base = await photo(page, info);
  await selectClip(page, clip);
  await tool(page, 'Chroma key').click(); // its own tool next to Cutout (v1.2)
  await page.getByRole('switch', { name: 'Remove color (green screen)' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  const keyed = await photo(page, info);
  const removed = changed(base, keyed, 20);
  expect(removed, 'chroma key removes the green half').toBeGreaterThan(0.4);
  expect(removed, 'and keeps the red half').toBeLessThan(0.6);
  await selectClip(page, clip);
  await tool(page, 'Mask').click();
  await sheet(page).getByRole('radio', { name: 'Circle' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  expect(changed(keyed, await photo(page, info), 20), 'mask').toBeGreaterThan(0.05);
  // Keyframes: X at 0.5 s stays, X at 2.5 s moves → the two times look different.
  await selectClip(page, clip);
  await tool(page, 'Transform').click();
  await page.getByRole('button', { name: 'Add Position X keyframe' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 2.5 * 60; });
  await selectClip(page, clip);
  await tool(page, 'Transform').click();
  const x = sheet(page).locator('input[type=range]').first();
  await x.focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Done' }).click();
  const late = await photo(page, info);
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0.5 * 60; });
  expect(changed(late, await photo(page, info), 20), 'keyframed position').toBeGreaterThan(0.02);
});

test('canvas: aspect ratio and blurred background; safe zones overlay', async ({ page }, info) => {
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Show TikTok, Reels and Shorts safe zones' }).click();
  await expect(page.locator('.safe-zones')).toBeVisible();
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Canvas').click();
  await sheet(page).getByRole('radio', { name: 'Blur' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const g = await photo(page, info); // 9:16 with a 16:9 video: the top band shows the blurred video, not black
  let top = 0;
  for (let i = 0; i < 270 * 60; i++) top += g[i];
  expect(top / (270 * 60)).toBeGreaterThan(12);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  await tool(page, 'Canvas').click();
  await sheet(page).getByRole('radio', { name: '16:9' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => { const b = (await page.locator('.preview-canvas').boundingBox())!; return Math.round((b.width / b.height) * 100) / 100; }).toBeCloseTo(1.78, 1);
});

test('noise reduction processes; ducking lowers music under speech', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Audio', ['beat120.m4a']);
  const music = page.locator('.tl-row.audio .clip').first();
  await expect(music).toHaveCount(1);
  const { execFileSync } = await import('node:child_process');
  const pcm = (file: string) => { const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']); return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4); };
  const plain = pcm(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  await selectClip(page, music);
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Lower when others speak' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  const ducked = pcm(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  // The music changes while the speech plays (first ~5 s) and is untouched after it (from 8 s).
  const diff = (a: number, b: number) => { let s = 0; for (let i = a * 8000; i < b * 8000; i++) s += (plain[i] - ducked[i]) ** 2; return Math.sqrt(s / ((b - a) * 8000)); };
  expect(diff(1, 4)).toBeGreaterThan(0.01);
  expect(diff(8, 11)).toBeLessThan(diff(1, 4) / 10);
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Reduce background noise' }).check();
  await expect(page.getByRole('switch', { name: 'Reduce background noise' })).toBeChecked({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  const pr = await probe(await exportAs(page, info, 'Audio', 'Export audio'));
  expect(pr.streams.some((s) => s.codec_type === 'audio')).toBe(true);
});

test('works offline after the first visit (service worker)', async ({ page, context, browserName }, info) => {
  test.skip(browserName !== 'chromium', 'Playwright WebKit does not run service workers');
  test.skip(!!process.env.E2E_URL?.includes('localhost:51'), 'dev server has no service worker');
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // now controlled by the service worker
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.waitForTimeout(1000); // autosave
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 30_000 });
  const pr = await probe(await exportAs(page, info, 'Photo', 'Save photo'));
  expect(pr.streams[0].codec_name).toBe('mjpeg');
  await context.setOffline(false);
});

test('Russian interface: home, toolbar and sheets are translated', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('kadr.locale', 'ru'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const bar = page.getByRole('navigation', { name: 'Инструменты' });
  await expect(bar).toBeVisible();
  const labels = await bar.locator('.tool span').allTextContents();
  for (const en of ['Media', 'Overlay', 'Audio', 'Music', 'Camera', 'Record', 'Text', 'Captions', 'Stickers', 'Sounds', 'Canvas']) expect(labels).not.toContain(en);
  await bar.getByRole('button', { name: 'Текст' }).click();
  await expect(page.getByRole('dialog', { name: 'Текст' })).toBeVisible();
  await expect(page.getByRole('radiogroup', { name: 'Стиль' }).getByRole('radio', { name: 'Классика' })).toBeVisible();
});

test('drag and drop import, keyboard shortcuts, first-run tips and the ?perf overlay', async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('tipsOnce')) { sessionStorage.setItem('tipsOnce', '1'); localStorage.removeItem('kadr.tips'); } });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  // Drop a PNG made in the page onto the editor.
  await page.evaluate(async () => {
    const c = Object.assign(document.createElement('canvas'), { width: 320, height: 240 });
    c.getContext('2d')!.fillRect(0, 0, 320, 240);
    const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/png'));
    const dt = new DataTransfer();
    dt.items.add(new File([blob], 'dropped.png', { type: 'image/png' }));
    const target = document.querySelector('.editor')!;
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 20_000 });
  // First-run tips appear once there is a clip; walk through and close them.
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  const coach = page.locator('.coach');
  await expect(coach).toBeVisible();
  while (await coach.isVisible()) await coach.getByRole('button').click();
  // Shortcuts: S splits at the playhead, Ctrl/Cmd+Z undoes, Space plays and pauses.
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 1.5 * 60; });
  await page.locator('body').click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('s');
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Pause', exact: true })).toBeVisible();
  await page.keyboard.press(' ');
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible();
  // ?perf overlay: on with ?perf, off with ?perf=0.
  await page.goto('./?perf');
  await page.locator('.project-open').first().click();
  await expect(page.locator('.perf-overlay')).toContainText('fps');
  await page.goto('./?perf=0');
  await page.locator('.project-open').first().click();
  await expect(page.locator('.perf-overlay')).toHaveCount(0);
});

test('text: trim handles sit outside the clip, spacing sliders resize the text, rotation snaps and shows degrees', async ({ page }) => {
  await newProject(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('First line\nSecond line');
  // Letter and line spacing change the rendered block (seen through the selection box).
  const b0 = await stableBox(page);
  await page.getByRole('slider', { name: 'Letter spacing' }).fill('0.3');
  await expect.poll(async () => (await selBox(page).boundingBox())!.width).toBeGreaterThan(b0.width * 1.2);
  await page.getByRole('slider', { name: 'Line spacing' }).fill('2');
  await expect.poll(async () => (await selBox(page).boundingBox())!.height).toBeGreaterThan(b0.height * 1.3);
  await page.getByRole('button', { name: 'Done' }).click();
  // The clip body is exactly its duration on screen: handles start where the clip ends.
  const clip = page.locator('.tl-row .clip-text');
  const c = (await clip.boundingBox())!, end = (await clip.getByLabel('Trim end').boundingBox())!, start = (await clip.getByLabel('Trim start').boundingBox())!;
  expect(end.x).toBeGreaterThanOrEqual(c.x + c.width - 3);
  expect(start.x + start.width).toBeLessThanOrEqual(c.x + 3);
  // Rotating with the corner handle near 45° snaps to exactly 45° and shows the angle while dragging.
  const box = await stableBox(page);
  const h = (await page.locator('.sel-handle').boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
  const hx = h.x + h.width / 2, hy = h.y + h.height / 2;
  const a0 = Math.atan2(hy - cy, hx - cx), r = Math.hypot(hx - cx, hy - cy);
  const a = a0 + (43 * Math.PI) / 180;
  await page.mouse.move(hx, hy);
  await page.mouse.down();
  await page.mouse.move(cx + r * Math.cos(a), cy + r * Math.sin(a), { steps: 10 });
  await expect(page.locator('.angle-tag')).toHaveText('45°');
  await expect(page.locator('.angle-tag')).toHaveClass(/snapped/);
  await page.mouse.up();
  await expect(page.locator('.angle-tag')).toBeHidden();
  await tool(page, 'Transform').click();
  await expect(page.getByRole('slider', { name: 'Rotation' })).toHaveValue('45');
});

test('dragging text on a touch screen moves the text, not the page', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'touch injection needs the Chromium DevTools protocol');
  await newProject(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).focus();
  const b = await stableBox(page);
  const cdp = await page.context().newCDPSession(page);
  const x0 = b.x + b.width / 2, y0 = b.y + b.height / 2;
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
  for (let k = 1; k <= 12; k++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 + k * 3, y: y0 + k * 5 }] });
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await expect.poll(async () => (await selBox(page).boundingBox())!.y).toBeGreaterThan(b.y + 30);
  expect(await page.evaluate(() => [window.scrollY, document.scrollingElement?.scrollTop ?? 0, visualViewport?.offsetTop ?? 0])).toEqual([0, 0, 0]);
  expect(await page.evaluate(() => document.activeElement?.tagName)).not.toBe('TEXTAREA'); // the keyboard went away
});

test('a new text follows the finger from anywhere; a tap on empty space finishes, then the frame moves', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Text').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Hello');
  await page.getByRole('button', { name: 'Done' }).click();
  const before = await stableBox(page);
  const pv = (await page.locator('.preview-canvas').boundingBox())!;
  // Drag from the left edge of the frame, well away from the letters: the text moves, not the video.
  const from = { x: pv.x + 12, y: pv.y + pv.height * 0.5 + 30 };
  expect(from.x).toBeLessThan(before.x - 10);
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 50, from.y - 60, { steps: 8 });
  await page.mouse.up();
  const after = await stableBox(page);
  expect(after.x - before.x).toBeGreaterThan(40);
  expect(after.y - before.y).toBeLessThan(-45);
  await expect(tool(page, 'Edit text')).toBeVisible(); // still editing the text
  // A tap on the video (no movement) finishes: nothing is selected.
  await page.mouse.click(from.x, from.y);
  await expect(tool(page, 'Media')).toBeVisible();
  await expect(selBox(page)).toBeHidden();
  // Now a drag on the frame takes the video itself.
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 30, from.y, { steps: 6 });
  await page.mouse.up();
  await expect(tool(page, 'Crop')).toBeVisible();
  await expect(selBox(page)).toBeVisible();
});

test('trimming the start of a main clip: the left edge follows the finger and stays there on release, the gap closed', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'portrait.mp4']);
  const clip = page.locator('.tl-row.main .clip').nth(1);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close tools' }).click().catch(() => undefined);
  await selectClip(page, clip);
  const b0 = (await clip.boundingBox())!;
  const h = (await clip.getByLabel('Trim start').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 60, h.y + h.height / 2, { steps: 6 });
  const mid = (await clip.boundingBox())!;
  expect(Math.abs(mid.x - (b0.x + 60))).toBeLessThan(4); // left edge under the finger
  expect(Math.abs(mid.x + mid.width - (b0.x + b0.width))).toBeLessThan(4); // right edge stays
  await page.mouse.up();
  // Release: nothing jumps (v1.3). The view scrolled back by the trimmed width, so the clip stays under the finger…
  await page.waitForTimeout(300);
  const end = (await clip.boundingBox())!;
  expect(Math.abs(end.x - (b0.x + 60))).toBeLessThan(4);
  expect(Math.abs(end.x + end.width - (b0.x + b0.width))).toBeLessThan(4);
  // …and the gap is closed: the clip starts where the one before it ends.
  const prev = (await page.locator('.tl-row.main .clip').nth(0).boundingBox())!;
  expect(Math.abs(prev.x + prev.width - end.x)).toBeLessThan(3);
  // At 0:00 there is no room to scroll: the first clip glides back to the start instead of jumping.
  const first = page.locator('.tl-row.main .clip').nth(0);
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  await selectClip(page, first);
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  const f0 = (await first.boundingBox())!;
  const fh = (await first.getByLabel('Trim start').boundingBox())!;
  await page.mouse.move(fh.x + fh.width / 2, fh.y + fh.height / 2);
  await page.mouse.down();
  await page.mouse.move(fh.x + fh.width / 2 + 40, fh.y + fh.height / 2, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => Math.abs((await first.boundingBox())!.x - f0.x)).toBeLessThan(3);
  expect((await first.boundingBox())!.width).toBeLessThan(f0.width - 30);
});

test('dragging a clip to the edge of the timeline scrolls it', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['long_1.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click().catch(() => undefined);
  await tool(page, 'Text').click();
  await page.getByRole('button', { name: 'Done' }).click();
  const text = page.locator('.tl-row .clip-text');
  const scroller = page.locator('.tl-scroll');
  const s0 = await scroller.evaluate((el) => el.scrollLeft);
  const leftOf = () => text.evaluate((el) => parseFloat((el as HTMLElement).style.left)); // timeline (content) px
  const l0 = await leftOf();
  const b = (await text.boundingBox())!, view = (await scroller.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(view.x + view.width - 8, b.y + b.height / 2, { steps: 8 }); // into the right edge zone
  await page.waitForTimeout(1200);
  const s1 = await scroller.evaluate((el) => el.scrollLeft);
  expect(s1 - s0).toBeGreaterThan(300); // auto-scrolled
  const carried = (await text.boundingBox())!;
  expect(Math.abs(carried.x + carried.width / 2 - (view.x + view.width - 8))).toBeLessThan(20); // under the finger (≤ one frame of scroll behind)
  await page.mouse.up();
  // It landed where it was dropped: the finger's own travel plus the auto-scroll, far past what the finger alone allows.
  const finger = view.x + view.width - 8 - (b.x + b.width / 2);
  await expect.poll(leftOf).toBeGreaterThan(l0 + finger + 250);
});

test('speed 1.25× keeps the natural voice pitch by default, also when exporting right away', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']); // 440 Hz tone
  const video = page.locator('.tl-row.main .clip-video');
  await selectClip(page, video);
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '1.25×' }).click();
  await expect(page.getByRole('switch', { name: 'Keep natural voice pitch' })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click(); // closed before the sound is processed: export must do it
  const file = await exportAs(page, info, 'Video', 'Export video');
  const { execFileSync } = await import('node:child_process');
  const b = execFileSync('ffmpeg', ['-v', 'error', '-ss', '1', '-t', '2', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const pcm = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  let crossings = 0;
  for (let i = 1; i < pcm.length; i++) if ((pcm[i - 1] < 0) !== (pcm[i] < 0)) crossings++;
  const hz = crossings / 2 / (pcm.length / 48000);
  expect(Math.abs(hz - 440)).toBeLessThan(440 * 0.03); // not 550 Hz (pitched up by 1.25×)
});

test('teleprompter: visible while editing the script, size applies live, speed can be tested', async ({ page }) => {
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async function () {
      const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const g = c.getContext('2d')!;
      setInterval(() => { g.fillStyle = '#345'; g.fillRect(0, 0, 640, 360); }, 33);
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createOscillator().connect(dest);
      return new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    };
  });
  await newProject(page);
  await tool(page, 'Camera').click();
  await page.getByRole('button', { name: 'Edit script' }).click();
  await page.getByRole('textbox', { name: 'Script' }).fill(Array.from({ length: 30 }, (_, i) => `Line number ${i + 1} of the script.`).join('\n'));
  const prompter = page.getByLabel('Teleprompter');
  await expect(prompter).toBeVisible(); // not hidden behind the editor any more
  await page.getByRole('slider', { name: 'Text size' }).fill('40');
  await expect.poll(() => prompter.evaluate((el) => getComputedStyle(el).fontSize)).toBe('40px');
  await expect(page.getByRole('button', { name: 'Start recording' })).toBeEnabled({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Test the speed' }).click();
  await expect.poll(() => prompter.evaluate((el) => el.scrollTop)).toBeGreaterThan(30);
  await page.getByRole('button', { name: 'Stop the test' }).click();
  await expect.poll(() => prompter.evaluate((el) => el.scrollTop)).toBe(0);
});

test('reel in one tap: from the home card to a shorter reel with captions, title, zooms and music; undo all', async ({ page }, info) => {
  test.setTimeout(400_000);
  await page.goto('./'); // Russian speech under the English interface: the language is detected from the speech
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Reel in 1 tap/ }).click();
  await (await chooser).setFiles(fx('reel_ru.mp4')); // 18.7 s: 1.5 s of silence, long pauses, "эээ", a repeat
  const progress = sampleProgress(page, '.reel-done');
  const done = page.locator('.reel-done');
  await expect(done).toBeVisible({ timeout: 300_000 }); // started by itself
  expectHonestProgress(await progress);
  await expect(done).toContainText('0:18');
  await expect(done).toContainText(/Pauses removed: \d+/);
  const main = page.locator('.tl-row.main .clip');
  expect(await main.count()).toBeGreaterThan(2); // cut into pieces
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  await expect(page.locator('.tl-row .clip-text')).toHaveCount(1); // the hook title
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1); // music
  const shorter = Number((await done.locator('.reel-length b').nth(1).textContent())!.split(':')[1]);
  expect(shorter).toBeLessThan(15);
  // The captions' tail after the last word ends with the video: no picture-less seconds at the end.
  const right = async (l: ReturnType<Page['locator']>) => { const b = (await l.boundingBox())!; return b.x + b.width; };
  expect(await right(page.locator('.clip-caption'))).toBeLessThanOrEqual(await right(main.last()) + 1);
  const lang = done.getByRole('combobox', { name: 'Speech language' });
  await expect(lang).toHaveValue('russian');
  await expect(done).toContainText('found by Kadr');
  // Another language redoes the reel in it, once: the saved options keep "Auto".
  await lang.selectOption('english');
  await expect(done).toBeVisible({ timeout: 300_000 });
  await expect(lang).toHaveValue('english');
  await expect(done).not.toContainText('found by Kadr');
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('kadr.reel') ?? '{}').language ?? '')).toBe('');
  // Undo all: back to the single untouched clip.
  await page.getByRole('button', { name: 'Undo all' }).click();
  await expect(main).toHaveCount(1);
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(0);
  // Again, then check it in the editor and in the exported file.
  await page.getByRole('button', { name: 'Make the reel' }).click();
  await expect(done).toBeVisible({ timeout: 300_000 });
  await page.getByRole('button', { name: 'Watch the reel' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause' }).click(); // it played from the start
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  await selectClip(page, main.nth(1));
  await tool(page, 'Transform').click();
  expect(Number(await page.getByRole('slider', { name: 'Scale' }).inputValue())).toBeCloseTo(1.12, 2); // jump zoom
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Close tools' }).click().catch(() => undefined);
  await selectClip(page, page.locator('.clip-caption'));
  await tool(page, 'Edit captions').click();
  const lines = (await page.locator('.caption-row input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value))).join(' ').toLowerCase();
  expect(lines).toContain('смонтировать');
  expect(lines).not.toMatch(/\bэ{2,}\b/);
  await page.getByRole('button', { name: 'Done' }).click();
  const pr = await probe(await exportAs(page, info, 'Video', 'Export video'));
  expect(Number(pr.format.duration)).toBeLessThan(15);
  expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
});

// ---------- v1.1: share target and task pages (docs/08 B, C) ----------

test('share to Kadr (Android): a shared video lands on the timeline of a new project; the share cache is emptied', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Web Share Target is Android Chrome only');
  await page.goto('./');
  // The installed service worker (with share-target.js) must control the page, as in the installed PWA.
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => { await page.reload(); return page.evaluate(() => !!navigator.serviceWorker.controller); }).toBe(true);
  // What Android does on "Share → Kadr": a multipart POST navigation to the manifest's share_target action.
  await page.evaluate(() => {
    const f = Object.assign(document.createElement('form'), { method: 'POST', action: 'share-target', enctype: 'multipart/form-data' });
    f.innerHTML = '<input type="file" name="media" id="shared-media" multiple>';
    document.body.append(f);
  });
  await page.setInputFiles('#shared-media', fx('portrait.mp4'));
  await page.evaluate(() => (document.querySelector('form[action="share-target"]') as HTMLFormElement).submit());
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 30_000 });
  expect(new URL(page.url()).search).toBe('');
  expect(page.url()).toMatch(/#\/p\//);
  expect(await page.evaluate(async () => (await (await caches.open('kadr-share')).keys()).length)).toBe(0);
});

test('task pages: a static page leads into Kadr with the task banner, and the picked video opens in the right tool', async ({ page }) => {
  await page.goto('./en/add-captions-to-video/');
  await expect(page).toHaveTitle(/captions/i);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  expect(await page.locator('script:not([type="application/ld+json"])').count()).toBe(0);
  await page.getByRole('link', { name: 'Open Kadr' }).click();
  await expect(page).toHaveURL(/#\/start\/captions$/);
  const banner = page.locator('.task-banner');
  await expect(banner).toContainText('Add captions to a video');
  const chooser = page.waitForEvent('filechooser');
  await banner.getByRole('button', { name: 'Choose a video' }).click();
  await (await chooser).setFiles(fx('speech_en.mp4'));
  await expect(page.locator('.sheet')).toContainText('Auto captions');
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  // A clip tool: the clip is selected and its sheet is open.
  await page.goto('./#/start/pauses');
  const chooser2 = page.waitForEvent('filechooser');
  await page.locator('.task-banner').getByRole('button', { name: 'Choose a video' }).click();
  await (await chooser2).setFiles(fx('speech_en.mp4'));
  await expect(page.locator('.sheet')).toContainText('Remove pauses');
  await expect(page.locator('.tl-row.main .clip.sel')).toHaveCount(1);
});

// ---------- v1.2: captions from my text (docs/09 S1) ----------

test('captions from my text: every word is the text\'s own, timed by the speech, and editable', async ({ page }) => {
  test.setTimeout(400_000);
  const script = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'eval', 'texts.json'), 'utf8')) as Record<string, string>).script_ru;
  await newProject(page);
  await importFiles(page, 'Media', ['script_verbatim.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('radio', { name: 'Recognize speech' })).toHaveAttribute('aria-checked', 'true'); // no text yet
  await page.getByRole('radio', { name: 'From my text' }).click();
  await expect(page.getByRole('button', { name: 'Create captions' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Your text' }).fill(script);
  await page.getByRole('combobox', { name: 'Language' }).selectOption('russian');
  const progress = sampleProgress(page, '.clip-caption');
  await page.getByRole('button', { name: 'Create captions' }).click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 300_000 });
  expectHonestProgress(await progress); // it used to fill on download and drop back to 0 (v1.2 Q4)
  if (!(await page.locator('.caption-row').first().isVisible())) await tool(page, 'Edit captions').click();
  const lines = await page.locator('.caption-row input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(lines.join(' ')).toBe(script); // punctuation, capitals, "15" and "слова-паразиты" exactly as written
  // Timed by the speech: the captions end with the voice, not stretched over the clip.
  const right = async (l: ReturnType<Page['locator']>) => { const b = (await l.boundingBox())!; return b.x + b.width; };
  expect(await right(page.locator('.clip-caption'))).toBeLessThanOrEqual(await right(page.locator('.tl-row.main .clip').last()) + 1);
});


test('teleprompter → reel in one tap: the reel\'s captions are the script, word for word', async ({ page }) => {
  test.setTimeout(400_000);
  const script = (JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'eval', 'texts.json'), 'utf8')) as Record<string, string>).script_ru;
  // A camera whose microphone reads the script (the TTS recording), starting when the recording starts.
  await page.route('**/__e2e/speech.mp4', (r) => r.fulfill({ path: fx('script_verbatim.mp4'), contentType: 'video/mp4' }));
  await page.addInitScript(() => {
    localStorage.setItem('kadr.reel', JSON.stringify({ music: null }));
    const speech = new Audio('/__e2e/speech.mp4');
    MediaDevices.prototype.getUserMedia = async function () {
      const c = Object.assign(document.createElement('canvas'), { width: 360, height: 640 });
      const g = c.getContext('2d')!;
      setInterval(() => { g.fillStyle = '#345'; g.fillRect(0, 0, 360, 640); }, 33);
      const ctx = new AudioContext();
      const dest = ctx.createMediaStreamDestination();
      ctx.createMediaElementSource(speech).connect(dest);
      return new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    };
    const start = MediaRecorder.prototype.start;
    MediaRecorder.prototype.start = function (...a: Parameters<MediaRecorder['start']>) { speech.currentTime = 0; void speech.play(); return start.apply(this, a); };
  });
  await newProject(page);
  await tool(page, 'Camera').click();
  await page.getByRole('button', { name: 'Edit script' }).click();
  await page.getByRole('textbox', { name: 'Script' }).fill(script);
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(21_000); // the reading is 19.6 s
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(1, { timeout: 30_000 });
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Reel in 1 tap').click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('russian');
  await page.getByRole('button', { name: 'Make the reel' }).click();
  const done = page.locator('.reel-done');
  await expect(done).toBeVisible({ timeout: 300_000 });
  await expect(done).toContainText('Captions from your text');
  await page.getByRole('button', { name: 'Watch the reel' }).click();
  await page.getByRole('button', { name: 'Pause' }).click().catch(() => undefined);
  await selectClip(page, page.locator('.clip-caption'));
  await tool(page, 'Edit captions').click();
  const lines = await page.locator('.caption-row input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
  expect(lines.join(' ')).toBe(script);
});

test('a sheet closes with a swipe down on its header; a small drag or a tap on the header keeps it', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  const head = page.locator('.sheet-head');
  const swipe = async (dy: number) => {
    const b = (await head.boundingBox())!;
    await page.mouse.move(b.x + 40, b.y + 10);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) { await page.mouse.move(b.x + 40, b.y + 10 + (dy * i) / 8); await page.waitForTimeout(30); }
    await page.mouse.up();
  };
  await tool(page, 'Adjust').click();
  await expect(sheet(page)).toBeVisible();
  await swipe(20);
  await page.waitForTimeout(300);
  await expect(sheet(page), 'a small drag springs back').toBeVisible();
  await head.locator('h2').click();
  await expect(sheet(page), 'a tap on the title is not a swipe').toBeVisible();
  await swipe(220);
  await expect(sheet(page), 'a swipe down closes it').toHaveCount(0);
});

// ---------- v1.2: voice effects (docs/09 V1) ----------

/** Mono 48 kHz samples of an exported sound. */
async function samples(file: string): Promise<Float32Array> {
  const { execFileSync } = await import('node:child_process');
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 256 << 20 });
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
/** Mean level in dB of a sound, optionally above `highpass` Hz (ffmpeg volumedetect). */
async function meanDb(file: string, highpass?: number): Promise<number> {
  const { spawnSync } = await import('node:child_process');
  // 8th order: a softer filter lets the band just below the cutoff leak into "above" (the 4 kHz meter read 18 dB, not 30).
  const af = highpass ? `${Array(4).fill(`highpass=f=${highpass}:poles=2`).join(',')},volumedetect` : 'volumedetect';
  const out = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', af, '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  return Number(/mean_volume: (-?[\d.]+) dB/.exec(out)![1]);
}
/** First moment the sound gets louder than -30 dBFS over 10 ms. */
function onset(x: Float32Array): number {
  const w = 480;
  for (let i = 0; i + w < x.length; i += w / 2) {
    let s = 0;
    for (let k = i; k < i + w; k++) s += x[k] * x[k];
    if (Math.sqrt(s / w) > 0.0316) return i / 48000;
  }
  return Infinity;
}
async function pickVoice(page: Page, clip: ReturnType<Page['locator']>, name: string) {
  await selectClip(page, clip);
  await tool(page, 'Voice').click();
  await sheet(page).getByRole('radio', { name, exact: true }).click();
  await expect(sheet(page).getByRole('radio', { name, exact: true })).toHaveAttribute('aria-checked', 'true', { timeout: 60_000 }); // processed
  await page.getByRole('button', { name: 'Done' }).click();
}

test('voice effects: telephone cuts the highs, chipmunk raises the pitch in sync, undo restores', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Audio', ['noisy_en.m4a']); // speech plus broadband noise: energy far above 4 kHz
  const audio = page.locator('.tl-row.audio .clip').first();
  await expect(audio).toHaveCount(1);
  // Each export reuses the file name: measure right away.
  const highs = async (f: string) => (await meanDb(f, 4000)) - (await meanDb(f));
  const plain = await highs(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  await pickVoice(page, audio, 'Telephone');
  await expect(tool(page, 'Voice')).toHaveAttribute('aria-pressed', 'true');
  const phone = await highs(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  expect(plain - phone, 'energy above 4 kHz, relative to the whole').toBeGreaterThan(20);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(tool(page, 'Voice')).toHaveAttribute('aria-pressed', 'false');
  expect(Math.abs((await highs(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }))) - plain), 'undo restores').toBeLessThan(1.5);

  // Chipmunk on a 220 Hz tone: the pitch goes up 1.4–2×.
  await selectClip(page, audio);
  await tool(page, 'Delete').click();
  await importFiles(page, 'Audio', ['music.m4a']);
  await expect(audio).toHaveCount(1);
  await pickVoice(page, audio, 'Chipmunk');
  const x = await samples(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  let crossings = 0;
  for (let i = 1; i < x.length; i++) if ((x[i - 1] < 0) !== (x[i] < 0)) crossings++;
  const ratio = crossings / 2 / (x.length / 48000) / 220;
  expect(ratio).toBeGreaterThan(1.4);
  expect(ratio).toBeLessThan(2);
});

test('voice effects keep lip sync: speech starts within 20 ms of the original', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['reel_ru.mp4']); // 1.5 s of silence, then speech
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  const t0 = onset(await samples(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false })));
  for (const name of ['Chipmunk', 'Deep', 'Robot']) {
    await pickVoice(page, clip, name);
    const t = onset(await samples(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false })));
    expect(Math.abs(t - t0), `${name}: ${t0.toFixed(3)} → ${t.toFixed(3)} s`).toBeLessThan(0.02);
  }
  // Noise reduction and voice enhance (RNNoise works in 10 ms frames) keep the timing too.
  await pickVoice(page, clip, 'Original');
  for (const name of ['Reduce background noise', 'Enhance voice']) {
    await selectClip(page, clip);
    await tool(page, 'Volume').click();
    await page.getByRole('switch', { name }).check();
    await expect(page.getByRole('switch', { name })).toBeChecked({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    const t = onset(await samples(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false })));
    expect(Math.abs(t - t0), `${name}: ${t0.toFixed(3)} → ${t.toFixed(3)} s`).toBeLessThan(0.02);
    await page.getByRole('button', { name: 'Undo' }).click();
  }
  // The same pitch shifter keeps the natural voice at 1.25× (on by default): speech starts at t0 / 1.25.
  await selectClip(page, clip);
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '1.25×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const fast = onset(await samples(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false })));
  expect(Math.abs(fast - t0 / 1.25), `1.25×: ${(t0 / 1.25).toFixed(3)} expected, ${fast.toFixed(3)} s`).toBeLessThan(0.02);
});


/** Sound minus picture, ms, for each flash+beep pair of fixtures/avsync.mp4 as found in an exported file. */
async function avOffsets(file: string): Promise<number[]> {
  const { spawnSync } = await import('node:child_process');
  const v = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;
  const frames = [...v.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*YAVG=([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const flashes: number[] = [];
  frames.forEach(([t, y], i) => { if (y > 128 && (i === 0 || frames[i - 1][1] <= 128)) flashes.push(t); });
  const a = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.1', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const starts = [...a.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  expect(flashes.length, 'two flashes').toBe(2);
  // The beep that belongs to a flash is the first sound after (or just before) it; later ones are echoes.
  return flashes.map((f) => {
    const b = starts.find((t) => t > f - 0.2);
    expect(b, `a beep near ${f} s`).toBeDefined();
    return Math.round((b! - f) * 1000);
  });
}

test('export keeps the sound in sync with the picture, also through processed sound', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['avsync.mp4']); // white frames and beeps together at 1.0 s and 2.5 s
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  // Even loudness off: on near-silence it would lift the codec noise into "beeps".
  const plain = await avOffsets(await exportAs(page, info, 'Video', 'Export video', { loudness: false }));
  await pickVoice(page, clip, 'Echo'); // the dry sound passes untouched: any shift is the pipeline's
  const echo = await avOffsets(await exportAs(page, info, 'Video', 'Export video', { loudness: false }));
  fs.writeFileSync(test.info().outputPath('offsets.txt'), `plain ${plain} ms\necho ${echo} ms\n`);
  console.log(`A/V offsets (${test.info().project.name}): plain ${plain} ms, echo ${echo} ms`);
  for (const o of [...plain, ...echo]) expect(Math.abs(o), `sound vs picture: plain ${plain}, echo ${echo} ms`).toBeLessThanOrEqual(20);
});

/** Reads the open project as stored in the app's IndexedDB; `age` rewrites it as v1.1 stored processed sound. */
const storedProject = (page: Page, age = false) => page.evaluate(async (ageIt) => {
  type P = { tracks: { clips: { kind: string; audioKey?: string; audioAssetId?: string }[] }[]; assets: Record<string, { derived?: { sync?: number } }> };
  const id = /#\/p\/([\w-]+)/.exec(location.hash)![1];
  const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const p = await new Promise<P>((res) => { const r = db.transaction('kv').objectStore('kv').get(`p:${id}`); r.onsuccess = () => res(r.result as P); });
  if (ageIt) { // the old key and a cache without the sync mark (the CSP rightly forbids eval, so this is spelled out)
    for (const t of p.tracks) for (const c of t.clips) if (c.audioKey) c.audioKey = c.audioKey.replace(/~\d+$/, '');
    for (const a of Object.values(p.assets)) if (a.derived) delete a.derived.sync;
    await new Promise<void>((res) => { const tx = db.transaction('kv', 'readwrite'); tx.objectStore('kv').put(p, `p:${id}`); tx.oncomplete = () => res(); });
  }
  db.close();
  return p;
}, age);

test('an older project\'s processed sound (44 ms late before v1.2.1) is rebuilt in sync when it opens', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['reel_ru.mp4']);
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  const t0 = onset(await samples(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false })));
  await selectClip(page, clip);
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Reduce background noise' }).check();
  await expect(page.getByRole('switch', { name: 'Reduce background noise' })).toBeChecked({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  const soundOf = async () => (await storedProject(page)).tracks.flatMap((t) => t.clips).find((c) => c.kind === 'video')!;
  await expect.poll(async () => (await soundOf()).audioKey, { timeout: 20_000 }).toBe('d~2');
  const fresh = (await soundOf()).audioAssetId;
  await storedProject(page, true); // as v1.1 stored it
  await page.reload();
  await expect.poll(async () => (await soundOf()).audioKey, { timeout: 60_000 }).toBe('d~2'); // rebuilt on open
  expect((await soundOf()).audioAssetId, 'a new sound, not the late cache').not.toBe(fresh);
  const t = onset(await samples(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false })));
  expect(Math.abs(t - t0), `${t0.toFixed(3)} → ${t.toFixed(3)} s`).toBeLessThan(0.02);
});

test('iPhone: the first video import explains how to get originals (picker format "Current"), once', async ({ page }, info) => {
  await newProject(page);
  const tip = page.locator('.toast', { hasText: 'Format: Current' });
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  if (info.project.name !== 'iphone-webkit') { await expect(tip).toHaveCount(0); return; } // only iOS re-encodes
  await expect(tip).toBeVisible();
  await tip.click(); // dismiss
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Media', ['portrait.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await expect(tip).toHaveCount(0);
});

test('iPhone HDR original (HEVC 10-bit HLG, as "Format: Current" hands it over) imports and exports', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'Playwright\'s Chromium has no HEVC decoder; Android Chrome uses the platform one');
  test.skip(!fs.existsSync(fx('iphone_hdr.mov')), 'needs ffmpeg with libx265 (npm run fixtures)');
  await newProject(page);
  await importFiles(page, 'Media', ['iphone_hdr.mov']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const duration = await exportAndProbe(page, info);
  expect(Math.abs(duration - 4)).toBeLessThan(0.1);
  // The picture made it through 10-bit HLG decoding: the exported frame has the bars, not black.
  const { execFileSync } = await import('node:child_process');
  const file = info.outputPath('Project 1.mp4');
  const stats = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2', '-i', file, '-frames:v', '1', '-vf', 'signalstats,metadata=print:file=-', '-f', 'null', '-']).toString();
  expect(Number(/YAVG=([\d.]+)/.exec(stats)?.[1])).toBeGreaterThan(30);
  expect(Number(/SATMAX=([\d.]+)/.exec(stats)?.[1])).toBeGreaterThan(60);
});

test('the home footer shows the version from package.json', async ({ page }) => {
  const { version } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string };
  await page.goto('./');
  await expect(page.locator('.home-foot')).toContainText(`Kadr v${version}`);
});

// ---------- v1.3: captions in one tap on every video (owner's feedback) ----------

test('Captions in one tap from a selected video caption every clip; a second tap edits, "Create again" replaces', async ({ page }) => {
  test.setTimeout(400_000);
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4', 'speech_en.mp4']);
  const clips = page.locator('.tl-row.main .clip');
  await expect(clips).toHaveCount(2);
  await tool(page, 'Captions').click(); // straight from the selected clip's tools
  const caption = page.locator('.clip-caption');
  await expect(caption).toHaveCount(1, { timeout: 300_000 });
  const c = (await caption.boundingBox())!, a = (await clips.nth(0).boundingBox())!, b = (await clips.nth(1).boundingBox())!;
  expect(c.x).toBeLessThan(a.x + a.width / 2); // the first video's speech…
  expect(c.x + c.width).toBeGreaterThan(b.x + b.width / 3); // …and the second one's
  await page.getByRole('button', { name: 'Done' }).click();
  await selectClip(page, clips.nth(0));
  await tool(page, 'Captions').click(); // captions exist: open them, do not double them
  await expect(page.getByRole('button', { name: 'Save as .srt' })).toBeVisible();
  await page.getByRole('button', { name: 'Create again…' }).click();
  await page.getByRole('button', { name: 'Create captions' }).click();
  await expect(page.getByRole('button', { name: 'Save as .srt' })).toBeVisible({ timeout: 300_000 });
  await expect(caption).toHaveCount(1); // replaced, not added
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(caption).toHaveCount(1); // one undo brings back the first set, still one
});

// ---------- v1.3: quick export (owner's feedback) ----------

test('quick export: one tap on Export renders with the last settings and saves; Settings stops it', async ({ page }, info) => {
  test.setTimeout(180_000);
  await newProject(page);
  await page.evaluate(() => localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: true, resolution: 720, quality: 'standard', loudness: true })));
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  // "Settings" while it renders: back to the settings, nothing saved.
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible();
  await expect(page.getByRole('switch', { name: /Quick export/ })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
  // One tap: no settings on the way. Android and desktop download by themselves; iPhone gets one Save button.
  const dl = page.waitForEvent('download', { timeout: 120_000 });
  await page.getByRole('button', { name: 'Export' }).first().click();
  if (info.project.name === 'iphone-webkit') await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 120_000 });
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  const pr = await probe(file);
  const v = pr.streams.find((s) => s.codec_type === 'video')!;
  expect(Math.min(v.width!, v.height!)).toBe(720); // the saved settings, not the defaults
});

test('iPhone 16+ video: the playable stereo track is used, not the 4-channel one before it (captions, export)', async ({ page }, info) => {
  await newProject(page);
  await importFiles(page, 'Media', ['iphone_spatial.mov']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  // The whole soundtrack goes through the same decoding as captions; it used to fail or come out silent.
  const db = await meanDb(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  expect(db).toBeGreaterThan(-30); // the 1 kHz tone of the AAC track
});

// ---------- v1.3.1: the browser refuses to decode a sound (owner's "Unsupported configuration") ----------

/**
 * Chromium's AudioDecoder.isConfigSupported() does not check the description, so a track can pass it and fail in
 * configure(). This makes every audio configure() fail that way, while isConfigSupported() still says yes.
 */
async function refuseAudioDecoder(page: Page) {
  await page.addInitScript(() => {
    const Base = window.AudioDecoder;
    if (!Base) return;
    window.AudioDecoder = class extends Base {
      configure(config: AudioDecoderConfig) { super.configure({ ...config, codec: 'mp4a.refused' }); }
    };
  });
}

test('the browser refuses WebCodecs audio: captions are still made, from the right words', async ({ page }) => {
  test.setTimeout(300_000);
  await refuseAudioDecoder(page);
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 240_000 });
  if (!(await sheet(page).isVisible())) await tool(page, 'Edit captions').click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as .srt' }).click();
  const srt = (await fs.promises.readFile(await (await dl).path(), 'utf8')).toLowerCase();
  for (const w of ['welcome', 'editor', 'phone', 'device']) expect(srt).toContain(w);
});

test('the browser refuses WebCodecs audio: export keeps the sound, in sync with the picture', async ({ page }, info) => {
  test.setTimeout(300_000);
  await refuseAudioDecoder(page);
  await newProject(page);
  await importFiles(page, 'Media', ['avsync.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const offsets = await avOffsets(await exportAs(page, info, 'Video', 'Export video', { loudness: false }));
  console.log(`A/V offsets with native decoding (${test.info().project.name}): ${offsets} ms`);
  for (const o of offsets) expect(Math.abs(o), `sound vs picture: ${offsets} ms`).toBeLessThanOrEqual(20);
});

test('a sound no decoder in the browser can read is left out of the captions, by name; the rest is captioned', async ({ page }) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4', 'landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  // From now on neither WebCodecs nor decodeAudioData reads 44.1 kHz sound: landscape.mp4 (speech_en.mp4 is 48 kHz).
  await page.evaluate(() => {
    const Base = window.AudioDecoder;
    window.AudioDecoder = class extends Base {
      configure(c: AudioDecoderConfig) { super.configure(c.sampleRate === 44100 ? { ...c, codec: 'mp4a.refused' } : c); }
    };
    const decode = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, data: ArrayBuffer) {
      return this.sampleRate === 44100 ? Promise.reject(new DOMException('refused', 'EncodingError')) : decode.call(this, data);
    } as typeof decode;
  });
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 240_000 });
  await expect(page.getByText(/Captions are made without “landscape/)).toBeVisible();
});

// ---------- v1.4: GigaAM for Russian speech (docs/10 C1) ----------

/** Captions with the "Russian speech" model and Auto language; returns the .srt text in lower case. */
async function captionsWithRussianModel(page: Page, file: string): Promise<string> {
  await newProject(page);
  await importFiles(page, 'Media', [file]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click();
  await page.getByRole('button', { name: 'Settings' }).click(); // the tool starts with the defaults (v1.3)
  await expect(page.getByRole('combobox', { name: 'Language' })).toHaveValue('');
  await page.locator('.sheet .chip', { hasText: /^Russian speech, 225 MB$/ }).click();
  await page.getByRole('button', { name: 'Create captions' }).click();
  await expect(page.getByRole('button', { name: 'Save as .srt' })).toBeVisible({ timeout: 400_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as .srt' }).click();
  return (await fs.promises.readFile(await (await dl).path(), 'utf8')).toLowerCase();
}

test('Russian interface, one tap: GigaAM captions Russian speech with punctuation and never downloads Whisper', async ({ page }) => {
  test.setTimeout(500_000);
  await page.addInitScript(() => localStorage.setItem('kadr.locale', 'ru')); // runs after the English default
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Медиа', ['speech_ru.mp4']); // «Привет! Это видеоредактор Кадр. Всё работает прямо на телефоне.»
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click(); // one tap, the defaults: "Russian speech", Auto language
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  if (!(await sheet(page).isVisible())) await tool(page, 'Субтитры').click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Сохранить .srt' }).click();
  const srt = (await fs.promises.readFile(await (await dl).path(), 'utf8')).toLowerCase();
  for (const w of ['привет', 'видеоредактор', 'работает', 'телефоне']) expect(srt).toContain(w);
  expect(srt).toMatch(/[.,!?]/); // GigaAM writes punctuation
  // GigaAM confirmed the language itself: Whisper (77 MB more) was never downloaded.
  const cached = await page.evaluate(async () => (await Promise.all((await caches.keys()).map(async (n) => (await (await caches.open(n)).keys()).map((r) => r.url)))).flat());
  expect(cached.some((u) => u.includes('gigaam'))).toBe(true);
  expect(cached.filter((u) => u.includes('whisper'))).toEqual([]);
});

test('"Russian speech" on English speech falls back to Whisper: English words, not Cyrillic guesses', async ({ page }) => {
  test.setTimeout(600_000);
  const srt = await captionsWithRussianModel(page, 'speech_en.mp4');
  for (const w of ['welcome', 'editor', 'phone', 'device']) expect(srt).toContain(w);
  expect(srt).not.toMatch(/[а-я]/);
});

test('captions listen to the voice, not the library music under it: live speech stays as accurate as without music', async ({ page }) => {
  test.setTimeout(600_000);
  await newProject(page);
  await importFiles(page, 'Media', ['eval_ru_live.mp4']); // 87 s of live Russian speech recorded on phones
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Music').click();
  await page.getByRole('radiogroup', { name: 'Mood' }).getByRole('radio', { name: 'Energetic' }).click();
  await page.locator('.music-row', { hasText: 'BPM' }).first().getByRole('button', { name: 'Add', exact: false }).click();
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click();
  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('combobox', { name: 'Language' }).selectOption('russian');
  await page.locator('.sheet .chip', { hasText: /^Russian speech, 225 MB$/ }).click();
  await page.getByRole('button', { name: 'Create captions' }).click();
  await expect(page.getByRole('button', { name: 'Save as .srt' })).toBeVisible({ timeout: 400_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save as .srt' }).click();
  const srt = await fs.promises.readFile(await (await dl).path(), 'utf8');
  const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const ref = norm(JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'eval', 'texts.json'), 'utf8')).ru_live as string);
  const hyp = norm(srt.split('\n').filter((l) => l && !/^\d+$/.test(l) && !l.includes('-->')).join(' '));
  const d = Array.from({ length: ref.length + 1 }, (_, i) => Array.from({ length: hyp.length + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= ref.length; i++) for (let j = 1; j <= hyp.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
  const wer = d[ref.length][hyp.length] / ref.length;
  console.log(`WER with library music on the timeline (${test.info().project.name}): ${(wer * 100).toFixed(1)}%`);
  expect(wer).toBeLessThanOrEqual(0.12); // 7.3% without music (docs/10)
});

test('GigaAM with its lenient speech detection invents no words over music without a voice', async ({ page }) => {
  test.setTimeout(500_000);
  await page.addInitScript(() => localStorage.setItem('kadr.locale', 'ru'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Звук', ['../public/music/tracks/holiznacc0-2nd-dimension-eda08f.m4a']); // real music, the bed under the eval samples
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1, { timeout: 60_000 }); // a 136 s track: slower under a full run
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click();
  await expect(page.getByText('Речь в видео не найдена')).toBeVisible({ timeout: 400_000 });
  await expect(page.locator('.clip-caption')).toHaveCount(0);
});

// ---------- QA (docs/11): invariants across features ----------

/** Grayscale 270×480 of a picture, or of a video's frame number `n` (exact: `-ss` can land a frame off). */
async function grayAt(file: string, n?: number): Promise<Buffer> {
  const { execFileSync } = await import('node:child_process');
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=270:480`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
}
const meanAbsDiff = (a: Buffer, b: Buffer) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };

/** The preview canvas as a picture, after the playhead settles at `t` (60 px per second on the timeline). */
async function previewAt(page: Page, info: { outputPath: (n: string) => string }, t: number): Promise<string> {
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, t * 60);
  await page.waitForTimeout(1000);
  const canvas = page.locator('.preview-canvas');
  const whole = info.outputPath(`preview-${t}-element.png`);
  await canvas.screenshot({ path: whole, style: '.toast { visibility: hidden !important; }' }); // a tip lying over the preview is not in the export
  // The element screenshot spans whole CSS pixels around the canvas, whose edges are fractional: up to 1.4 px of the page
  // and of the 1 px outline came along, a dark-and-grey frame that read as a colour cast. Keep only the canvas itself.
  const b = await canvas.evaluate((c) => { const r = c.getBoundingClientRect(); return [r.x - Math.floor(r.x), r.y - Math.floor(r.y), r.width, r.height].map((v) => v * devicePixelRatio); });
  const [x, y, w, h] = b.map(Math.round);
  const shot = info.outputPath(`preview-${t}.png`);
  const { execFileSync } = await import('node:child_process');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', whole, '-vf', `crop=w='min(${w},iw-${x})':h='min(${h},ih-${y})':x=${x}:y=${y}`, shot]);
  return shot;
}

test('WYSIWYG: the preview shows what the photo and video exports contain — title, mid-transition, filter', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'Try a sample' }).click(); // two clips, a slide, a "vivid" filter, a popping title
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.keyboard.press('Escape'); // nothing selected: no handles over the picture
  const video = await exportAs(page, info, 'Video', 'Export video');
  const rows: string[] = [];
  // Frame times at 30 fps: the title over clip 1, the middle of the 0.6 s slide (3.4–4.0 s), clip 2 with its filter.
  for (const t of [1.5, 3.7, 5.5]) {
    const preview = await grayAt(await previewAt(page, info, t));
    const photo = meanAbsDiff(preview, await grayAt(await exportAs(page, info, 'Photo', 'Save photo')));
    const frame = meanAbsDiff(preview, await grayAt(video, Math.round(t * 30)));
    rows.push(`${t} s (playhead ${await time(page)}): preview vs photo ${photo.toFixed(2)}, vs video ${frame.toFixed(2)}`);
    // Mean |difference| of 0–255 grey at 270×480. Matching frames measured ≤ 1.4 (photo) and ≤ 3 (video, "Small file"
    // compression); one frame off mid-slide is ~13–15; grey blacks from a mislabelled range (v1.4.3) were 4–12.
    expect(photo, `photo at ${t} s`).toBeLessThan(4);
    expect(frame, `video frame at ${t} s`).toBeLessThan(6);
  }
  fs.writeFileSync(info.outputPath('wysiwyg.txt'), rows.join('\n'));
  console.log(`WYSIWYG (${info.project.name}):\n${rows.join('\n')}`);
});

test('edits survive closing the page right after them (saved on pagehide, not only after the autosave pause)', async ({ page }) => {
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  const clips = page.locator('.tl-row.main .clip');
  await expect(clips).toHaveCount(1);
  await page.waitForTimeout(1500); // the import itself is saved
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 120; });
  await expect.poll(() => time(page)).toBe('0:02.0');
  await tool(page, 'Split').click();
  await expect(clips).toHaveCount(2);
  await page.reload(); // at once: inside the 0.6 s autosave pause
  await expect(clips).toHaveCount(2);
});

test('hostile files: each one is refused by name, nothing breaks, the good file in the same batch imports and exports', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['hostile_random.mp4', 'hostile_text.mp4', 'hostile_empty.mp4', 'landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.join('\n')), { timeout: 20_000 })
    .toContain('hostile_empty');
  await expect(page.locator('.toast.error')).toHaveCount(0, { timeout: 30_000 }); // shown one after another
  const toasts = await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
  console.log(`hostile toasts (${info.project.name}):\n${toasts.join('\n')}`);
  for (const n of ['hostile_random.mp4', 'hostile_text.mp4', 'hostile_empty.mp4']) expect(toasts.join('\n')).toContain(n);
  const pr = await probe(await exportAs(page, info, 'Video', 'Export video'));
  expect(pr.streams.some((x) => x.codec_type === 'video')).toBe(true);
});

test('a video cut short (header says 6 s, data stops halfway): no hang, no crash, a clear message or a working clip', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['hostile_half.mp4']);
  // Either refused at import, or imported: then the preview and the export must finish, not hang.
  await page.waitForTimeout(3000);
  const imported = await page.locator('.tl-row.main .clip').count();
  if (imported) {
    await page.getByRole('button', { name: 'Close tools' }).click();
    await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 5 * 60; }); // past the end of the data
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Export' }).first().click();
    await page.getByRole('radio', { name: 'Video', exact: true }).click();
    await page.getByRole('button', { name: 'Export video' }).click();
    await expect(page.getByText(/Ready: .* MB/).or(page.locator('.toast.error'))).toBeVisible({ timeout: 120_000 });
  }
  const toasts = await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
  console.log(`cut-short video (${info.project.name}): imported ${imported}, toasts: ${toasts.join(' | ') || 'none'}`);
  if (!imported) expect(toasts.join('\n')).toContain('hostile_half.mp4');
});

test('a 48 MP photo (iPhone "48MP") imports, previews and exports the same picture', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['photo_48mp.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  const preview = await grayAt(await previewAt(page, info, 1));
  const d = meanAbsDiff(preview, await grayAt(await exportAs(page, info, 'Photo', 'Save photo')));
  console.log(`48 MP photo (${info.project.name}): preview vs photo ${d.toFixed(2)}`);
  expect(d).toBeLessThan(8);
});


/** What breaks the 375 px layout or assistive tech in the open screen: page overflow, nameless controls, small targets. */
async function layoutAudit(page: Page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const overflow = document.scrollingElement!.scrollWidth - vw;
    const controls = [...document.querySelectorAll<HTMLElement>('button, [role="button"], [role="radio"], [role="switch"], input, select, a[href]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; });
    const name = (el: HTMLElement) => (el.getAttribute('aria-label') ?? el.getAttribute('title') ?? (el as HTMLInputElement).labels?.[0]?.textContent ?? el.textContent ?? '').trim();
    const nameless = controls.filter((el) => !name(el) && !el.closest('[aria-hidden="true"]')).map((el) => el.outerHTML.slice(0, 90));
    const small = controls.filter((el) => { const r = el.getBoundingClientRect(); return (r.width < 44 || r.height < 44) && el.tagName !== 'INPUT'; })
      .map((el) => `${name(el).slice(0, 30) || el.className} ${Math.round(el.getBoundingClientRect().width)}×${Math.round(el.getBoundingClientRect().height)}`);
    // Content past the screen edge, unless it sits in a row meant to scroll sideways (chips, the timeline).
    const inScroller = (el: HTMLElement) => {
      for (let a = el.parentElement; a; a = a.parentElement) {
        const ox = getComputedStyle(a).overflowX;
        if ((ox === 'auto' || ox === 'scroll') && a.scrollWidth > a.clientWidth + 1 && !a.classList.contains('sheet-body')) return true;
      }
      return false;
    };
    const offscreen = controls.filter((el) => { const r = el.getBoundingClientRect(); return (r.right > vw + 1 || r.left < -1) && !inScroller(el); })
      .map((el) => `${name(el).slice(0, 30) || el.className} at ${Math.round(el.getBoundingClientRect().left)}…${Math.round(el.getBoundingClientRect().right)}`);
    const body = document.querySelector<HTMLElement>('.sheet-body');
    const sheetScroll = body ? body.scrollWidth - body.clientWidth : 0;
    return { overflow, nameless, small, offscreen, sheetScroll };
  });
}

test('every tool at 375 px: no sideways scroll, every control has a name (small targets are listed)', async ({ page }, info) => {
  test.setTimeout(400_000);
  await page.setViewportSize({ width: 375, height: 812 });
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const report: string[] = [];
  const problems: string[] = [];
  const audit = async (where: string) => {
    const a = await layoutAudit(page);
    report.push(`## ${where}: overflow ${a.overflow}px, nameless ${a.nameless.length}, small ${a.small.length}\n${a.small.join('; ')}`);
    if (a.overflow > 0) problems.push(`${where}: page scrolls sideways by ${a.overflow}px`);
    if (a.sheetScroll > 1) problems.push(`${where}: the sheet scrolls sideways by ${a.sheetScroll}px`);
    for (const o of a.offscreen) problems.push(`${where}: off screen ${o}`);
    for (const n of a.nameless) problems.push(`${where}: control without a name ${n}`);
  };
  await audit('clip selected');
  // Tools that open a settings sheet (no file picker, camera, microphone or long processing): clip, then project.
  const SHEETS = ['Adjust', 'Filters', 'Effects', 'Crop', 'Transform', 'Mask', 'Chroma key', 'Speed', 'Volume', 'Voice', 'Text', 'Stickers', 'Music', 'Sounds', 'Canvas'];
  for (const scope of ['clip', 'project'] as const) {
    for (const name of SHEETS) {
      if (scope === 'clip' && !(await page.locator('.tl-row.main .clip.sel').count())) await page.locator('.tl-row.main .clip').first().click();
      if (scope === 'project' && (await page.locator('.tl-row.main .clip.sel').count())) await page.getByRole('button', { name: 'Close tools' }).click();
      const button = page.locator('.toolbar .tool', { hasText: new RegExp(`^${name}$`) });
      if (!(await button.count())) continue;
      await button.first().click();
      await expect(sheet(page), `${name} opens its sheet`).toBeVisible();
      await page.waitForTimeout(400);
      await audit(`${scope} › ${name}`);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(200);
    }
  }
  await page.getByRole('button', { name: 'Export' }).first().click();
  await audit('export sheet');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await audit('home');
  // The main action is a full touch target (it was 97×40 before v1.4.3).
  await page.locator('.project-open').first().click();
  const exp = (await page.getByRole('button', { name: 'Export' }).first().boundingBox())!;
  expect(Math.min(exp.width, exp.height)).toBeGreaterThanOrEqual(44);
  fs.writeFileSync(info.outputPath('layout-audit.md'), report.join('\n\n'));
  console.log(`layout audit (${info.project.name}): ${problems.length} problems\n${problems.join('\n')}`);
  expect(problems).toEqual([]);
});

/** Counts VideoFrames made on the page (constructed, decoded, cloned) and closed: `made - closed` are still open. */
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: { made: number; closed: number } };
    w.__frames = { made: 0, closed: 0 };
    const VF = window.VideoFrame;
    if (!VF) return;
    const closed = new WeakSet<VideoFrame>();
    const { close, clone } = VF.prototype;
    VF.prototype.close = function (this: VideoFrame) { if (!closed.has(this)) { closed.add(this); w.__frames.closed++; } close.call(this); };
    VF.prototype.clone = function (this: VideoFrame) { w.__frames.made++; return clone.call(this); };
    // A wrapper with the same prototype: `instanceof VideoFrame` stays true for frames the decoder makes (mediabunny checks it).
    const Counted = function (...a: ConstructorParameters<typeof VideoFrame>) { w.__frames.made++; return new VF(...a); } as unknown as typeof VideoFrame;
    Counted.prototype = VF.prototype;
    Object.setPrototypeOf(Counted, VF);
    window.VideoFrame = Counted;
    const VD = window.VideoDecoder;
    if (VD) window.VideoDecoder = class extends VD {
      constructor(init: VideoDecoderInit) { super({ ...init, output: (f) => { w.__frames.made++; init.output(f); } }); }
    };
  });
  return () => page.evaluate(() => (window as unknown as { __frames: { made: number; closed: number } }).__frames);
}

test('decoded frames are released: playing and two exports leave almost no VideoFrame open, the second adds none', async ({ page }, info) => {
  test.setTimeout(300_000);
  const frames = await countFrames(page);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'portrait.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Pause' }).click();
  await exportAs(page, info, 'Video', 'Export video');
  await page.waitForTimeout(2000);
  const one = await frames();
  await exportAs(page, info, 'Video', 'Export video');
  await page.waitForTimeout(2000);
  const two = await frames();
  console.log(`VideoFrames (${info.project.name}): after export 1 made ${one.made}, open ${one.made - one.closed}; after export 2 made ${two.made}, open ${two.made - two.closed}`);
  expect(two.made - one.made, 'the second export decodes and renders frames').toBeGreaterThan(100);
  // Measured 11–16 with two clips: each stream holds its current and next sample plus a few in the decoder's queue.
  expect(two.made - two.closed, 'frames still open').toBeLessThanOrEqual(24); // 11–16 seen; growth is the leak signal
  expect((two.made - two.closed) - (one.made - one.closed), 'open frames grow with each export').toBeLessThanOrEqual(1);
});

test('captions work offline once the speech model is on the device (Russian interface, GigaAM)', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright WebKit does not run service workers');
  test.skip(!!process.env.E2E_URL?.includes('localhost:51'), 'dev server has no service worker');
  test.setTimeout(500_000);
  await page.addInitScript(() => localStorage.setItem('kadr.locale', 'ru'));
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // controlled by the service worker from now on
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Медиа', ['speech_ru.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click(); // online: the model downloads once
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  await page.waitForTimeout(1500); // autosave
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 30_000 });
    await page.locator('.clip-caption').click();
    await tool(page, 'Субтитры').click();
    await page.getByRole('button', { name: 'Создать заново…' }).click();
    await page.getByRole('button', { name: 'Создать субтитры' }).click();
    await expect(page.getByRole('button', { name: 'Сохранить .srt' })).toBeVisible({ timeout: 120_000 });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Сохранить .srt' }).click();
    const srt = (await fs.promises.readFile(await (await dl).path(), 'utf8')).toLowerCase();
    for (const w of ['привет', 'работает', 'телефоне']) expect(srt).toContain(w);
  } finally {
    await context.setOffline(false);
  }
});

test('captions offline before the first model download say what to do, not "Failed to fetch"', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Playwright WebKit does not run service workers');
  test.skip(!!process.env.E2E_URL?.includes('localhost:51'), 'dev server has no service worker');
  test.setTimeout(240_000);
  await page.addInitScript(() => localStorage.setItem('kadr.locale', 'ru'));
  await page.goto('./');
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Медиа', ['speech_ru.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await context.setOffline(true);
  try {
    await tool(page, 'Субтитры').click();
    await expect(page.locator('.toast.error')).toContainText('Нет интернета. Модель речи (225 МБ) скачивается один раз', { timeout: 60_000 });
    await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0)); // the expected one
    await expect(page.locator('.toast.error')).toHaveCount(0, { timeout: 30_000 });
    await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
  } finally {
    await context.setOffline(false);
  }
});

// ---------- QA docs/11 §3.3–3.4: history and persistence across tools ----------

/** The project as saved in IndexedDB ('kadr'/'kv', key p:<id>), without its save time. */
async function savedProject(page: Page): Promise<string> {
  const id = /#\/p\/([^/?]+)/.exec(page.url())![1];
  return page.evaluate(async (key) => {
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const p = await new Promise<Record<string, unknown> | undefined>((ok, ko) => {
      const r = db.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => ok(r.result as Record<string, unknown> | undefined); r.onerror = () => ko(r.error);
    });
    db.close();
    if (!p) return '';
    delete p.updatedAt;
    return JSON.stringify(p);
  }, `p:${id}`);
}

/** The saved project once the autosave after the last edit has landed. */
async function settledProject(page: Page, prev?: string): Promise<string> {
  if (prev !== undefined) await expect.poll(() => savedProject(page), { timeout: 10_000 }).not.toBe(prev);
  let cur = await savedProject(page);
  for (;;) { await page.waitForTimeout(900); const next = await savedProject(page); if (next === cur) return cur; cur = next; }
}

/** Where two saved projects first differ, for a readable failure. */
const firstDiff = (a: string, b: string) => { let i = 0; while (i < a.length && a[i] === b[i]) i++; return `at ${i}: …${a.slice(Math.max(0, i - 80), i + 80)}… vs …${b.slice(Math.max(0, i - 80), i + 80)}…`; };

/** What a viewer sees and hears: gray 45×80 frames at 20/40/60/80% and the sound's 100 ms RMS envelope. */
async function fingerprint(file: string) {
  const { execFileSync } = await import('node:child_process');
  const duration = Number((await probe(file)).format.duration);
  const frames = [0.2, 0.4, 0.6, 0.8].map((f) => execFileSync('ffmpeg', ['-v', 'error', '-ss', (f * duration).toFixed(2), '-i', file, '-frames:v', '1', '-vf', 'scale=45:80', '-f', 'rawvideo', '-pix_fmt', 'gray', '-']));
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '8000', '-f', 'f32le', '-']);
  const pcm = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const env = Array.from({ length: Math.floor(pcm.length / 800) }, (_, i) => Math.sqrt(pcm.subarray(i * 800, (i + 1) * 800).reduce((s, x) => s + x * x, 0) / 800));
  return { duration, frames, env };
}

/**
 * Proves docs/11 §3.3–3.4 for a chain of actions: the saved project is recorded after each one; then every undo must
 * give exactly the project before its action and every redo the one after; then a reload keeps the project byte for
 * byte and exports the same picture and sound.
 */
function historyProof(page: Page, info: { outputPath: (n: string) => string; project: { name: string } }) {
  const states: string[] = [], names: string[] = [];
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  return {
    async start() { states.push(await settledProject(page)); names.push('start'); },
    /** One user action; it must change the project. */
    async act(name: string, run: () => Promise<void>) {
      await run();
      names.push(name);
      states.push(await settledProject(page, states[states.length - 1]));
      if (await closeTools.isVisible()) await closeTools.click();
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
      const before = await fingerprint(await exportAs(page, info, 'Video', 'Export video'));
      const saved = await settledProject(page);
      await page.reload();
      await expect(clips).toHaveCount(n);
      expect(await settledProject(page) === saved, `the reload keeps the project; ${firstDiff(await savedProject(page), saved)}`).toBe(true);
      const after = await fingerprint(await exportAs(page, info, 'Video', 'Export video'));
      expect(Math.abs(after.duration - before.duration)).toBeLessThan(0.05);
      const frameDiff = before.frames.map((f, k) => { let s = 0; for (let i = 0; i < f.length; i++) s += Math.abs(f[i] - after.frames[k][i]); return s / f.length; });
      // Pixels that changed visibly: a title drawn in a fallback font moved 2.15 on average and 2.1% of the pixels (v1.4.9).
      const changed = before.frames.map((f, k) => { let n = 0; for (let i = 0; i < f.length; i++) if (Math.abs(f[i] - after.frames[k][i]) > 24) n++; return n / f.length; });
      const envDiff = Math.max(...before.env.map((v, i) => Math.abs(v - (after.env[i] ?? 0))));
      console.log(`reload (${info.project.name}): frame diff ${frameDiff.map((d) => d.toFixed(2)).join(', ')} of 255, pixels changed ${changed.map((c) => `${(c * 100).toFixed(1)}%`).join(', ')}; sound envelope diff ${envDiff.toFixed(4)}; peak ${Math.max(...before.env).toFixed(3)}`);
      // The same project exports the same file: measured 0.00–0.19 on every chain without the font bug.
      for (const d of frameDiff) expect(d, 'frames after the reload, mean difference').toBeLessThan(1);
      for (const c of changed) expect(c, 'frames after the reload, share of changed pixels').toBeLessThan(0.005);
      expect(Math.max(...before.env)).toBeGreaterThan(0.01); // there is sound to compare
      expect(envDiff).toBeLessThan(0.01);
    },
  };
}

/** Drags an element sideways by `dx` px with the mouse. */
async function dragBy(page: Page, target: ReturnType<Page['locator']>, dx: number) {
  const b = (await target.boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2, { steps: 8 });
  await page.mouse.up();
}

const scrubTo = async (page: Page, px: number, shown: string) => {
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, px);
  await expect.poll(() => time(page)).toBe(shown);
};

test('history and persistence across tools: every action is one undo step back to exactly the project before it, redo replays them, a reload exports the same video', async ({ page }, info) => {
  test.setTimeout(480_000);
  const clips = page.locator('.tl-row.main .clip'), videos = page.locator('.tl-row.main .clip-video');
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'photo.png']);
  await expect(clips).toHaveCount(2);
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  const h = historyProof(page, info);
  await h.start();
  // Actions of different kinds, three of them creating derived media (reversed video, clean sound, a still).
  await h.act('trim start', async () => {
    await selectClip(page, mainVideo(page));
    const w0 = (await mainVideo(page).boundingBox())!.width;
    await dragBy(page, mainVideo(page).getByLabel('Trim start'), 60); // 1 s at 60 px per second
    await expect.poll(async () => (await mainVideo(page).boundingBox())!.width).toBeLessThan(w0 - 40);
  });
  await scrubTo(page, 120, '0:02.0');
  await h.act('split', async () => { await selectClip(page, mainVideo(page)); await tool(page, 'Split').click(); await expect(clips).toHaveCount(3); });
  await h.act('speed', async () => { await selectClip(page, mainVideo(page)); await useSheet(page, 'Speed'); });
  await h.act('filter', async () => { await selectClip(page, mainVideo(page)); await useSheet(page, 'Filters'); });
  await h.act('reverse', async () => {
    await selectClip(page, videos.nth(1));
    await tool(page, 'Reverse').click();
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
  });
  await h.act('noise reduction', async () => {
    await selectClip(page, videos.nth(1));
    await tool(page, 'Volume').click();
    const denoise = page.getByRole('switch', { name: 'Reduce background noise' });
    await denoise.check();
    await expect(denoise).toBeChecked({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await scrubTo(page, 30, '0:00.5');
  await h.act('freeze', async () => {
    await selectClip(page, mainVideo(page));
    await tool(page, 'Freeze').click();
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('.tl-row.main .clip-image')).toHaveCount(2);
  });
  await h.act('text', async () => { await tool(page, 'Text').click(); await page.getByRole('button', { name: 'Done' }).click(); });
  await h.act('move text', async () => {
    const text = page.locator('.clip-text'), x0 = (await text.boundingBox())!.x;
    await dragBy(page, text, 60);
    await expect.poll(async () => (await text.boundingBox())!.x).toBeGreaterThan(x0 + 40);
  });
  await h.undoRedo();
  await h.reload();
});

test('history and persistence, look and AI tools: keyframe, chroma key, mask, cutout, hidden faces, auto reframe, transition, blurred canvas', async ({ page }, info) => {
  test.setTimeout(600_000);
  const clips = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'walk.mp4', 'person.jpg', 'photo.png']);
  await expect(clips).toHaveCount(4);
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  const h = historyProof(page, info);
  await h.start();
  await h.act('keyframe', async () => {
    await selectClip(page, clips.nth(2));
    await tool(page, 'Transform').click();
    await page.getByRole('button', { name: 'Add Position X keyframe' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('chroma key', async () => {
    await selectClip(page, clips.nth(3));
    await tool(page, 'Chroma key').click();
    await page.getByRole('switch', { name: 'Remove color (green screen)' }).check();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('mask', async () => {
    await selectClip(page, clips.nth(3));
    await tool(page, 'Mask').click();
    await sheet(page).getByRole('radio', { name: 'Circle' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('cutout', async () => {
    await selectClip(page, clips.nth(2));
    await tool(page, 'Cutout').click();
    await expect(tool(page, 'Cutout')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  });
  await h.act('hide faces', async () => {
    await selectClip(page, clips.nth(2));
    await tool(page, 'Hide faces').click();
    await page.getByRole('switch', { name: 'Hide faces automatically' }).click();
    await expect(page.getByRole('switch', { name: 'Hide faces automatically' })).toBeChecked({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('auto reframe', async () => {
    await selectClip(page, clips.nth(1));
    await tool(page, 'Auto reframe').click();
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 120_000 });
  });
  await h.act('transition', async () => {
    await page.getByRole('button', { name: 'Transition' }).first().click();
    await sheet(page).getByRole('radio').nth(2).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('blurred canvas', async () => {
    await tool(page, 'Canvas').click();
    await sheet(page).getByRole('radio', { name: 'Blur' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.undoRedo();
  await h.reload();
});

test('history and persistence, overlays, sound and captions: text style, sticker, music, beat, cut to the beat, ducking, enhanced voice, sound effect, .srt captions and their style', async ({ page }, info) => {
  test.setTimeout(600_000);
  const clips = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4', 'landscape.mp4']);
  await expect(clips).toHaveCount(2);
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  const h = historyProof(page, info);
  await h.start();
  await scrubTo(page, 60, '0:01.0');
  await h.act('text', async () => { await tool(page, 'Text').click(); await page.getByRole('button', { name: 'Done' }).click(); });
  await h.act('text style', async () => {
    await selectClip(page, page.locator('.clip-text'));
    await tool(page, 'Edit text').click();
    await page.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Comic' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('sticker', async () => { await page.getByRole('button', { name: 'Stickers' }).click(); await page.getByRole('button', { name: 'Add 🔥' }).click(); await page.keyboard.press('Escape'); });
  await h.act('music', async () => {
    await importFiles(page, 'Audio', ['beat120.m4a']);
    await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1);
  });
  await h.act('find the beat', async () => { // the beat marks on the clip are its own step
    await selectClip(page, page.locator('.tl-row.audio .clip').first());
    await tool(page, 'Beat').click();
    await page.getByRole('button', { name: 'Find the beat' }).click();
    await expect(page.getByText('BPM')).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('cut to the beat', async () => {
    await selectClip(page, page.locator('.tl-row.audio .clip').first());
    await tool(page, 'Beat').click();
    await page.getByRole('radio', { name: 'every beat' }).click();
    await expect(page.getByText(/cuts now land on the beat/)).toBeVisible();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('ducking', async () => {
    await selectClip(page, page.locator('.tl-row.audio .clip').first());
    await tool(page, 'Volume').click();
    await page.getByLabel('Lower when others speak').check();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('enhanced voice', async () => {
    await selectClip(page, mainVideo(page));
    await tool(page, 'Volume').click();
    await page.getByRole('switch', { name: 'Enhance voice' }).check();
    await expect(page.getByRole('switch', { name: 'Enhance voice' })).toBeChecked({ timeout: 120_000 });
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await scrubTo(page, 150, '0:02.5');
  await h.act('sound effect', async () => {
    await tool(page, 'Sounds').click();
    await page.getByRole('button', { name: 'Add Whoosh at the playhead' }).click();
    await expect(page.locator('.tl-row.audio .clip')).toHaveCount(2);
  });
  await h.act('.srt captions', async () => {
    await tool(page, 'Captions').click(); // one tap starts recognition (v1.3); Settings stops it
    await page.getByRole('button', { name: 'Settings' }).click();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Import .srt or .vtt' }).click();
    await (await chooser).setFiles(fx('test.srt'));
    await expect(page.locator('.clip-caption')).toHaveCount(1);
    if (await sheet(page).isVisible()) await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('caption style', async () => {
    await selectClip(page, page.locator('.clip-caption'));
    await tool(page, 'Edit captions').click();
    await page.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Box' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.undoRedo();
  await h.reload();
});


// ---------- QA docs/11 §3.2: WYSIWYG for every look tool, in colour ----------

/** RGB 135×240 of a picture, or of a video's frame number `n`: colour errors (a filter's hue, a LUT) show here, not in grey. */
async function rgbAt(file: string, n?: number): Promise<Buffer> {
  const { execFileSync } = await import('node:child_process');
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${pick}scale=135:240`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
}

/** The largest mean signed R, G or B difference of two RGB pictures, 0–255: a colour cast, with zero-mean noise cancelled out. */
function colourCast(a: Buffer, b: Buffer): number {
  const sum = [0, 0, 0];
  for (let i = 0; i < a.length; i++) sum[i % 3] += a[i] - b[i];
  return Math.max(...sum.map((v) => Math.abs(v) / (a.length / 3)));
}

/** Exports the video once, then at each named time compares the preview with the photo export and the video's frame, in colour. */
/** The largest mean signed R, G or B difference of any 15×15 block of two 135×240 RGB pictures: a local colour error
 * (the wrong caption word lit, a missing sticker) that a whole-frame mean dilutes and that edge noise does not mimic. */
function worstBlockCast(a: Buffer, b: Buffer): number {
  let worst = 0;
  for (let by = 0; by < 240; by += 15) for (let bx = 0; bx < 135; bx += 15) {
    const sum = [0, 0, 0];
    for (let y = by; y < by + 15; y++) for (let x = bx; x < bx + 15; x++) for (let c = 0; c < 3; c++) { const i = (y * 135 + x) * 3 + c; sum[c] += a[i] - b[i]; }
    worst = Math.max(worst, ...sum.map((v) => Math.abs(v) / (15 * 15)));
  }
  return worst;
}

async function expectSameFrames(page: Page, info: TestInfo, title: string, points: { name: string; t: number }[], maxCast: number) {
  const video = await exportAs(page, info, 'Video', 'Export video');
  const rows: string[] = [];
  for (const { name, t: at } of points) {
    const t = Math.round(at * 30) / 30; // on a frame
    const preview = await rgbAt(await previewAt(page, info, t));
    const photo = await rgbAt(await exportAs(page, info, 'Photo', 'Save photo'));
    const frame = await rgbAt(video, Math.round(t * 30));
    const [dp, df, cp, cf] = [meanAbsDiff(preview, photo), meanAbsDiff(preview, frame), colourCast(preview, photo), colourCast(preview, frame)];
    const [bp, bf] = [worstBlockCast(preview, photo), worstBlockCast(preview, frame)];
    rows.push(`${name} @ ${t.toFixed(2)} s (playhead ${await time(page)}): photo ${dp.toFixed(2)} / cast ${cp.toFixed(2)} / block ${bp.toFixed(1)}, video ${df.toFixed(2)} / cast ${cf.toFixed(2)} / block ${bf.toFixed(1)}`);
    // Mean |difference| (0–255) catches a missing or moved element: matching frames ≤ 2, an export without the cutout 91.
    // The cast catches a colour shift that compression noise would hide in it; it grows with how bright and full the
    // frame is, so each scene passes its own limit (see the callers).
    expect.soft(dp, `photo, ${name}`).toBeLessThan(4);
    expect.soft(df, `video frame, ${name}`).toBeLessThan(6);
    expect.soft(cp, `photo colour cast, ${name}`).toBeLessThan(maxCast);
    expect.soft(cf, `video frame colour cast, ${name}`).toBeLessThan(maxCast);
    // Matching frames: ≤ 5 per block, captions on WebKit ≤ 10.3 (text drawn 2 px higher at preview size).
    expect.soft(bp, `photo, worst block, ${name}`).toBeLessThan(20);
    expect.soft(bf, `video frame, worst block, ${name}`).toBeLessThan(20);
  }
  console.log(`${title} (${info.project.name}):\n${rows.join('\n')}`);
}

test('WYSIWYG for every look tool: in the middle of each clip the preview, the photo and the video frame match in colour', async ({ page }, info) => {
  test.setTimeout(600_000);
  // The one-time iPhone video tip lies over the top of the preview and would be in its screenshot (not in the export).
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  await newProject(page);
  // Colour tools go on natural tones (walk: a person on blue-grey); the saturated test bars would clip a colour shift away.
  await importFiles(page, 'Media', ['walk.mp4', 'photo.png', 'person.jpg', 'landscape.mp4']);
  const clips = page.locator('.tl-row.main .clip');
  await expect(clips).toHaveCount(4);
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  const effect = async (name: string) => { await tool(page, 'Effects').click(); await page.getByRole('radio', { name, exact: true }).click(); await page.getByRole('button', { name: 'Done' }).click(); };
  // Clip middles in seconds (60 px per second, the first clip at 0).
  const middles = await clips.evaluateAll((els) => els.map((e) => ((e as HTMLElement).offsetLeft - (els[0] as HTMLElement).offsetLeft + (e as HTMLElement).offsetWidth / 2) / 60));
  const at = (t: number) => page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, Math.round(t * 60));

  // 1 walking video: filter, adjust, VHS effect, and a title over it.
  await selectClip(page, clips.nth(0));
  await useSheet(page, 'Filters');
  await useSheet(page, 'Adjust');
  await effect('VHS');
  // 2 photo: crop, transform, mirror, circle mask, and a sticker over it.
  await selectClip(page, clips.nth(1));
  await useSheet(page, 'Crop');
  await useSheet(page, 'Transform');
  await tool(page, 'Mirror').click();
  await expect(tool(page, 'Mirror')).toHaveAttribute('aria-pressed', 'true');
  await tool(page, 'Mask').click();
  await sheet(page).getByRole('radio', { name: 'Circle' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // 3 person photo: cutout and hidden faces.
  await selectClip(page, clips.nth(2));
  await tool(page, 'Cutout').click();
  await expect(tool(page, 'Cutout')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  await tool(page, 'Hide faces').click();
  await page.getByRole('switch', { name: 'Hide faces automatically' }).click();
  await expect(page.getByRole('switch', { name: 'Hide faces automatically' })).toBeChecked({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  // 4 test bars: chroma key and RGB split.
  await selectClip(page, clips.nth(3));
  await tool(page, 'Chroma key').click();
  await page.getByRole('switch', { name: 'Remove color (green screen)' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await effect('RGB split');
  if (await closeTools.isVisible()) await closeTools.click();
  await at(middles[0] - 0.5);
  await tool(page, 'Text').click();
  await page.getByRole('button', { name: 'Done' }).click();
  if (await closeTools.isVisible()) await closeTools.click();
  await at(middles[1] - 0.5);
  await page.getByRole('button', { name: 'Stickers' }).click();
  await page.getByRole('button', { name: 'Add 🔥' }).click();
  await page.keyboard.press('Escape'); // nothing selected: no handles over the picture
  if (await closeTools.isVisible()) await closeTools.click();

  const names = ['video: filter, adjust, VHS, title', 'photo: crop, transform, mirror, mask, sticker', 'person: cutout, hidden faces', 'bars: chroma key, RGB split'];
  // Mostly black frames: matching casts ≤ 0.32; export-only temperature +0.3 gives 1.06–2.78.
  await expectSameFrames(page, info, 'WYSIWYG look tools', names.map((name, k) => ({ name, t: middles[k] })), 0.8);
});

test('WYSIWYG in motion: auto reframe and a LUT, mid-transition, a keyframe between keys, a styled title on a blurred canvas', async ({ page }, info) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  // A LUT that rotates the channels (r, g, b) → (g, b, r): a colour path that skips or misreads it is far off.
  const cube = info.outputPath('rotate.cube');
  const lines = ['TITLE "rotate"', 'LUT_3D_SIZE 9'];
  for (let b = 0; b < 9; b++) for (let g = 0; g < 9; g++) for (let r = 0; r < 9; r++) lines.push(`${g / 8} ${b / 8} ${r / 8}`);
  fs.writeFileSync(cube, lines.join('\n'));
  await newProject(page);
  await importFiles(page, 'Media', ['walk.mp4', 'landscape.mp4']);
  const clips = page.locator('.tl-row.main .clip');
  await expect(clips).toHaveCount(2);
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  const closeAll = async () => { if (await closeTools.isVisible()) await closeTools.click(); };
  const at = (t: number) => page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, Math.round(t * 60));
  // The whole canvas: a blurred copy behind the 16:9 bars instead of black bands.
  await closeAll();
  await tool(page, 'Canvas').click();
  await sheet(page).getByRole('radio', { name: 'Blur' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // The cut: whip pan (a motion blur that depends on the time within the transition).
  await closeAll();
  await page.getByRole('button', { name: 'Transition' }).first().click();
  await page.getByRole('radio', { name: 'Whip pan', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // 1 walking person: auto reframe (position keyframes from the model), then the LUT.
  await selectClip(page, clips.nth(0));
  await tool(page, 'Auto reframe').click();
  await expect(page.getByText(/Reframed/)).toBeVisible({ timeout: 90_000 });
  await selectClip(page, clips.nth(0));
  await tool(page, 'Filters').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import LUT (.cube)' }).click();
  await (await chooser).setFiles(cube);
  await expect(page.getByRole('radio', { name: 'rotate' })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
  // 2 bars: position X keyed 0.5 s and 3.5 s into the clip, a Comic title from 1 s.
  const start2 = await clips.evaluateAll((els) => ((els[1] as HTMLElement).offsetLeft - (els[0] as HTMLElement).offsetLeft) / 60);
  expect(start2, 'the 0.5 s transition starts clip 2 early').toBeCloseTo(4.5, 1);
  await at(start2 + 0.5);
  await selectClip(page, clips.nth(1));
  await tool(page, 'Transform').click();
  await page.getByRole('button', { name: 'Add Position X keyframe' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await at(start2 + 3.5);
  await selectClip(page, clips.nth(1));
  await tool(page, 'Transform').click();
  await sheet(page).locator('input[type=range]').first().focus();
  for (let i = 0; i < 15; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Done' }).click();
  await closeAll();
  await at(start2 + 1);
  await tool(page, 'Text').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Kadr 2026');
  await page.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Comic' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape'); // nothing selected: no handles over the picture
  await closeAll();

  await expectSameFrames(page, info, 'WYSIWYG in motion', [
    { name: 'walk: auto reframe, channel-rotating LUT', t: 2.5 },
    { name: 'mid-cut: whip pan', t: start2 + 0.25 },
    { name: 'bars: X between keys, Comic title, blurred canvas', t: start2 + 2 },
  ], 2); // bright full frames: matching casts ≤ 0.83; export-only temperature +0.3 gives 4.9–6.1
});
// ---------- QA docs/11 §3.2: the sound the preview plays is the sound the export contains ----------

test.describe(() => {
  // The tap is test equipment. WebKit loads its worklet from a routed same-origin URL; Chromium does not route worklet
  // requests, so it takes a blob, which the app's CSP (enforced in every other test) refuses.
  test.use({ bypassCSP: true, serviceWorkers: 'block' });

test('WYSIWYG for sound: what the preview plays matches the exported mix — volume, fades, music ducked under speech', async ({ page, browserName }, info) => {
  test.setTimeout(300_000);
  // Headless Chromium decodes the video in software on this thread pool; on a busy Mac it decoded AAC at ~0.3× real
  // time while playing (0.5 s of sound took 1.7 s), so its preview dropped seconds that no buffering can save. The
  // mix code is the same for both engines; WebKit (hardware decoding, as on the iPhone) measures it.
  test.skip(browserName === 'chromium', 'realtime sound in headless Chromium measures the machine, not the mix');
  // Taps the preview mixer on the audio thread: an AudioWorklet sees every 128-sample render quantum of what the
  // realtime context sends to the speakers, numbered, and outputs silence. (A ScriptProcessor runs on the main
  // thread and repeats or drops blocks when it is busy — it made dropouts that were not in the preview.)
  const TAP = `
    registerProcessor('tap', class extends AudioWorkletProcessor {
      constructor() { super(); this.buf = new Float32Array(4096); this.n = 0; }
      process(inputs) {
        const ch = inputs[0];
        for (let i = 0; i < 128; i++) this.buf[this.n + i] = ch.length > 1 ? (ch[0][i] + ch[1][i]) / 2 : ch.length ? ch[0][i] : 0;
        this.n += 128;
        if (this.n === 4096) { this.port.postMessage({ frame: currentFrame + 128 - 4096, d: this.buf }); this.buf = new Float32Array(4096); this.n = 0; }
        return true;
      }
    });`;
  await page.route('**/__tap-worklet.js', (r) => r.fulfill({ contentType: 'text/javascript', body: TAP }));
  await page.addInitScript((code) => {
    const blob = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
    const tap = { chunks: [] as { frame: number; d: Float32Array }[], rate: 0, error: '' };
    (window as unknown as { __tap: typeof tap }).__tap = tap;
    const connect = AudioNode.prototype.connect as (this: AudioNode, ...a: unknown[]) => AudioNode;
    AudioNode.prototype.connect = function (this: AudioNode, ...args: unknown[]) {
      const ctx = this.context;
      if (args[0] instanceof AudioDestinationNode && ctx instanceof AudioContext && this instanceof GainNode) {
        const master = this;
        tap.rate = ctx.sampleRate;
        void ctx.audioWorklet.addModule(new URL('__tap-worklet.js', location.href).href).catch(() => ctx.audioWorklet.addModule(blob)).then(() => {
          const node = new AudioWorkletNode(ctx, 'tap');
          node.port.onmessage = (e: MessageEvent<{ frame: number; d: Float32Array }>) => tap.chunks.push(e.data);
          connect.call(master, node);
          connect.call(node, ctx.destination);
          (window as unknown as { __tapNode: AudioNode }).__tapNode = node;
        }, (e: unknown) => { tap.error = String(e); });
      }
      return connect.apply(this, args);
    } as typeof AudioNode.prototype.connect;
  }, TAP);
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4']); // 5.9 s of speech
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Audio', ['beat120.m4a']); // 12 s of beat, on under the speech and after it
  const music = page.locator('.tl-row.audio .clip').first();
  await expect(music).toHaveCount(1);
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Volume').click();
  await page.getByRole('slider', { name: 'Volume', exact: true }).fill('0.6');
  await page.getByRole('button', { name: 'Done' }).click();
  await selectClip(page, music);
  await tool(page, 'Volume').click();
  await page.getByRole('slider', { name: 'Fade in', exact: true }).fill('1');
  await page.getByRole('slider', { name: 'Fade out', exact: true }).fill('1.5');
  await page.getByRole('switch', { name: 'Lower when others speak' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  if (await closeTools.isVisible()) await closeTools.click();

  // The preview, played from the start to the end in real time. A first short play wakes the audio context (it starts
  // suspended until a tap, which hides any delay); the measured play is the next one, as most are. Right after its
  // tap the page is kept busy for 0.8 s, as a phone is while it opens files and renders: the sound must still start
  // with the picture, not after.
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(700);
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    (window as unknown as { __tap: { chunks: unknown[] } }).__tap.chunks.length = 0;
    window.addEventListener('click', (e) => { // after the app's own handler (React listens on its root)
      // The path, not the target: React has already swapped the Play icon the tap landed on for Pause.
      if (!e.composedPath().some((n) => n instanceof Element && n.classList.contains('play-btn'))) return;
      (window as unknown as { __busy: number }).__busy = ((window as unknown as { __busy?: number }).__busy ?? 0) + 1;
      const until = performance.now() + 800;
      while (performance.now() < until) { /* busy */ }
    });
  });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Play', exact: true })).toBeVisible({ timeout: 30_000 }); // stopped at the end
  const { b64, rate, gaps, error, count } = await page.evaluate(() => {
    const { chunks, rate } = (window as unknown as { __tap: { chunks: { frame: number; d: Float32Array }[]; rate: number } }).__tap;
    let gaps = 0;
    for (let k = 1; k < chunks.length; k++) if (chunks[k].frame !== chunks[k - 1].frame + 4096) gaps++;
    const all = new Float32Array(chunks.length * 4096);
    chunks.forEach((c, k) => all.set(c.d, k * 4096));
    const u = new Uint8Array(all.buffer);
    let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return { b64: btoa(s), rate, gaps, error: (window as unknown as { __tap: { error: string } }).__tap.error, count: chunks.length };
  });
  expect(error, 'the tap worklet loads').toBe('');
  expect(await page.evaluate(() => (window as unknown as { __busy?: number }).__busy), 'the page was kept busy after the tap').toBe(1);
  expect(count, 'the tap heard the preview').toBeGreaterThan(0);
  expect.soft(gaps, 'the tap saw every render quantum').toBe(0);
  const tb = Buffer.from(b64, 'base64');
  const played = new Float32Array(tb.buffer, tb.byteOffset, tb.byteLength / 4);

  // The export at the preview's rate, (L + R) / 2 like the tap: ffmpeg's own `-ac 1` sums stereo at 0.707 each.
  const { execFileSync } = await import('node:child_process');
  const file = await exportAs(page, info, 'Audio', 'Export audio', { loudness: false });
  const eb = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-af', 'pan=mono|c0=0.5*c0+0.5*c1', '-ar', String(rate), '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  const exported = new Float32Array(eb.buffer, eb.byteOffset, eb.byteLength / 4);

  // Line the two up: to the millisecond on 10 ms RMS (the tap starts before the sound: the clock may wait for it up to
  // 2 s), then to the sample.
  const ms = rate / 1000;
  const perMs = (x: Float32Array) => Array.from({ length: Math.floor(x.length / ms) }, (_, k) => x.subarray(k * ms, (k + 1) * ms).reduce((s, v) => s + v * v, 0));
  const pp = perMs(played), pe = perMs(exported);
  const rms10 = (e: number[], k: number) => { let v = 0; for (let j = k; j < k + 10; j++) v += e[j] ?? 0; return Math.sqrt(v); };
  let lagMs = 0, bestMisfit = Infinity;
  for (let l = 0; l <= 3000; l++) {
    let d = 0;
    for (let k = 0; k + 10 <= pe.length; k += 10) d += Math.abs(rms10(pp, k + l) - rms10(pe, k));
    if (d < bestMisfit) { bestMisfit = d; lagMs = l; }
  }
  const lag = lagMs * ms;
  const dot = (o: number, a: number, b2: number) => { let v = 0; for (let i = a; i < b2; i++) v += played[i + o] * exported[i]; return v; };
  let best = lag;
  for (let o = lag - 2 * ms; o <= lag + 2 * ms; o++) if (o >= 0 && dot(o, rate, 5 * rate) > dot(best, rate, 5 * rate)) best = o;

  // Two different questions, 20 ms at a time. Delivery: a dropout is preview silence where the export is loud — the
  // realtime engine late with a buffer (a slow first decode, a starved CPU). Mix: where the preview sounds, the gain
  // that best maps the export onto it (1 = same level) and what is left over (fades, ducking, timing).
  const w = 20 * ms;
  const win = (i: number) => {
    let pv = 0, ev = 0;
    for (let j = i; j < i + w; j++) { pv += played[j + best] ** 2; ev += exported[j] ** 2; }
    return { p: Math.sqrt(pv / w), e: Math.sqrt(ev / w) };
  };
  const dropped = (i: number) => { const v = win(i); return v.e > 0.01 && v.p < 0.1 * v.e; };
  const drops: number[] = [];
  for (let i = Math.round(0.05 * rate); i + w <= exported.length; i += w) if (dropped(i)) drops.push(i / rate);
  const rows: string[] = [];
  const stats: { name: string; gain: number; rest: number }[] = [];
  for (const [name, a, b2] of [['music fades in under speech', 0.1, 1], ['speech, music ducked', 1.5, 5.5], ['music back up', 6.5, 10], ['music fades out', 10.5, 11.8]] as const) {
    let xy = 0, yy = 0, rr = 0, gone = 0;
    const i0 = Math.round(a * rate), i1 = Math.round(b2 * rate);
    for (let i = i0; i + w <= i1; i += w) {
      if (dropped(i)) { gone++; continue; }
      for (let j = i; j < i + w; j++) { xy += played[j + best] * exported[j]; yy += exported[j] * exported[j]; }
    }
    const gain = xy / yy;
    for (let i = i0; i + w <= i1; i += w) if (!dropped(i)) for (let j = i; j < i + w; j++) rr += (played[j + best] - gain * exported[j]) ** 2;
    const rest = Math.sqrt(rr / yy);
    stats.push({ name, gain, rest });
    rows.push(`${name} ${a}–${b2} s: preview ×${gain.toFixed(4)}, left over ${(rest * 100).toFixed(1)}%${gone ? `, ${gone * 20} ms dropped` : ''}`);
  }
  console.log(`WYSIWYG sound (${info.project.name}): preview at ${rate} Hz, the clock waited ${(best / ms).toFixed(0)} ms; dropouts ${drops.length * 20} ms${drops.length ? ` from ${drops[0].toFixed(2)} s` : ''}\n${rows.join('\n')}`);
  expect(played.length - best, 'the preview played to the end').toBeGreaterThan(exported.length - rate / 2);
  // Delivery. The start is the app's to get right (it waits for the decoded sound); later dropouts measure the machine
  // as much as the app — clean on an idle Mac, seconds long at load average 10–20 with software video decoding.
  expect.soft(drops.filter((t) => t < 1), 'the sound starts with the picture').toEqual([]);
  expect.soft(drops.length * 20 / (exported.length / ms), 'share of the sound dropped').toBeLessThan(0.1);
  // Mix. Matching: ×0.999–1.003 and 0.5–3.6% left over (AAC). The first 44 ms are not compared: the export drops the
  // encoder's priming there (engine/encoderDelay).
  for (const { name, gain, rest } of stats) {
    expect.soft(Math.abs(gain - 1), `level, ${name}`).toBeLessThan(0.03);
    expect.soft(rest, `left over, ${name}`).toBeLessThan(0.06);
  }
});
});

// ---------- QA docs/11 §3.7: codecs are released ----------

/** Counts WebCodecs decoders and encoders made on the page and how many are not closed (worker ones are not seen). */
async function countCodecs(page: Page) {
  await page.addInitScript(() => {
    const live: { kind: string; c: { state: string } }[] = [];
    (window as unknown as { __codecs: () => unknown }).__codecs = () => {
      const open: Record<string, number> = {}, made: Record<string, number> = {};
      for (const x of live) { made[x.kind] = (made[x.kind] ?? 0) + 1; if (x.c.state !== 'closed') open[x.kind] = (open[x.kind] ?? 0) + 1; }
      return { open, made, total: live.filter((x) => x.c.state !== 'closed').length };
    };
    const w = window as unknown as Record<string, new (init: unknown) => { state: string }>;
    for (const kind of ['AudioDecoder', 'VideoDecoder', 'AudioEncoder', 'VideoEncoder']) {
      const C = w[kind];
      if (C) w[kind] = class extends C { constructor(init: unknown) { super(init); live.push({ kind, c: this }); } };
    }
  });
  return () => page.evaluate(() => (window as unknown as { __codecs: () => { open: Record<string, number>; made: Record<string, number>; total: number } }).__codecs());
}

test('codecs are released: playing, seeking and exporting again leave no more decoders open than the first time', async ({ page }, info) => {
  test.setTimeout(400_000);
  const codecs = await countCodecs(page);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'portrait.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Audio', ['../public/music/tracks/holiznacc0-2nd-dimension-eda08f.m4a']); // a real 136 s AAC track
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1, { timeout: 60_000 });
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  const scroll = page.locator('.tl-scroll');
  /** Play, then jump around the timeline the way a thumb scrubs, then play again. */
  const session = async () => {
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Pause' }).click();
    for (const s of [7, 1, 10, 3, 0, 11, 5, 2]) { await scroll.evaluate((el, x) => { el.scrollLeft = x; }, s * 60); await page.waitForTimeout(350); }
    await page.getByRole('button', { name: 'Play' }).click();
    await page.waitForTimeout(1000);
    await page.getByRole('button', { name: 'Pause' }).click();
    await page.waitForTimeout(2500); // idle: streams that are done have had time to close
  };
  const rows: string[] = [];
  const mark = async (label: string) => { const c = await codecs(); rows.push(`${label}: open ${c.total} ${JSON.stringify(c.open)}, made ${JSON.stringify(c.made)}`); return c.total; };
  await page.waitForTimeout(2500);
  await mark('imported');
  await session();
  const play1 = await mark('play + 8 seeks');
  for (let i = 0; i < 3; i++) await session();
  const play4 = await mark('3 more of the same');
  await exportAs(page, info, 'Video', 'Export video');
  await page.waitForTimeout(2500);
  const export1 = await mark('export 1');
  await exportAs(page, info, 'Video', 'Export video');
  await page.waitForTimeout(2500);
  const export2 = await mark('export 2');
  console.log(`codecs (${info.project.name}):\n${rows.join('\n')}`);
  expect(play4 - play1, 'playing and seeking again opens no more decoders').toBeLessThanOrEqual(1);
  expect(export2 - export1, 'a second export leaves no more codecs open').toBeLessThanOrEqual(0);
  expect(export2, 'codecs open at rest').toBeLessThanOrEqual(12);
});

// ---------- QA docs/11 §3.1–3.2: speed curves end to end ----------

test('speed curve: a preset, a cut in the middle of it; the file is as long as the timeline and shows the same frames as the preview', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']); // testsrc: every frame differs, so a wrong source time shows
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await tool(page, 'Speed').click();
  await sheet(page).getByRole('radio', { name: 'Curve', exact: true }).click();
  await sheet(page).getByRole('radio', { name: 'Hero moment', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const total = async () => { const [, m, s] = /\/\s*(\d+):(\d+(?:\.\d+)?)/.exec((await page.locator('.time').textContent()) ?? '')!; return Number(m) * 60 + Number(s); };
  const curved = await total();
  expect(curved, 'Hero moment slows the middle down: the clip gets longer than its 6 s').toBeGreaterThan(7);
  await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, Math.round((curved / 2) * 60));
  await selectClip(page, mainVideo(page));
  await tool(page, 'Split').click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  expect(Math.abs((await total()) - curved), 'a cut does not change the length').toBeLessThan(0.11);
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  const video = await exportAs(page, info, 'Video', 'Export video');
  const pr = await probe(video);
  expect(Math.abs(Number(pr.format.duration) - curved), 'the file lasts as long as the timeline').toBeLessThan(0.1);
  const rows: string[] = [];
  // Fast start, slow middle (on both sides of the cut), fast end.
  for (const f of [0.08, 0.42, 0.58, 0.92]) {
    const t = Math.round(f * curved * 30) / 30;
    const d = meanAbsDiff(await grayAt(await previewAt(page, info, t)), await grayAt(video, Math.round(t * 30)));
    rows.push(`${t.toFixed(2)} s: preview vs video ${d.toFixed(2)}`);
    expect.soft(d, `frame at ${t.toFixed(2)} s`).toBeLessThan(6);
  }
  console.log(`speed curve (${info.project.name}): ${curved.toFixed(2)} s\n${rows.join('\n')}`);
});

// ---------- QA docs/11 §3.2: captions and iPhone HDR look the same in the preview and the files ----------

test('WYSIWYG for captions: a word-highlight style with a web font is the same in the preview, the photo and the video', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  await newProject(page);
  // The captions first: with a video selected, Captions would caption its speech in one tap (and fetch a model).
  // "Hello from Kadr" 0.5–2 s, "Second line" 2.5–4 s; an .srt has no word times, so the words share their line evenly.
  await tool(page, 'Captions').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .srt or .vtt' }).click();
  await (await chooser).setFiles(fx('test.srt'));
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  await page.getByRole('radio', { name: 'Highlight the word' }).click();
  await page.getByRole('radiogroup', { name: 'Style' }).getByRole('radio', { name: 'Pop' }).click(); // Anton, outlined, yellow word
  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  if (await closeTools.isVisible()) await closeTools.click();
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  if (await closeTools.isVisible()) await closeTools.click();
  await expectSameFrames(page, info, 'WYSIWYG captions', [
    { name: 'first word lit', t: 0.75 },
    { name: 'last word lit', t: 1.75 },
    { name: 'second line', t: 3.25 },
  ], 0.8);
});

test('WYSIWYG for an iPhone HDR video: HEVC 10-bit HLG looks the same in the preview, the photo and the video', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'Playwright\'s Chromium has no HEVC decoder; Android Chrome uses the platform one');
  test.skip(!fs.existsSync(fx('iphone_hdr.mov')), 'needs ffmpeg with libx265 (npm run fixtures)');
  test.setTimeout(300_000);
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  await newProject(page);
  await importFiles(page, 'Media', ['iphone_hdr.mov']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  if (await closeTools.isVisible()) await closeTools.click();
  await expectSameFrames(page, info, 'WYSIWYG HDR', [1, 2, 3].map((t) => ({ name: `HLG at ${t} s`, t })), 0.8);
});

// ---------- QA docs/11 §3.3–3.4: capture, import and selection in one history ----------

test('history and persistence, capture and selection: a camera recording, a two-file import, several clips duplicated then deleted — each one exact undo step, a reload exports the same video', async ({ page }, info) => {
  test.setTimeout(480_000);
  await fakeCamera(page);
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  const main = page.locator('.tl-row.main .clip'), text = page.locator('.clip-text'), picked = page.locator('.clip.picked');
  await newProject(page);
  const h = historyProof(page, info);
  await h.start();
  await h.act('camera recording', async () => {
    await tool(page, 'Camera').click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 }); // after 3-2-1
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(1, { timeout: 30_000 });
  });
  await h.act('import of two files at once', async () => {
    await importFiles(page, 'Media', ['photo.png', 'landscape.mp4']);
    await expect(main).toHaveCount(3);
  });
  await h.act('text', async () => {
    await tool(page, 'Text').click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(text).toHaveCount(1);
  });
  await h.act('a text and a photo on two tracks duplicated', async () => {
    await selectClip(page, text);
    await tool(page, 'Select several').click();
    await expect(text).toHaveClass(/picked/);
    await page.locator('.tl-row.main .clip-image').click();
    await expect(page.getByRole('status').filter({ hasText: '2 selected' })).toBeVisible();
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
    await expect(main).toHaveCount(4);
    await expect(text).toHaveCount(2);
  });
  await h.act('the picked copies deleted', async () => {
    await expect(picked).toHaveCount(2); // the copies are picked after duplicating
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(main).toHaveCount(3);
    await expect(text).toHaveCount(1);
    await page.getByRole('button', { name: 'Finish selecting' }).click();
  });
  await h.undoRedo();
  await h.reload();
});

// ---------- QA docs/11 §3.1–3.2: cuts reach the file frame for frame ----------

/** The source frame a picture (or a video's frame `n`) shows, read from counter.mp4's 8-stripe binary code. */
async function counterAt(file: string, n?: number): Promise<number> {
  const { execFileSync } = await import('node:child_process');
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

test('cuts reach the file frame for frame: split twice, delete the middle — the video, the photo and the preview show exactly the expected source frame on both sides of the cut', async ({ page }, info) => {
  test.setTimeout(300_000);
  test.skip(!fs.existsSync(fx('counter.mp4')), 'needs npm run fixtures');
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']); // 6 s at 30 fps, frame N written in binary
  await expect(main).toHaveCount(1);
  // Split at 2 s and 4 s, delete the middle: the timeline plays source frames 0–59, then 120–179.
  await scrubTo(page, 120, '0:02.0');
  await selectClip(page, main.first());
  await tool(page, 'Split').click();
  await expect(main).toHaveCount(2);
  await scrubTo(page, 240, '0:04.0');
  await selectClip(page, main.nth(1));
  await tool(page, 'Split').click();
  await expect(main).toHaveCount(3);
  await selectClip(page, main.nth(1));
  await tool(page, 'Delete').click();
  await expect(main).toHaveCount(2);
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  if (await closeTools.isVisible()) await closeTools.click();
  const source = (k: number) => (k < 60 ? k : k + 60);

  const video = await exportAs(page, info, 'Video', 'Export video');
  const rows: string[] = [];
  const duration = Number((await probe(video)).format.duration);
  rows.push(`duration ${duration.toFixed(3)} s`);
  expect(Math.abs(duration - 4)).toBeLessThan(0.05);
  for (const k of [0, 30, 58, 59, 60, 61, 90, 119]) {
    const got = await counterAt(video, k);
    rows.push(`timeline frame ${k}: video shows ${got} (expected ${source(k)})`);
    expect.soft(got, `video frame ${k}`).toBe(source(k));
  }
  // The preview and the photo in the middle of a frame (the playhead moves in whole pixels, 2 per frame).
  for (const k of [10, 59, 60, 100]) {
    const shown = await counterAt(await previewAt(page, info, (k + 0.5) / 30));
    const photo = await counterAt(await exportAs(page, info, 'Photo', 'Save photo'));
    rows.push(`timeline frame ${k}: preview ${shown}, photo ${photo} (expected ${source(k)})`);
    expect.soft(shown, `preview at frame ${k}`).toBe(source(k));
    expect.soft(photo, `photo at frame ${k}`).toBe(source(k));
  }
  // The tone runs on across the cut (440 Hz: whole cycles in 2 s, so no click either): no 10 ms window goes quiet.
  const { execFileSync } = await import('node:child_process');
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-']);
  const pcm = new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
  const rms = (s: number) => { let v = 0; for (let i = Math.round(s * 48000); i < Math.round((s + 0.01) * 48000); i++) v += pcm[i] ** 2; return Math.sqrt(v / 480); };
  const steady = rms(1);
  const around = Array.from({ length: 40 }, (_, i) => rms(1.8 + i * 0.01));
  rows.push(`sound around the cut: ${Math.min(...around).toFixed(3)}–${Math.max(...around).toFixed(3)}, steady ${steady.toFixed(3)}`);
  console.log(`cuts frame for frame (${info.project.name}):\n${rows.join('\n')}`);
  expect(Math.min(...around)).toBeGreaterThan(0.5 * steady);
});

test('clip tools reach the file frame for frame: 2× speed, reverse and a freeze frame show exactly the expected source frames in the video, the photo and the preview', async ({ page }, info) => {
  test.setTimeout(300_000);
  test.skip(!fs.existsSync(fx('counter.mp4')), 'needs npm run fixtures');
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4', 'counter.mp4', 'counter.mp4']); // A, B, C: 6 s each, frame N in binary
  await expect(main).toHaveCount(3);
  // A at 2×: 0–3 s. B reversed: 3–9 s. C: 9–15 s, frozen at 10 s (its source frame 30) for 2 s, then on from frame 30.
  await selectClip(page, main.nth(0));
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
  await selectClip(page, main.nth(1));
  await tool(page, 'Reverse').click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
  // Select first, then scrub: Playwright scrolls a half-hidden clip into view to click it, which moves the playhead.
  await selectClip(page, main.nth(2));
  await scrubTo(page, 600, '0:10.0');
  await tool(page, 'Freeze').click(); // the clip under the playhead
  await expect(main).toHaveCount(5, { timeout: 30_000 });
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  if (await closeTools.isVisible()) await closeTools.click();
  // The source frame at timeline time t (seconds).
  const source = (t: number) => {
    const f = Math.floor(t * 30 + 1e-6);
    if (t < 3) return Math.floor(t * 2 * 30 + 1e-6); // A, twice as fast
    if (t < 9) return 179 - (f - 90); // B backwards
    if (t < 10) return f - 270; // C up to the freeze
    if (t < 12) return 30; // the freeze frame
    return 30 + (f - 360); // C after it
  };

  const video = await exportAs(page, info, 'Video', 'Export video');
  const rows: string[] = [];
  const duration = Number((await probe(video)).format.duration);
  rows.push(`duration ${duration.toFixed(3)} s`);
  expect(Math.abs(duration - 17)).toBeLessThan(0.05);
  for (const k of [0, 10, 89, 90, 91, 269, 270, 299, 300, 359, 360, 361, 509]) {
    const got = await counterAt(video, k);
    rows.push(`frame ${k}: video ${got} (expected ${source(k / 30)})`);
    expect.soft(got, `video frame ${k}`).toBe(source(k / 30));
  }
  for (const k of [10, 90, 268, 330, 361]) {
    const t = (k + 0.5) / 30; // mid-frame: the playhead moves 2 px per frame
    const shown = await counterAt(await previewAt(page, info, t));
    const photo = await counterAt(await exportAs(page, info, 'Photo', 'Save photo'));
    rows.push(`frame ${k}½: preview ${shown}, photo ${photo} (expected ${source(t)})`);
    expect.soft(shown, `preview at frame ${k}½`).toBe(source(t));
    expect.soft(photo, `photo at frame ${k}½`).toBe(source(t));
  }
  console.log(`clip tools frame for frame (${info.project.name}):\n${rows.join('\n')}`);
});

// ---------- QA docs/11 §3.6 and §3.15: backups that are not what they claim ----------

test('hostile backups: garbage, broken JSON, a re-zipped copy, corrupt clips, a broken LUT, an impossible canvas, impossible or missing media — a clear message or a project that works and says what it left out', async ({ page }, info) => {
  test.setTimeout(360_000);
  const { unzipSync, zipSync, strFromU8, strToU8 } = await import('fflate');
  const { randomBytes } = await import('node:crypto');
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept('Mine') : d.accept()));
  await page.goto('./');
  await page.getByRole('button', { name: 'Try a sample' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Back to projects' }).click();
  const first = page.locator('.project-open').first();
  const name = (await first.getAttribute('aria-label'))!.replace(/^Open /, '');
  await page.getByRole('button', { name: `Rename ${name}` }).click();
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save a backup of Mine' }).click();
  const realPath = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(realPath);
  const real = unzipSync(new Uint8Array(fs.readFileSync(realPath)));
  const project = JSON.parse(strFromU8(real['project.json'])) as { tracks: { kind: string; clips: Record<string, unknown>[] }[]; assets: Record<string, unknown> };
  const write = (file: string, entries: Record<string, Uint8Array>, level: 0 | 6 = 0) => { const p = info.outputPath(file); fs.writeFileSync(p, zipSync(entries, { level })); return p; };
  const withProject = (file: string, edit: (p: typeof project) => void) => {
    const p = structuredClone(project);
    edit(p);
    return write(file, { ...real, 'project.json': strToU8(JSON.stringify(p)) });
  };
  const main = (p: typeof project) => p.tracks.find((t) => t.kind === 'main')!.clips;
  const garbage = info.outputPath('garbage.kadr');
  fs.writeFileSync(garbage, randomBytes(4096));
  // [what, file, parts the restore must say it left out]
  const files: [string, string, number?][] = [
    ['random bytes', garbage],
    ['broken JSON', write('broken-json.kadr', { 'project.json': strToU8('{"version": 1, "tracks": [{"kind": "main", "clips": [') })],
    ['re-zipped with deflate (Finder "Compress")', write('recompressed.zip', real, 6), 0],
    ['a zip bomb: 300 KB that unpacks to 300 MB', write('bomb.kadr', { 'project.json': new Uint8Array(300 * 1024 ** 2).fill(32) }, 6)],
    ['negative duration, no start', withProject('negative.kadr', (p) => { main(p)[0].duration = -5; delete main(p)[0].start; }), 1],
    ['unknown clip kind, text without a style', withProject('unknown.kadr', (p) => {
      main(p).push({ kind: 'hologram', id: 'h1' });
      p.tracks.push({ kind: 'text', clips: [{ kind: 'text', id: 't1', start: 0, duration: 2, text: 'Hi', style: null }] } as never);
    }), 2],
    ['a LUT that is not a LUT', withProject('lut.kadr', (p) => {
      (p as unknown as { luts: unknown }).luts = { L: { name: 'Teal', size: 33, data: 'not base64 at all!' } };
      main(p)[0].lut = { id: 'L', intensity: 1 };
    }), 1],
    ['zero fps and a canvas of 100 000 px', withProject('settings.kadr', (p) => {
      Object.assign((p as unknown as { settings: object }).settings, { fps: 0, width: 100_000, height: 100_000, aspect: '7:3' });
    }), 0],
    ['a video with no size and no length', withProject('asset.kadr', (p) => {
      Object.assign(Object.values(p.assets)[0] as object, { width: 0, height: 0, duration: -1 });
    }), 1],
    ['a media file missing', write('missing-media.kadr', Object.fromEntries(Object.entries(real).filter(([k], i) => !(k.startsWith('media/') && i === Object.keys(real).findIndex((x) => x.startsWith('media/')))))), 1],
  ];
  const outcomes: string[] = [];
  for (const [what, file, leftOut] of files) {
    console.log(`hostile backup: ${what}`); // which one, if it hangs
    await expect(page.locator('.toast.error')).toHaveCount(0, { timeout: 20_000 }); // the last answer is gone
    await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restore backup' }).click();
    await (await chooser).setFiles(file);
    const opened = page.locator('.preview-canvas'), refused = page.locator('.toast.error');
    await expect(opened.or(refused).first()).toBeVisible({ timeout: 60_000 });
    if (await opened.isVisible()) {
      const note = page.locator('.toast').filter({ hasText: 'could not be restored' });
      const left = (await note.count()) ? ` (${await note.first().textContent()})` : '';
      expect.soft(Number(left.match(/(\d+)\)$/)?.[1] ?? 0), `${what}: parts said to be left out`).toBe(leftOut);
      await page.waitForTimeout(1500); // let it render the first frame
      const clips = await page.locator('.tl-row .clip').count();
      // A project that opens must also work: it exports a video.
      const pr = await probe(await exportAs(page, info, 'Video', 'Export video'));
      const duration = Number(pr.format.duration), video = pr.streams.find((x) => x.codec_type === 'video')!;
      expect.soft({ ratio: video.height! / video.width!, fits: video.height! <= 1920 }, `${what}: a canvas the app makes`).toEqual({ ratio: 16 / 9, fits: true });
      outcomes.push(`${what}: opened, ${clips} clips${left}, exports ${duration.toFixed(2)} s${(await refused.count()) ? `, toast "${await refused.first().textContent()}"` : ''}`);
      expect.soft(duration, `${what}: the export has a length`).toBeGreaterThan(1);
      await page.getByRole('button', { name: 'Back to projects' }).click();
    } else {
      const text = (await refused.first().textContent()) ?? '';
      outcomes.push(`${what}: refused "${text}"`);
      // A message for people: no parser or library jargon.
      expect.soft(text, what).not.toMatch(/JSON|token|Unexpected|undefined|null|TypeError|compression|zip data|position \d/i);
      // Stopped while unpacking, not after holding all 300 MB (then it would be "damaged": the spaces are not a project).
      if (what.startsWith('a zip bomb')) expect.soft(text, what).toContain('not a Kadr project backup');
    }
    await expect(page.getByRole('button', { name: 'Open Mine', exact: true })).toBeVisible(); // the original is untouched
  }
  console.log(`hostile backups (${info.project.name}):\n${outcomes.join('\n')}`);
  expect.soft(outcomes.find((o) => o.startsWith('re-zipped')), 'a re-zipped backup still restores').toContain('opened');
  await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
});

test('files with a wrong or no extension (as messengers save them) import by what they are and export', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  const read = (n: string) => fs.readFileSync(fx(n));
  // What a browser reports for such a file: the type follows the name, and no extension means no type.
  const files = [
    { name: 'IMG_2041', mimeType: '', buffer: read('person.jpg'), kind: 'image' },
    { name: 'photo.mp4', mimeType: 'video/mp4', buffer: read('photo.png'), kind: 'image' },
    { name: 'clip.jpg', mimeType: 'image/jpeg', buffer: read('landscape.mp4'), kind: 'video' },
    { name: 'VID_0007', mimeType: '', buffer: read('portrait.mp4'), kind: 'video' },
    { name: 'scan.png', mimeType: 'image/png', buffer: read('person.jpg'), kind: 'image' },
  ];
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(files.map(({ name, mimeType, buffer }) => ({ name, mimeType, buffer })));
  const settled = async () => (await page.locator('.tl-row.main .clip').count())
    + await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.length);
  await expect.poll(settled, { timeout: 60_000 }).toBe(files.length); // each file is a clip or a refusal
  const kinds = await page.locator('.tl-row.main .clip').evaluateAll((els) => els.map((e) => (e.className.match(/clip-(\w+)/) ?? [])[1]));
  const errors = await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
  console.log(`wrong extensions (${info.project.name}): ${kinds.join(', ')}${errors.length ? `; refused: ${errors.join(' / ')}` : ''}`);
  expect(errors).toEqual([]);
  expect(kinds).toEqual(files.map((f) => f.kind));
  const pr = await probe(await exportAs(page, info, 'Video', 'Export video'));
  expect(Number(pr.format.duration)).toBeCloseTo(3 * 3 + 6 + 5, 0); // three photos of 3 s, the 6 s and 5 s videos
});

test('a photo, a 1D LUT or a zip picked as a LUT and a video or a cut font picked as a font: a clear refusal, the project is unchanged', async ({ page }, info) => {
  test.setTimeout(180_000);
  const write = (name: string, data: string | Buffer) => { const p = info.outputPath(name); fs.writeFileSync(p, data); return p; };
  const woff2 = fs.readFileSync(path.join(import.meta.dirname, '..', 'node_modules/@fontsource/press-start-2p/files/press-start-2p-latin-400-normal.woff2'));
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Text').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Kadr');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.tl-row .clip-text')).toHaveCount(1);
  await expect.poll(() => savedProject(page), { timeout: 10_000 }).toContain('"kind":"text"');
  const before = await savedProject(page);
  const pick = async (button: string, file: string) => {
    await expect(page.locator('.toast.error')).toHaveCount(0, { timeout: 20_000 });
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: button }).click();
    await (await chooser).setFiles(file);
    await expect(page.locator('.toast.error')).toBeVisible({ timeout: 20_000 });
    return (await page.locator('.toast.error').textContent()) ?? '';
  };
  const said: string[] = [];
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Filters').click();
  for (const [what, file, expected] of [
    ['a photo', fx('person.jpg'), /not a valid 3D LUT/],
    ['a 1D LUT', write('curve.cube', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n'), /1D LUTs are not supported/],
    ['a zipped LUT pack', write('pack.cube', Buffer.concat([Buffer.from('PK\x03\x04'), fs.readFileSync(fx('photo.png'))])), /not a valid 3D LUT/],
  ] as const) {
    const text = await pick('Import LUT (.cube)', file);
    said.push(`LUT, ${what}: "${text}"`);
    expect.soft(text, what).toMatch(expected);
  }
  await page.getByRole('button', { name: 'Done' }).click();
  await selectClip(page, page.locator('.tl-row .clip-text').first());
  await tool(page, 'Edit text').click();
  for (const [what, file] of [
    ['a video named .ttf', write('Video.ttf', fs.readFileSync(fx('landscape.mp4')))],
    ['half a font file', write('Cut.woff2', woff2.subarray(0, woff2.length >> 1))],
  ] as const) {
    const text = await pick('Add font', file);
    said.push(`font, ${what}: "${text}"`);
    expect.soft(text, what).toMatch(/not a font \(TTF, OTF, WOFF or WOFF2\)/);
  }
  await page.getByRole('button', { name: 'Done' }).click();
  console.log(`hostile LUTs and fonts (${info.project.name}):\n${said.join('\n')}`);
  await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
  expect(await savedProject(page), 'the project is unchanged').toBe(before);
});

// ---------- QA docs/11 §3.5: export at its edges ----------

test('export edges: cancelled midway then again, 60 and 24 fps, the shortest project (0.1 s) in every format — whole files, nothing left open', async ({ page }, info) => {
  test.setTimeout(300_000);
  const codecs = await countCodecs(page);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']); // 6 s, 30 fps, with sound
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.waitForTimeout(2500);
  const idle = (await codecs()).total;
  const save = async () => {
    await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save / Share' }).click();
    const file = info.outputPath((await dl).suggestedFilename());
    await (await dl).saveAs(file);
    return file;
  };
  const rows: string[] = [];
  let step = 'start';
  page.on('pageerror', (e) => rows.push(`uncaught during "${step}": ${e.message}`)); // where, if afterEach finds one
  // Cancelled at a third: back to the settings, the encoders and decoders it opened are closed.
  step = 'cancel';
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/([3-9]\d)% — keep this screen open/)).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByRole('button', { name: 'Export video' })).toBeVisible();
  await page.waitForTimeout(2500);
  const afterCancel = await codecs();
  rows.push(`after a cancel at a third: open ${afterCancel.total} (idle ${idle}) ${JSON.stringify(afterCancel.open)}`);
  expect.soft(afterCancel.open.VideoEncoder ?? 0, 'video encoder closed').toBe(0);
  expect.soft(afterCancel.open.AudioEncoder ?? 0, 'audio encoder closed').toBe(0);
  expect.soft(afterCancel.total, 'nothing more open than before the export').toBeLessThanOrEqual(idle);
  // Then again, at 60 fps: the whole file, every frame.
  for (const fps of [60, 24]) {
    step = `${fps} fps`;
    await page.getByRole('radio', { name: String(fps), exact: true }).click();
    await page.getByRole('button', { name: 'Export video' }).click();
    const pr = await probe(await save());
    const v = pr.streams.find((s) => s.codec_type === 'video')!;
    rows.push(`${fps} fps: ${pr.format.duration} s, ${v.nb_read_frames} frames, ${pr.streams.map((s) => s.codec_type).join('+')}`);
    expect.soft(Number(v.nb_read_frames), `${fps} fps: frames`).toBe(6 * fps);
    expect.soft(Number(pr.format.duration), `${fps} fps: length`).toBeCloseTo(6, 1);
    expect.soft(pr.streams.some((s) => s.codec_type === 'audio'), `${fps} fps: sound`).toBe(true);
    await page.getByRole('button', { name: 'Export again' }).click();
  }
  await page.getByRole('button', { name: 'Done' }).click();
  // The shortest project the timeline allows: 0.1 s (three frames at 30 fps). Select first: a click on a clip moves the playhead.
  step = 'split at 0.1 s';
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 6; });
  await expect.poll(() => time(page)).toBe('0:00.1');
  await tool(page, 'Split').click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  await selectClip(page, page.locator('.tl-row.main .clip').nth(1));
  await tool(page, 'Delete').click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  step = '0.1 s video';
  const video = await probe(await exportAs(page, info, 'Video', 'Export video'));
  const v = video.streams.find((s) => s.codec_type === 'video')!;
  rows.push(`0.1 s video: ${video.format.duration} s, ${v.nb_read_frames} frames, ${video.streams.map((s) => s.codec_type).join('+')}`);
  expect.soft(Number(v.nb_read_frames), '0.1 s: frames').toBe(3);
  expect.soft(Number(video.format.duration), '0.1 s: length').toBeLessThan(0.2);
  step = '0.1 s audio';
  const audio = await probe(await exportAs(page, info, 'Audio', 'Export audio'));
  rows.push(`0.1 s audio: ${audio.format.duration} s`);
  expect.soft(Number(audio.format.duration), '0.1 s audio: length').toBeCloseTo(0.1, 1);
  step = '0.1 s GIF';
  const gif = await probe(await exportAs(page, info, 'GIF', 'Export GIF'));
  rows.push(`0.1 s GIF: ${gif.streams[0]?.nb_read_frames} frames`);
  expect.soft(Number(gif.streams[0]?.nb_read_frames), '0.1 s GIF: frames').toBeGreaterThanOrEqual(1);
  step = '0.1 s photo';
  const photo = await probe(await exportAs(page, info, 'Photo', 'Save photo'));
  rows.push(`0.1 s photo: ${photo.streams[0]?.width}×${photo.streams[0]?.height}`);
  expect.soft(photo.streams[0]?.width, '0.1 s photo').toBeGreaterThan(0);
  console.log(`export edges (${info.project.name}):\n${rows.join('\n')}`);
});

test('a word wider than the frame (a long Russian word, a hashtag, a row of emoji, Chinese without spaces) stays inside the frame', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  /** Leftmost and rightmost columns with text (bright on the black canvas), of 270. */
  const span = (g: Buffer) => {
    let lo = 270, hi = -1;
    for (let y = 0; y < 480; y++) for (let x = 0; x < 270; x++) if (g[y * 270 + x] > 60) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    return [lo, hi];
  };
  const rows: string[] = [];
  let first = true;
  for (const text of ['Достопримечательности', '#путешествиявроссиизимой2026', '🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥', '我们今天去看看这座城市最有名的地方吧']) {
    await tool(page, first ? 'Text' : 'Edit text').click();
    first = false;
    await page.getByRole('textbox', { name: 'Text', exact: true }).fill(text);
    await page.getByRole('button', { name: 'Done' }).click();
    await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 1.5 * 60; }); // past the entrance animation
    const [lo, hi] = span(await photo(page, info));
    rows.push(`${text}: columns ${lo}–${hi} of 270`);
    expect.soft(lo, `${text}: left edge`).toBeGreaterThan(2);
    expect.soft(hi, `${text}: right edge`).toBeLessThan(267);
    await selectClip(page, page.locator('.tl-row .clip-text').first());
  }
  console.log(`long words (${info.project.name}):\n${rows.join('\n')}`);
});

test('extreme speeds, 10× and 0.1×: the file is as long as the timeline, shows the right source frames and keeps the tone at its pitch', async ({ page }, info) => {
  test.setTimeout(420_000);
  test.skip(!fs.existsSync(fx('counter.mp4')), 'needs npm run fixtures');
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4', 'counter.mp4']); // 6 s each, frame N in binary, a 440 Hz tone
  await expect(main).toHaveCount(2);
  for (const [i, key] of [[0, 'End'], [1, 'Home']] as const) { // the slider's ends: 10× and 0.1×
    await selectClip(page, main.nth(i));
    await tool(page, 'Speed').click();
    await page.getByRole('slider', { name: 'Speed' }).press(key);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 120_000 });
  }
  // A: 0–0.6 s, source frame 10k. B: 0.6–60.6 s, each source frame for 10 frames.
  const source = (k: number) => (k < 18 ? 10 * k : Math.floor((k - 18) / 10 + 1e-6));
  const video = await exportAs(page, info, 'Video', 'Export video');
  const pr = await probe(video);
  const rows = [`duration ${pr.format.duration} s, ${pr.streams.find((s) => s.codec_type === 'video')!.nb_read_frames} frames`];
  expect.soft(Number(pr.format.duration), 'length').toBeCloseTo(60.6, 1);
  for (const k of [0, 5, 17, 18, 33, 1018, 1817]) {
    const got = await counterAt(video, k);
    rows.push(`frame ${k}: ${got} (expected ${source(k)})`);
    expect.soft(got, `frame ${k}`).toBe(source(k));
  }
  // The tone in each part: there, and at 440 Hz (natural pitch), not 4400 or 44.
  const pcm = await samples(video);
  for (const [what, from, to] of [['10×', 0.1, 0.5], ['0.1× early', 5, 15], ['0.1× late', 50, 60]] as const) {
    const x = pcm.subarray(Math.round(from * 48000), Math.round(to * 48000));
    let crossings = 0, sq = 0;
    for (let i = 1; i < x.length; i++) { if ((x[i - 1] < 0) !== (x[i] < 0)) crossings++; sq += x[i] * x[i]; }
    const hz = crossings / 2 / (to - from), rms = Math.sqrt(sq / x.length);
    rows.push(`${what}: ${hz.toFixed(0)} Hz, rms ${rms.toFixed(3)}`);
    expect.soft(rms, `${what}: the tone is there`).toBeGreaterThan(0.05);
    expect.soft(Math.abs(hz - 440), `${what}: pitch`).toBeLessThan(30);
  }
  console.log(`extreme speeds (${info.project.name}):\n${rows.join('\n')}`);
});

test('a clip trimmed shorter than its fades still reaches full level in the middle (preview and export share the fades)', async ({ page }, info) => {
  test.setTimeout(240_000);
  test.skip(!fs.existsSync(fx('counter.mp4')), 'needs npm run fixtures');
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']); // 6 s, a steady 440 Hz tone (rms 0.088)
  await expect(main).toHaveCount(1);
  await selectClip(page, main.first());
  await tool(page, 'Volume').click();
  for (const name of ['Fade in', 'Fade out']) await page.getByRole('slider', { name, exact: true }).press('End'); // 3 s each
  await page.getByRole('button', { name: 'Done' }).click();
  // Trim the end from 6 s to about 2 s (60 px per second), with the end in view.
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 3.5 * 60; });
  const h = (await main.first().getByLabel('Trim end').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 - 240, h.y + h.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect.poll(async () => (await main.first().boundingBox())!.width).toBeLessThan(150);
  const file = await exportAs(page, info, 'Audio', 'Export audio', { loudness: false });
  const pcm = await samples(file);
  let peak = 0;
  for (let i = 0; i + 960 <= pcm.length; i += 480) { // 20 ms windows
    let sq = 0;
    for (let k = i; k < i + 960; k++) sq += pcm[k] * pcm[k];
    peak = Math.max(peak, Math.sqrt(sq / 960));
  }
  const length = pcm.length / 48000;
  console.log(`trimmed fades (${info.project.name}): ${length.toFixed(2)} s, loudest 20 ms rms ${peak.toFixed(4)} of 0.0884`);
  expect(length).toBeLessThan(3);
  expect(peak, 'the tone reaches full level').toBeGreaterThan(0.8 * 0.0884);
});

// ---------- QA docs/11 §1.3: files as phones make them ----------

test('files as phones make them — a rotated portrait recording, variable frame rate, mono 44.1 kHz, 5.1 and no sound — play and export right', async ({ page }, info) => {
  test.setTimeout(360_000);
  const files = ['rotated.mp4', 'vfr.mp4', 'mono44.mp4', 'surround.mp4', 'silent.mp4'];
  test.skip(!files.every((f) => fs.existsSync(fx(f))), 'needs npm run fixtures');
  const { execFileSync } = await import('node:child_process');
  await page.addInitScript(() => localStorage.setItem('kadr.iosVideoTip.v3', '1'));
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', files); // on the timeline: 0–4, 4–10, 10–14, 14–18, 18–22 s
  await expect(main).toHaveCount(5, { timeout: 60_000 });
  const rows: string[] = [];
  const video = await exportAs(page, info, 'Video', 'Export video', { loudness: false });
  const pr = await probe(video);
  rows.push(`duration ${pr.format.duration} s, ${pr.streams.map((s) => s.codec_type).join('+')}`);
  expect.soft(Number(pr.format.duration), 'length').toBeCloseTo(22, 1);
  // Rotated: upright and filling the 9:16 frame — the white mark at the top left, no black bands.
  const frame = execFileSync('ffmpeg', ['-v', 'error', '-ss', '2', '-i', video, '-frames:v', '1', '-vf', 'scale=90:160,format=gray', '-f', 'rawvideo', '-']);
  const at = (x: number, y: number) => frame[y * 90 + x];
  const blackRows = Array.from({ length: 160 }, (_, y) => y).filter((y) => Array.from({ length: 90 }, (_, x) => at(x, y)).every((v) => v < 30)).length;
  rows.push(`rotated: top left ${at(8, 8)}, top right ${at(81, 8)}, bottom left ${at(8, 151)}, black rows ${blackRows}/160`);
  expect.soft(at(8, 8), 'rotated: the mark is at the top left').toBeGreaterThan(200);
  expect.soft(Math.max(at(81, 8), at(8, 151)), 'rotated: nowhere else').toBeLessThan(170);
  expect.soft(blackRows, 'rotated: fills the frame').toBeLessThan(4);
  // VFR: at every output frame, the source frame shown is the latest one at or before that moment.
  const pts = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'packet=pts_time', '-of', 'csv=p=0', fx('vfr.mp4')])
    .toString().trim().split('\n').map(Number).sort((a, b) => a - b);
  const expected = (t: number) => pts.filter((p) => p <= t + 1e-4).length - 1;
  for (const local of [0, 1.9, 2.0, 2.1, 3.0, 3.97, 4.0, 4.03, 5.0, 5.97]) {
    const k = Math.round((4 + local) * 30);
    const got = await counterAt(video, k);
    rows.push(`vfr ${local.toFixed(2)} s: ${got} (expected ${expected(k / 30 - 4)})`);
    expect.soft(got, `vfr at ${local} s`).toBe(expected(k / 30 - 4));
  }
  // Sound: each part at its pitch and level; mono and 5.1 are heard, the silent file is silent.
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', video, '-ac', '2', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 64 << 20 });
  const lr = new Float32Array(raw.buffer, raw.byteOffset, raw.byteLength / 4); // L, R, L, R…
  for (const [what, from, to, hz] of [['mono 44.1 kHz', 10.5, 13.5, 330], ['5.1', 14.5, 17.5, 330], ['no sound', 18.5, 21.5, 0]] as const) {
    const [a, b] = [Math.round(from * 48000), Math.round(to * 48000)];
    let crossings = 0, peak = 0;
    const sq = [0, 0];
    for (let i = a; i < b; i++) {
      for (const c of [0, 1]) { const v = lr[2 * i + c]; sq[c] += v * v; peak = Math.max(peak, Math.abs(v)); }
      if (i > a && (lr[2 * i - 2] < 0) !== (lr[2 * i] < 0)) crossings++;
    }
    const f = crossings / 2 / (to - from), [l, r] = sq.map((v) => Math.sqrt(v / (b - a)));
    rows.push(`${what}: ${f.toFixed(0)} Hz, rms L ${l.toFixed(3)} R ${r.toFixed(3)}, peak ${peak.toFixed(3)}`);
    if (hz) {
      expect.soft(Math.abs(f - hz), `${what}: pitch`).toBeLessThan(10);
      expect.soft(Math.min(l, r), `${what}: heard in both ears`).toBeGreaterThan(0.04);
      expect.soft(peak, `${what}: not clipped`).toBeLessThan(0.99);
    } else expect.soft(Math.max(l, r), `${what}: silent`).toBeLessThan(0.001);
  }
  console.log(`phone files (${info.project.name}):\n${rows.join('\n')}`);
});

// ---------- QA docs/11 §3.7: the speech model does not stay in memory ----------

test('the speech model is let go: alive after captions, gone when an export starts and after a minute idle; captions again still work', async ({ page }, info) => {
  test.setTimeout(480_000);
  const asr = () => page.workers().filter((w) => /asr/i.test(w.url())).length;
  // Resident memory of the Chromium renderers (one worker runs the tests, so they are this page's; a dedicated
  // worker's model lives in its page's process).
  const rss = async (): Promise<number | null> => {
    if (info.project.name !== 'android-chromium') return null;
    const { execFileSync } = await import('node:child_process');
    const kb = execFileSync('ps', ['-axo', 'rss=,command=']).toString().split('\n')
      .filter((l) => l.includes('chrome-headless-shell') && l.includes('--type=renderer'))
      .reduce((a, l) => a + (Number(l.trim().split(/\s+/)[0]) || 0), 0);
    return Math.round(kb / 1024);
  };
  const rows: string[] = [];
  await newProject(page);
  await importFiles(page, 'Media', ['speech_en.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  rows.push(`before: ${await rss() ?? '—'} MB`);
  await tool(page, 'Captions').click(); // one tap on the selected clip
  const caption = page.locator('.clip-caption');
  await expect(caption).toHaveCount(1, { timeout: 300_000 });
  await expect.poll(asr, { message: 'the model is kept right after captions' }).toBe(1);
  rows.push(`after captions, worker alive: ${await rss() ?? '—'} MB`);
  await page.getByRole('button', { name: 'Done' }).click();
  await exportAs(page, info, 'Video', 'Export video');
  await expect.poll(asr, { message: 'an export lets the model go' }).toBe(0);
  rows.push(`after an export: ${await rss() ?? '—'} MB`);
  // The files stay in the browser cache: captions again need no download and work.
  await selectClip(page, page.locator('.tl-row.main .clip').first());
  await tool(page, 'Captions').click();
  await page.getByRole('button', { name: 'Create again…' }).click();
  await page.getByRole('button', { name: 'Create captions' }).click();
  await expect(page.getByRole('button', { name: 'Save as .srt' })).toBeVisible({ timeout: 300_000 });
  await expect(caption).toHaveCount(1);
  expect(asr(), 'the model is back for the new captions').toBe(1);
  await expect.poll(asr, { message: 'a minute without requests lets it go', timeout: 90_000, intervals: [5000] }).toBe(0);
  rows.push(`a minute idle after captions again: ${await rss() ?? '—'} MB`);
  console.log(`speech model memory (${info.project.name}):\n${rows.join('\n')}`);
});

// ---------- QA docs/11 §1.6: an export never waits forever on the device ----------

test('an export never waits forever: an encoder probe that never answers and storage that never opens — the video is still made', async ({ page }, info) => {
  test.setTimeout(240_000);
  // As a busy phone can: the page's first audio encoder (the delay probe) takes frames and never answers, and the
  // file system never opens the export file. Once, an export after a reload stood at 0% for good (1 run in 7).
  await page.addInitScript(() => {
    const w = window as unknown as { AudioEncoder?: typeof AudioEncoder; __hung: number };
    w.__hung = 0;
    const Real = w.AudioEncoder;
    if (Real) {
      let first = true;
      w.AudioEncoder = class extends Real {
        constructor(init: AudioEncoderInit) {
          const hang = first;
          first = false;
          super(hang ? { output: () => undefined, error: () => undefined } : init);
          if (hang) { w.__hung++; this.encode = () => undefined; this.flush = () => new Promise<void>(() => undefined); }
        }
      };
    }
    const proto = (window as unknown as { FileSystemFileHandle?: { prototype: Record<string, unknown> } }).FileSystemFileHandle?.prototype;
    if (proto && 'createWritable' in proto) proto.createWritable = () => { w.__hung++; return new Promise(() => undefined); };
  });
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']); // 6 s, picture and a tone
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const started = Date.now();
  const pr = await probe(await exportAs(page, info, 'Video', 'Export video'));
  const took = (Date.now() - started) / 1000;
  const hung = await page.evaluate(() => (window as unknown as { __hung: number }).__hung);
  console.log(`export with a hung probe and storage (${info.project.name}): ${hung} parts hung, made in ${took.toFixed(1)} s, ${Number(pr.format.duration).toFixed(2)} s long`);
  expect(hung, 'something was actually held up').toBeGreaterThan(0);
  expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Math.abs(Number(pr.format.duration) - 6)).toBeLessThan(0.1);
  expect(took, 'the waits are bounded').toBeLessThan(60);
});

// ---------- QA docs/11 §1.6: a sound decoder that fails for a moment ----------

test('a sound decoder that fails once (as WebKit\'s both did under load) does not cost a video its sound; one that never works says so', async ({ page }, info) => {
  test.setTimeout(240_000);
  // Both of the page's sound decoders refuse while `__decodeFails` lasts, with the errors WebKit gave in a loaded run:
  // WebCodecs "InternalAudioDecoderCocoa decoding failed", then decodeAudioData "Decoding failed".
  await page.addInitScript(() => {
    const w = window as unknown as { __decodeFails: { webcodecs: number; native: number }; AudioDecoder?: typeof AudioDecoder };
    w.__decodeFails = { webcodecs: 0, native: 0 };
    const Real = w.AudioDecoder;
    if (Real) {
      w.AudioDecoder = class extends Real {
        constructor(init: AudioDecoderInit) {
          super(init);
          if (w.__decodeFails.webcodecs > 0) {
            w.__decodeFails.webcodecs--;
            this.decode = () => { throw new DOMException('InternalAudioDecoderCocoa decoding failed', 'EncodingError'); };
          }
        }
      };
    }
    const real = BaseAudioContext.prototype.decodeAudioData;
    BaseAudioContext.prototype.decodeAudioData = function (this: BaseAudioContext, ...a: Parameters<typeof real>) {
      if (w.__decodeFails.native > 0) { w.__decodeFails.native--; return Promise.reject(new DOMException('Decoding failed', 'EncodingError')); }
      return real.apply(this, a);
    } as typeof real;
  });
  const fail = (n: number) => page.evaluate((k) => { (window as unknown as { __decodeFails: object }).__decodeFails = { webcodecs: k, native: k }; }, n);
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  // Once: a moment later both decoders work again.
  await fail(1);
  await importFiles(page, 'Media', ['landscape.mp4']); // 6 s with a 440 Hz tone
  await expect(main).toHaveCount(1);
  const once = await loudnessOf(await exportAs(page, info, 'Audio', 'Export audio', { loudness: false }));
  console.log(`decoder that fails once (${info.project.name}): the video's sound at ${once.lufs.toFixed(1)} LUFS`);
  expect.soft(once.lufs, 'a decoder that failed once: the sound is kept').toBeGreaterThan(-30);
  // Never (a project of its own, so no other clip's sound is being decoded meanwhile): the video is still added, and a
  // note says it came without its sound.
  await newProject(page);
  await fail(1000);
  await importFiles(page, 'Media', ['portrait.mp4']);
  await expect(main).toHaveCount(1);
  const note = page.locator('.toast').filter({ hasText: 'without sound' });
  await expect(note).toBeVisible({ timeout: 20_000 });
  const said = (await note.textContent()) ?? '';
  console.log(`decoder that never works (${info.project.name}): "${said}"`);
  expect(said).toContain('portrait.mp4');
});
