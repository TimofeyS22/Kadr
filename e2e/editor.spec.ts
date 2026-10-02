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
  expect(changed(hidden, await photo(page, info), 20)).toBeGreaterThan(0.01); // the area hides more
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

test('camera with teleprompter scrolls the script, records a mirrored clip onto the main track and releases the camera', async ({ page }, info) => {
  test.setTimeout(120_000);
  // A synthetic camera: white left half, black right half, a moving strip on top, plus a tone, so the test runs headless.
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
  await tool(page, 'Transform').click();
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
