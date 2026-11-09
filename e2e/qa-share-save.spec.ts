// The last step on a phone (audit V-180): the finished file goes to the share sheet. Every other test turns the sheet off
// and takes the download path. Here the browser's share is replaced at its boundary, so the app's real path runs: what it
// hands over is checked as a file. The sheet itself and "Save to Photos" exist only on a device (L5, reports/Чек-лист устройства.md).
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  });
});

type Shared = { name: string; type: string; size: number; b64: string; afterTap: number; count: number };

/** share() has to start inside the tap: iOS refuses it once the tap has gone stale. It starts in the same task today. */
const MAX_AFTER_TAP_MS = 1000;

/** The browser's share sheet: answers as told, keeps what it was handed. */
const fakeSheet = (page: Page, answer: 'ok' | 'AbortError' | 'NotAllowedError') => page.addInitScript((how) => {
  const w = window as unknown as { __shared: Shared | null; __tries: number; __tap: number };
  w.__shared = null;
  w.__tries = 0;
  w.__tap = 0;
  addEventListener('click', () => { w.__tap = performance.now(); }, true);
  Object.defineProperty(navigator, 'canShare', { value: (d: ShareData) => !!d.files?.length });
  Object.defineProperty(navigator, 'share', { value: async (d: ShareData) => {
    w.__tries++;
    const afterTap = performance.now() - w.__tap;
    if (how !== 'ok') throw new DOMException('refused', how);
    const f = d.files![0];
    const bytes = new Uint8Array(await f.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    w.__shared = { name: f.name, type: f.type, size: f.size, b64: btoa(bin), afterTap, count: d.files!.length };
  } });
}, answer);

async function finishedExport(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
}
const tries = (page: Page) => page.evaluate(() => (window as unknown as { __tries: number }).__tries);
const notSaved = (page: Page) => page.getByText('The video is not saved yet. Tap again to discard it.');

function probeFile(file: string) {
  const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file]).toString()) as { streams: { codec_type: string }[]; format: { duration: string } };
  return { kinds: j.streams.map((s) => s.codec_type).sort(), duration: Number(j.format.duration) };
}

test('the share sheet is handed one whole, playable video from the tap itself, and the sheet then closes without a warning', async ({ page }, info) => {
  test.setTimeout(240_000);
  await fakeSheet(page, 'ok');
  await finishedExport(page);
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await expect.poll(() => page.evaluate(() => !!(window as unknown as { __shared: unknown }).__shared)).toBe(true);
  const s = await page.evaluate(() => (window as unknown as { __shared: Shared }).__shared);
  expect(s.count, 'one file').toBe(1);
  expect(s.name).toMatch(/\.mp4$/);
  expect(s.type).toBe('video/mp4'); // iOS offers "Save Video" for a file typed as a video
  expect(s.size).toBeGreaterThan(5000);
  expect(s.afterTap, 'share() starts while the tap is still valid').toBeLessThanOrEqual(MAX_AFTER_TAP_MS);
  const file = info.outputPath(s.name);
  fs.writeFileSync(file, Buffer.from(s.b64, 'base64'));
  const p = probeFile(file);
  expect(p.kinds).toEqual(['audio', 'video']);
  expect(Math.abs(p.duration - 6)).toBeLessThan(0.15);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(notSaved(page)).toHaveCount(0);
  await expect(page.getByText(/Ready: .* MB/)).toHaveCount(0);
});

test('the person closes the share sheet: the file is kept, nothing pretends it was saved, and the next tap offers it again', async ({ page }) => {
  test.setTimeout(240_000);
  await fakeSheet(page, 'AbortError');
  await finishedExport(page);
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await expect.poll(() => tries(page)).toBe(1);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(notSaved(page), 'closing would lose the file: it warns').toBeVisible();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible();
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await expect.poll(() => tries(page)).toBe(2);
  expect(downloads, 'turning the sheet down is not a request to download').toBe(0);
});

test('the browser refuses the share (the tap has expired): the file is downloaded instead, and it is whole', async ({ page }, info) => {
  test.setTimeout(240_000);
  await fakeSheet(page, 'NotAllowedError');
  await finishedExport(page);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  expect(await tries(page)).toBe(1);
  expect(probeFile(file).kinds).toEqual(['audio', 'video']);
});
