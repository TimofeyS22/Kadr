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
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
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
  // The file itself, in the browser that made it (audit V-140: a black video or one cut in half passed this test).
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const made = await (await download).path();
  const base64 = fs.readFileSync(made).toString('base64');
  const seen = await page.evaluate(async (b64) => {
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, src: URL.createObjectURL(new Blob([bytes], { type: 'video/mp4' })) });
    await new Promise((ok, ko) => { v.onloadedmetadata = ok; v.onerror = () => ko(new Error('the file does not load')); });
    const c = Object.assign(document.createElement('canvas'), { width: 32, height: 56 });
    const g = c.getContext('2d', { willReadFrequently: true })!;
    // A seek says "seeked" before its frame can be drawn: a fixed 150 ms read black on a busy machine (2 runs of 4 on
    // WebKit) and on a real iPhone. The frame is read until it has a picture, for 6 s at most: a black file still fails.
    const luma = async (t: number) => {
      await new Promise((ok) => { v.onseeked = ok; v.currentTime = t; });
      let mean = 0;
      for (let tries = 0; tries < 30; tries++) {
        await new Promise((ok) => setTimeout(ok, 200));
        g.drawImage(v, 0, 0, 32, 56);
        const d = g.getImageData(0, 0, 32, 56).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) n += (d[i] + d[i + 1] + d[i + 2]) / 3;
        mean = n / (d.length / 4);
        if (mean > 12) break;
      }
      return mean;
    };
    return { duration: v.duration, start: await luma(0.5), end: await luma(v.duration - 0.5) };
  }, base64);
  expect(Math.abs(seen.duration - 7.5), `the whole video: ${seen.duration} s`).toBeLessThan(0.3);
  expect(seen.start, 'a picture at the start').toBeGreaterThan(12);
  expect(seen.end, 'a picture at the end').toBeGreaterThan(12);
  for (const p of ['en/privacy/', 'ru/licenses/']) expect((await page.request.get(p)).status(), p).toBe(200);
  expect(errors).toEqual([]);
});
