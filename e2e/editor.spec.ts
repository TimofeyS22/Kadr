import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
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
test.afterEach(async ({ page }) => {
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
  await expect(page.getByText('Background removed', { exact: false })).toBeVisible({ timeout: 60_000 });
});

// ---------- Every tool, end to end ----------

const sheet = (page: Page) => page.locator('.sheet');
const mainVideo = (page: Page) => page.locator('.tl-row.main .clip-video').first();
/** Selects a timeline clip (a tap on an already selected clip would deselect it). */
async function selectClip(page: Page, clip: ReturnType<Page['locator']>) {
  if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
  await expect(clip).toHaveClass(/ sel/);
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
  await tool(page, 'Captions').click();
  await page.getByRole('button', { name: 'Create captions' }).click();
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
  return { lufs: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)![1]), peak: Number(/Peak:\s+(-?[\d.]+) dBFS/.exec(summary)![1]) };
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
