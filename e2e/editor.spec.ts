import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const pageErrors: string[] = [];
test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
  });
  page.on('pageerror', (e) => pageErrors.push(e.message));
});
test.afterEach(async ({ page }) => {
  expect(pageErrors, 'uncaught errors in the page').toEqual([]);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

async function newProject(page: Page) {
  await page.goto('/');
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
  await page.goto('/');
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
