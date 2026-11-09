// Filter, colour and effect sheets (owner's request, 2026-11-09): tiles show the clip's own frame through the look, one
// tap gives the look to every piece, Before / after shows the clip without it, and the sheet works one-handed at 375 px.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const sheet = (page: Page) => page.locator('.sheet');
const pageErrors: string[] = [];

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
    const made: WebGLRenderingContext[] = ((window as unknown as { __gl: WebGLRenderingContext[] }).__gl = []);
    const get = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, ...a: unknown[]) {
      const c = (get as (...x: unknown[]) => unknown).apply(this, a);
      if (String(a[0]).startsWith('webgl') && c && !made.includes(c as WebGLRenderingContext)) made.push(c as WebGLRenderingContext);
      return c;
    } as typeof get;
  });
});
test.afterEach(() => { expect(pageErrors, 'uncaught errors in the page').toEqual([]); });

async function openWith(page: Page, files: string[]) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(files.map(fx));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(files.length);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
}
async function select(page: Page, n: number) {
  const clip = page.locator('.tl-row.main .clip').nth(n);
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}

type Rgb = [number, number, number];
/** Mean colour and mean |R−G|+|G−B| of a tile: 0 for gray. */
const tileColour = (page: Page, name: string) => page.getByRole('radio', { name, exact: true }).locator('canvas').evaluate((c: HTMLCanvasElement) => {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  let r = 0, g = 0, b = 0, chroma = 0;
  const n = d.length / 4;
  for (let i = 0; i < d.length; i += 4) { r += d[i]; g += d[i + 1]; b += d[i + 2]; chroma += Math.abs(d[i] - d[i + 1]) + Math.abs(d[i + 1] - d[i + 2]); }
  return { mean: [r / n, g / n, b / n] as Rgb, chroma: chroma / n };
});
const tilePainted = (page: Page, name: string) => expect.poll(async () => (await tileColour(page, name)).mean.reduce((x, y) => x + y), { message: `${name} is painted` }).toBeGreaterThan(30);

/** Mean colour distance between neighbouring channels in a screenshot of the preview: how colourful it looks. */
async function previewChroma(page: Page) {
  const shot = await page.locator('.preview-canvas').screenshot({ type: 'png' });
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', 'pipe:0', '-vf', 'scale=64:36', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { input: shot, maxBuffer: 1 << 20 });
  let sum = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) sum += Math.abs(raw[i] - raw[i + 1]) + Math.abs(raw[i + 1] - raw[i + 2]);
  return sum / (raw.length / 3);
}

async function exported(page: Page, info: TestInfo, name: string) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 180_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath(name);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}
/** How colourful the file is at second `t`: mean of U and V away from neutral. */
function fileChroma(file: string, t: number) {
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=64:36,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  let sum = 0;
  for (let i = 0; i + 2 < raw.length; i += 3) sum += Math.abs(raw[i] - raw[i + 1]) + Math.abs(raw[i + 1] - raw[i + 2]);
  return sum / (raw.length / 3);
}

test('filter tiles show the clip\'s own frame through each filter, and a tile picks it', async ({ page }) => {
  await openWith(page, ['landscape.mp4']);
  await select(page, 0);
  await tool(page, 'Filters').click();
  await expect(sheet(page)).toBeVisible();
  await tilePainted(page, 'None');
  const none = await tileColour(page, 'None');
  expect(none.chroma, 'the frame is colourful').toBeGreaterThan(30);
  await page.locator('.pick-cat', { hasText: 'B&W' }).click();
  await tilePainted(page, 'Noir');
  const noir = await tileColour(page, 'Noir');
  // The default intensity is 80%: most of the colour goes, not all of it.
  expect(noir.chroma, 'Noir takes the colour out').toBeLessThan(none.chroma * 0.5);
  const before = await previewChroma(page);
  await page.getByRole('radio', { name: 'Noir' }).click();
  await expect(page.getByRole('radio', { name: 'Noir' })).toBeChecked();
  await expect.poll(() => previewChroma(page), { message: 'the picture took the filter' }).toBeLessThan(before * 0.5);
});

