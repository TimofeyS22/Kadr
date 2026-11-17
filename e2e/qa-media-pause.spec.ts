// SW-A-2: after Pause the frame on screen is the frame of the time shown, the one «Save photo» and the file hold. While
// playing, the preview draws as often as the page gets frames; Pause took the time from the sound and drew nothing, so
// where the page got few frames (a busy phone: four a second) the screen kept the last frame drawn while playing — 1 to
// 5 frames before the photo — and the person saved a different frame from the one they stopped on.
import { expect } from '@playwright/test';
import { closeTools, counterAt, errorToasts, exportAs, importFiles, newProject, previewShot, time, watch, test } from './qa-media-kit';

let privateCheck: () => void;
test.beforeEach(async ({ page }) => { privateCheck = await watch(page); });
test.afterEach(async ({ page }) => {
  privateCheck();
  expect(await errorToasts(page), 'error toasts').toEqual([]);
});

test('paused on a busy page, the frame on screen is the photo\'s frame: Pause draws the moment it stops on (SW-A-2)', async ({ page }, info) => {
  test.setTimeout(300_000);
  // A busy phone: the page gets an animation frame four times a second.
  await page.addInitScript(() => {
    window.requestAnimationFrame = (cb: FrameRequestCallback) => window.setTimeout(() => cb(performance.now()), 250);
    window.cancelAnimationFrame = (id: number) => window.clearTimeout(id);
  });
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']); // 6 s at 30 fps, frame N written in binary
  await expect(main).toHaveCount(1);
  await closeTools(page);
  const play = page.getByRole('button', { name: 'Play', exact: true });
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  const seconds = async () => { const [m, s] = (await time(page))!.split(':'); return Number(m) * 60 + Number(s); };
  const rows: string[] = [];
  for (const run of [1.1, 2.6, 4.2]) {
    await play.click();
    await expect.poll(seconds, { timeout: 15_000 }).toBeGreaterThan(run);
    await pause.click();
    await expect(play).toBeVisible();
    await page.waitForTimeout(800); // a frame asked for at Pause is drawn by now, even at four frames a second
    const preview = counterAt(await previewShot(page, info, `paused-${run}`));
    const photo = counterAt(await exportAs(page, info, 'Photo', 'Save photo'));
    rows.push(`paused past ${run} s: preview ${preview}, photo ${photo}`);
    expect.soft(preview, `the frame on screen is the photo's frame (paused past ${run} s)`).toBe(photo);
  }
  console.log(`pause on a busy page (${info.project.name}):\n${rows.join('\n')}`);
});
