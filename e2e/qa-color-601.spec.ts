// Colours of a BT.601 video (audit V-243): WebKit, the engine of every iPhone browser, decodes it with the BT.709
// matrix and labels the frames bt709, so saturated colours moved by up to 20 levels in the preview and in every file.
// Every way a frame becomes pixels is checked against ffmpeg's decode of the file: the preview, a photo, the video, a
// freeze frame and a reversed clip. HDR freeze frames and reversed clips are checked against the clip itself.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
type Rgb = number[];
/** Mean colour of the four bands across the middle rows, in RGB before any scaling (chroma must not mix bands). */
const bands = (args: string[], input?: Buffer): Rgb[] => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', ...args, '-frames:v', '1', '-vf', 'format=rgb24,crop=iw:ih*0.5:0:ih*0.25,scale=4:1:flags=area', '-f', 'rawvideo', '-'], { input });
  return [0, 1, 2, 3].map((i) => [...raw.subarray(i * 3, i * 3 + 3)]);
};
const TRUTH = bands(['-ss', '1', '-i', fx('bt601.mp4')]);
const MAX_OFF = 6;
const off = (a: Rgb[], b: Rgb[]) => Math.max(...a.flatMap((c, i) => c.map((v, k) => Math.abs(v - b[i][k]))));

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
});

async function open(page: Page, file: string, aspect = '16:9') {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: aspect }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(fx(file));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
}
async function select(page: Page) {
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
}
async function save(page: Page, info: TestInfo, format: 'Photo' | 'Video', name: string) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: format, exact: true }).click();
  if (format === 'Video') await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: format === 'Photo' ? 'Save photo' : 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath(name);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}
/** Moves the playhead to `s` seconds (the timeline scrolls 60 px a second at the default zoom). */
const seek = (page: Page, s: number) => page.locator('.tl-scroll').evaluate((el, px) => { el.scrollLeft = px; }, s * 60);

test('a BT.601 video keeps its colours in the preview, a photo, the video, a freeze frame and a reversed clip', async ({ page }, info) => {
  test.setTimeout(240_000);
  await open(page, 'bt601.mp4');
  await seek(page, 1);
  await page.waitForTimeout(600);
  const preview = bands(['-i', 'pipe:0'], await page.locator('.preview-canvas').screenshot());
  const photo = bands(['-i', await save(page, info, 'Photo', 'photo.jpg')]);
  const video = bands(['-ss', '1', '-i', await save(page, info, 'Video', 'video.mp4')]);
  await seek(page, 1);
  await select(page);
  await tool(page, 'Freeze').click();
  await expect(page.locator('.tl-row.main .clip-image')).toHaveCount(1, { timeout: 30_000 }); // the still, at the playhead
  await seek(page, 1.5);
  const freeze = bands(['-i', await save(page, info, 'Photo', 'freeze.jpg')]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.tl-row.main .clip-image')).toHaveCount(0);
  await select(page);
  await tool(page, 'Reverse').click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 120_000 });
  await seek(page, 1);
  const reversed = bands(['-i', await save(page, info, 'Photo', 'reversed.jpg')]);
  const seen = { preview, photo, video, freeze, reversed };
  console.log(`BT.601 (${info.project.name}): truth ${JSON.stringify(TRUTH)}\n${Object.entries(seen).map(([k, v]) => `  ${k} ${JSON.stringify(v)} off ${off(v, TRUTH)}`).join('\n')}`);
  for (const [k, v] of Object.entries(seen)) expect.soft(off(v, TRUTH), `${k}: the largest difference from ffmpeg's decode, levels`).toBeLessThanOrEqual(MAX_OFF);
});

test('an HDR clip\'s freeze frame and reversed clip look like the clip, not like its raw signal', async ({ page }, info) => {
  test.setTimeout(240_000);
  test.skip(info.project.name !== 'iphone-webkit', 'Playwright\'s Chromium has no HEVC decoder');
  test.skip(!fs.existsSync(fx('iphone_hdr.mov')), 'needs ffmpeg with libx265 (npm run fixtures)');
  await open(page, 'iphone_hdr.mov', '9:16');
  await seek(page, 1);
  await page.waitForTimeout(600);
  const mean = (f: string) => { const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', f, '-frames:v', '1', '-vf', 'format=rgb24,scale=1:1:flags=area', '-f', 'rawvideo', '-']); return [...raw]; };
  const clip = mean(await save(page, info, 'Photo', 'clip.jpg'));
  await select(page);
  await tool(page, 'Freeze').click();
  await expect(page.locator('.tl-row.main .clip-image')).toHaveCount(1, { timeout: 30_000 });
  await seek(page, 1.5);
  const freeze = mean(await save(page, info, 'Photo', 'freeze.jpg'));
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(page.locator('.tl-row.main .clip-image')).toHaveCount(0);
  await select(page);
  await tool(page, 'Reverse').click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 120_000 });
  await seek(page, 1);
  const reversed = mean(await save(page, info, 'Photo', 'reversed.jpg'));
  console.log(`HDR (${info.project.name}): clip ${clip} freeze ${freeze} reversed ${reversed}`);
  const diff = (a: number[], b: number[]) => Math.max(...a.map((v, i) => Math.abs(v - b[i])));
  // Before v1.8 both held the raw HLG signal: 6 levels darker on this dim clip (40 → 34).
  expect.soft(diff(freeze, clip), 'the freeze frame is the clip\'s own picture').toBeLessThanOrEqual(3);
  expect.soft(diff(reversed, clip), 'the reversed clip has the clip\'s colours').toBeLessThanOrEqual(3);
});