test('a tile matches what the export gives for that filter', async ({ page }, info) => {
  test.setTimeout(180_000);
  await openWith(page, ['landscape.mp4']);
  await select(page, 0);
  await tool(page, 'Filters').click();
  await page.locator('.pick-cat', { hasText: 'Mood' }).click();
  await tilePainted(page, 'Cyber');
  const tile = await tileColour(page, 'Cyber');
  await page.getByRole('radio', { name: 'Cyber' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const file = await exported(page, info, 'cyber.mp4');
  const t = 3; // the tile's frame is the middle of the 6 s clip
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=64:36,format=rgb24', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 });
  const mean: Rgb = [0, 0, 0];
  for (let i = 0; i + 2 < raw.length; i += 3) for (const c of [0, 1, 2]) mean[c] += raw[i + c];
  const n = raw.length / 3;
  const distance = Math.max(...mean.map((v, c) => Math.abs(v / n - tile.mean[c])));
  console.log(`tile vs export (${info.project.name}): tile ${tile.mean.map(Math.round).join(',')}, file ${mean.map((v) => Math.round(v / n)).join(',')}`);
  expect(distance, 'the mean colour of the tile and of the exported frame').toBeLessThan(14);
});

test('one tap gives the look to every piece, one undo takes it back, and the file shows it on all of them', async ({ page }, info) => {
  test.setTimeout(240_000);
  await openWith(page, ['landscape.mp4', 'portrait.mp4']);
  await select(page, 0);
  await tool(page, 'Filters').click();
  await page.locator('.pick-cat', { hasText: 'B&W' }).click();
  await page.getByRole('radio', { name: 'Mono' }).click();
  await page.getByRole('button', { name: 'Apply to all pieces (2)' }).click();
  await expect(page.locator('.toast')).toContainText('Applied to all pieces: 2');
  await page.getByRole('button', { name: 'Done' }).click();
  const file = await exported(page, info, 'all.mp4');
  const [first, second] = [fileChroma(file, 1), fileChroma(file, 8)];
  console.log(`colour with the look on all (${info.project.name}): first piece ${Math.round(first)}, second ${Math.round(second)}`);

  await page.getByRole('button', { name: 'Undo' }).click();
  const back = await exported(page, info, 'undone.mp4');
  expect(Math.abs(fileChroma(back, 1) - first), 'the piece the filter was picked on keeps it').toBeLessThan(first * 0.2 + 5);
  expect(fileChroma(back, 8), 'one undo: the other piece has its colour back, so the look had reached it').toBeGreaterThan(second * 2);
});

test('Effects and Adjust give their own part to all pieces; a single piece offers no such button', async ({ page }) => {
  await openWith(page, ['landscape.mp4', 'portrait.mp4']);
  await select(page, 1);
  await tool(page, 'Effects').click();
  await page.getByRole('radio', { name: 'VHS', exact: true }).click();
  await page.getByRole('button', { name: 'Apply to all pieces (2)' }).click();
  await expect(page.locator('.toast').first()).toContainText('Applied to all pieces');
  await page.getByRole('button', { name: 'Done' }).click();
  const stored = () => page.evaluate(async () => {
    const id = /#\/p\/([\w-]+)/.exec(location.hash)![1];
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const p = await new Promise<{ tracks: { kind: string; clips: { effect?: { id: string }; adjust: { contrast: number } }[] }[] }>((res) => { const r = db.transaction('kv').objectStore('kv').get(`p:${id}`); r.onsuccess = () => res(r.result); });
    db.close();
    return p.tracks.find((t) => t.kind === 'main')!.clips;
  });
  await expect.poll(async () => (await stored()).map((c) => c.effect?.id)).toEqual(['vhs', 'vhs']);

  await tool(page, 'Adjust').click();
  await page.getByRole('radio', { name: 'Contrast', exact: true }).click();
  const slider = sheet(page).getByRole('slider', { name: 'Contrast' });
  await slider.focus();
  for (let i = 0; i < 20; i++) await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Contrast', exact: true })).toContainText('+20');
  await page.getByRole('button', { name: 'Apply to all pieces (2)' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(async () => (await stored()).map((c) => Math.round(c.adjust.contrast * 100))).toEqual([20, 20]);

  await openWith(page, ['landscape.mp4']);
  await select(page, 0);
  await tool(page, 'Filters').click();
  await expect(sheet(page)).toBeVisible();
  await expect(page.getByRole('button', { name: /Apply to all/ })).toHaveCount(0);
});

test('holding Before / after shows the clip without its look; letting go brings it back', async ({ page }) => {
  await openWith(page, ['landscape.mp4']);
  await select(page, 0);
  await tool(page, 'Filters').click();
  await expect(sheet(page)).toBeVisible();
  const original = await previewChroma(page);
  await page.locator('.pick-cat', { hasText: 'B&W' }).click();
  await page.getByRole('radio', { name: 'Noir' }).click();
  await expect.poll(() => previewChroma(page)).toBeLessThan(original * 0.5);
  const hold = page.getByRole('button', { name: 'Hold to see the clip without this look' });
  const box = (await hold.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await expect.poll(() => previewChroma(page), { message: 'held: the original' }).toBeGreaterThan(original * 0.85);
  await page.mouse.up();
  await expect.poll(() => previewChroma(page), { message: 'released: the look' }).toBeLessThan(original * 0.5);
});

test('in Russian, the longest button stays inside its half of a 375 px sheet', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.addInitScript(() => localStorage.setItem('kadr.locale', 'ru'));
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Медиа').click();
  await (await chooser).setFiles(['landscape.mp4', 'portrait.mp4'].map(fx));
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
  const close = page.getByRole('button', { name: 'Закрыть инструменты' });
  if (await close.isVisible()) await close.click();
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await tool(page, 'Фильтры').click();
  const apply = page.getByRole('button', { name: 'Применить ко всем кускам (2)' });
  await expect(apply).toBeVisible();
  const fits = await apply.evaluate((b) => b.scrollWidth <= b.clientWidth);
  expect(fits, 'no word is cut').toBe(true);
  expect((await apply.boundingBox())!.height, 'at most two lines').toBeLessThanOrEqual(72);
  await page.screenshot({ path: info.outputPath('ru.png') });
});

test('a long press does not select the words on a button (seen on a real iPhone)', async ({ page }) => {
  await page.goto('./');
  const b = page.getByRole('button', { name: 'Try a sample' });
  await expect(b).toBeVisible();
  expect(await b.evaluate((el) => { const s = getComputedStyle(el); return s.userSelect || s.webkitUserSelect; })).toBe('none');
});

test('at 375 px: nothing scrolls sideways, every control is big enough, the picture stays in view, and the tiles\' GPU context goes with the sheet', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await openWith(page, ['landscape.mp4', 'portrait.mp4']);
  await select(page, 0);
  // The app keeps a few contexts of its own (the preview, capability checks): the sheet may add to them only while open.
  const alive = () => page.evaluate(() => (window as unknown as { __gl: WebGLRenderingContext[] }).__gl.filter((g) => !g.isContextLost()).length);
  const baseline = await alive();
  for (const name of ['Filters', 'Adjust', 'Effects']) {
    await tool(page, name).click();
    await expect(sheet(page)).toBeVisible();
    await tilePainted(page, name === 'Adjust' ? 'Exposure' : 'None');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${name}: no sideways scroll`).toBe(true);
    for (const el of await sheet(page).locator('.look-actions button').all()) expect((await el.boundingBox())!.height, `${name}: ${await el.textContent()}`).toBeGreaterThanOrEqual(44);
    const pic = (await page.locator('.preview-canvas').boundingBox())!;
    expect(pic.height, `${name}: the picture is in view`).toBeGreaterThan(150);
    await page.screenshot({ path: info.outputPath(`${name}.png`) });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(sheet(page)).toHaveCount(0);
    await expect.poll(alive, { message: `${name}: the tiles' context is gone` }).toBe(baseline);
  }
});
