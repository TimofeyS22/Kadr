// The main path in a minute (docs/12 stage 6): CI runs this on Chromium before every deploy, so a build that cannot
// open, edit and export never reaches the site. No fixtures and no network beyond the site: the sample project is
// made on the device. The full suite stays the real check; this one only stops the worst.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('smoke: Home shows this version, the sample opens, a split undoes, the video exports, the pages are there', async ({ page }) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
  const { version } = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8')) as { version: string };
  await page.goto('./');
  await expect(page.locator('.home-foot')).toContainText(`Kadr v${version}`);
  await page.getByRole('button', { name: 'Try a sample' }).click();
  const clips = page.locator('.tl-row.main .clip');
  await expect(clips.first()).toBeVisible({ timeout: 60_000 });
  const before = await clips.count();
  await clips.first().click(); // select first, then move the playhead: a click on a clip scrolls the timeline
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 60; }); // the playhead a second in
  await expect(page.locator('.time b')).not.toHaveText('0:00.0');
  await page.getByRole('button', { name: 'Split', exact: true }).click();
  await expect(clips).toHaveCount(before + 1);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(clips).toHaveCount(before);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  for (const p of ['en/privacy/', 'ru/licenses/']) expect((await page.request.get(p)).status(), p).toBe(200);
  expect(errors).toEqual([]);
});
