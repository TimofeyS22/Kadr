// Q-26, captions by text (docs/11 §3.3–3.5): undo, what is kept, and the edges of correcting lines and of "Edit video
// by text". Imported subtitles are used, so no speech model is needed and the checks are quick.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
/** The length of the project, seconds, as the transport shows it ("0:00.0 / 0:06.0"). */
async function total(page: Page): Promise<number> {
  const [m, sec] = ((await page.locator('.time').textContent()) ?? '').split('/')[1].trim().split(':');
  return Number(m) * 60 + Number(sec);
}
const lines = (page: Page) => page.locator('.caption-row input').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));

async function withSubtitles(page: Page, srt = fx('test.srt')) {
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1'); });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const media = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await media).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  // A video with sound: the tool asks about the speech model first; the import is behind "Not now".
  const no = page.getByRole('button', { name: 'Not now', exact: true });
  await expect(async () => {
    if (await no.isVisible()) await no.click();
    await page.getByRole('button', { name: 'Import .srt or .vtt' }).click({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await (await chooser).setFiles(srt);
}

test('a corrected line and a cut by text are each one undo, and a reload keeps what was not undone', async ({ page }) => {
  test.setTimeout(180_000);
  await withSubtitles(page);
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  expect(await lines(page)).toEqual(['Hello from Kadr', 'Second line']);
  const length = await total(page);

  // A corrected line, undone and redone.
  await page.locator('.caption-row input').first().fill('Hello from Chetko');
  await page.locator('.caption-row input').first().press('Enter');
  await expect(page.locator('.caption-row input').first()).toHaveValue('Hello from Chetko');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('.caption-row input').first()).toHaveValue('Hello from Kadr');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('.caption-row input').first()).toHaveValue('Hello from Chetko');

  // A word cut from the video by text: the video is shorter and the word is gone; one undo brings both back.
  await page.getByRole('button', { name: 'Edit video by text' }).click();
  await page.locator('.ck-word', { hasText: 'Second' }).click();
  await page.getByRole('button', { name: /^Cut 1 words/ }).click();
  await expect.poll(() => total(page)).toBeLessThan(length - 0.2);
  expect((await lines(page)).join(' ')).not.toContain('Second');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect.poll(() => total(page)).toBeCloseTo(length, 1);
  expect(await lines(page)).toEqual(['Hello from Chetko', 'Second line']);

  // What is kept: after a reload the corrected line is there, and the cut that was undone is not.
  await page.waitForTimeout(1200);
  await page.reload();
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  await page.locator('.clip-caption').click();
  const edit = page.getByRole('button', { name: 'Edit captions', exact: true });
  if (!(await page.locator('.caption-row').first().isVisible())) await edit.click();
  expect(await lines(page)).toEqual(['Hello from Chetko', 'Second line']);
  expect(await total(page)).toBeCloseTo(length, 1);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

test('edges of correcting lines: an emptied line goes, a very long one stays whole, the last line emptied leaves no broken captions', async ({ page }) => {
  test.setTimeout(180_000);
  await withSubtitles(page);
  await expect(page.locator('.caption-row')).toHaveCount(2);
  // A very long line: kept whole, word for word.
  const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(' ');
  await page.locator('.caption-row input').nth(1).fill(long);
  await page.locator('.caption-row input').nth(1).press('Enter');
  expect((await lines(page)).join(' ')).toContain('word0 word1');
  expect((await lines(page)).join(' ').split(' ').filter((w) => w.startsWith('word'))).toHaveLength(60);
  // An emptied line is gone, the others stay.
  await page.locator('.caption-row input').first().fill('');
  await page.locator('.caption-row input').first().press('Enter');
  expect((await lines(page)).join(' ')).not.toContain('Hello');
  expect((await lines(page)).length).toBeGreaterThan(0);
  // Every line emptied: no line is left, nothing fails, and the subtitles save as an empty file or say there are none.
  for (let n = await page.locator('.caption-row').count(); n > 0; n = await page.locator('.caption-row').count()) {
    await page.locator('.caption-row input').first().fill('');
    await page.locator('.caption-row input').first().press('Enter');
    await expect(page.locator('.caption-row')).toHaveCount(n - 1);
  }
  await expect(page.locator('.toast.error')).toHaveCount(0);
  await expect(page.locator('.preview-canvas')).toBeVisible();
});

test('edges of the import: a file with no cues says so and changes nothing; cues out of order and overlapping come in by time', async ({ page }) => {
  test.setTimeout(180_000);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-srt-'));
  const empty = path.join(dir, 'empty.srt'), mixed = path.join(dir, 'mixed.srt');
  fs.writeFileSync(empty, 'no cues here\n\njust text\n');
  fs.writeFileSync(mixed, '1\n00:00:03,000 --> 00:00:04,000\nthird\n\n2\n00:00:00,500 --> 00:00:02,500\nfirst\n\n3\n00:00:02,000 --> 00:00:03,200\nsecond\n');
  await withSubtitles(page, empty);
  await expect(page.locator('.toast', { hasText: 'No subtitles found in this file' })).toBeVisible();
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .srt or .vtt' }).click();
  await (await chooser).setFiles(mixed);
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  expect(await lines(page)).toEqual(['first', 'second', 'third']);
  fs.rmSync(dir, { recursive: true, force: true });
});
