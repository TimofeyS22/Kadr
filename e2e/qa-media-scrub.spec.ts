// QA matrix Q-9, scrubbing and playback. docs/11 §3.1 (to the file), §3.2 (WYSIWYG), §3.3 (history) and §3.5 (edges).
// What is already proven: playback moves the playhead, a hand scroll scrubs it (editor.spec.ts), the fuzzing of the
// timeline (src/core). Here: the frame under a scrubbed or paused playhead is the frame the photo and the video hold —
// forward, back, at both ends; scrubbing and playing add no undo step; playback stops at the end, Play there starts
// from the beginning, a double tap on Play leaves it as it was, and an empty project has nothing to play.
import { expect, type Page } from '@playwright/test';
import { closeTools, counterAt, errorToasts, exportAs, importFiles, newProject, previewShot, time, watch, test } from './qa-media-kit';

let privateCheck: () => void;
test.beforeEach(async ({ page }) => { privateCheck = await watch(page); });
test.afterEach(async ({ page }) => {
  privateCheck();
  expect(await errorToasts(page), 'error toasts').toEqual([]);
});

const seconds = async (page: Page) => { const [m, s] = (await time(page))!.split(':'); return Number(m) * 60 + Number(s); };
const scroll = (page: Page, px: number) => page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, px);
const play = (page: Page) => page.getByRole('button', { name: 'Play', exact: true });
const pause = (page: Page) => page.getByRole('button', { name: 'Pause', exact: true });

test('scrubbing reaches the file: forward, back and past both ends the preview, the photo and the video show the same source frame, and no undo step is added (QA matrix Q-9)', async ({ page }, info) => {
  test.setTimeout(420_000);
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']); // 6 s at 30 fps, frame N written in binary
  await expect(main).toHaveCount(1);
  await closeTools(page);
  const video = await exportAs(page, info, 'Video', 'Export video');
  const rows: string[] = [];
  // Forward to frame 75, back to frame 30, before the start, past the end (the last frame, 179).
  for (const [name, px, shown, frame] of [
    ['forward', 75.5 * 2, '0:02.5', 75], ['back', 30.5 * 2, '0:01.0', 30], ['before the start', -500, '0:00.0', 0], ['past the end', 99_999, '0:06.0', 179],
  ] as const) {
    await scroll(page, px);
    await expect.poll(() => time(page), { message: name }).toBe(shown);
    const preview = counterAt(await previewShot(page, info, `scrub-${frame}`));
    const photo = counterAt(await exportAs(page, info, 'Photo', 'Save photo'));
    const inFile = counterAt(video, Math.min(frame, 179));
    rows.push(`${name} (${shown}): preview ${preview}, photo ${photo}, video ${inFile} (expected ${frame})`);
    expect.soft(preview, `preview, ${name}`).toBe(frame);
    expect.soft(photo, `photo, ${name}`).toBe(frame);
    expect.soft(inFile, `video, ${name}`).toBe(frame);
  }
  console.log(`scrubbing (${info.project.name}):\n${rows.join('\n')}`);
  // Scrubbing is no edit: the one step to undo is the import.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

test('playback: paused, the preview and the photo show the frame of the time shown; it stops at the end, Play there starts from the beginning, a double tap leaves it still, an empty project has nothing to play (QA matrix Q-9)', async ({ page }, info) => {
  test.setTimeout(300_000);
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  // Nothing to play: no error, the time stays at zero.
  if (await play(page).isEnabled()) await play(page).click();
  await page.waitForTimeout(1000);
  expect(await time(page)).toBe('0:00.0');

  await importFiles(page, 'Media', ['counter.mp4']);
  await expect(main).toHaveCount(1);
  await closeTools(page);
  const rows: string[] = [];
  // Played, then paused: the frame on screen and the photo are the frame of the time shown. That the frame on screen is
  // the photo's own frame, to the frame, is SW-A-2 (open: the preview keeps the last frame drawn while playing).
  for (const run of [1.2, 2.3]) {
    await play(page).click();
    await expect.poll(() => seconds(page), { timeout: 15_000 }).toBeGreaterThan(run);
    await pause(page).click();
    await expect(play(page)).toBeVisible();
    const at = await seconds(page);
    const preview = counterAt(await previewShot(page, info, `paused-${run}`));
    const photo = counterAt(await exportAs(page, info, 'Photo', 'Save photo'));
    rows.push(`paused at ${at.toFixed(1)} s: preview ${preview}, photo ${photo}`);
    // The time is shown to 0.1 s: the frame under it is up to 2 frames either way.
    expect.soft(Math.abs(photo - at * 30), `the photo is the time shown (${at} s)`).toBeLessThanOrEqual(2);
    expect.soft(Math.abs(preview - at * 30), `the frame on screen is the time shown (${at} s)`).toBeLessThan(4);
  }
  // To the end: it stops there, with Play offered again.
  await scroll(page, 5.4 * 60);
  await expect.poll(() => time(page)).toBe('0:05.4');
  await play(page).click();
  await expect.poll(() => time(page), { timeout: 15_000 }).toBe('0:06.0');
  await expect(play(page)).toBeVisible();
  await page.waitForTimeout(1000);
  expect(await time(page), 'it does not run past the end').toBe('0:06.0');
  const last = counterAt(await previewShot(page, info, 'end'));
  rows.push(`at the end: preview ${last}`);
  expect.soft(last, 'the last frame at the end').toBe(179);
  // Play at the end starts again from the beginning.
  await play(page).click();
  await expect.poll(() => seconds(page), { timeout: 15_000 }).toBeLessThan(3);
  await pause(page).click();
  // A double tap on Play: playing and stopped again, the playhead still.
  await scroll(page, 60);
  await expect.poll(() => time(page)).toBe('0:01.0');
  await play(page).dblclick();
  await expect(play(page)).toBeVisible();
  const held = await seconds(page);
  await page.waitForTimeout(1500);
  expect(await seconds(page), 'still after a double tap').toBe(held);
  console.log(`playback (${info.project.name}):\n${rows.join('\n')}`);
  // Playing is no edit either.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeDisabled();
});

// A finger in Chromium (touch through its DevTools protocol). Playwright's mobile WebKit takes neither injected touch
// nor a wheel, so there the timeline is scrolled step by step as the swipe scrolls it. The iPhone's own finger is L5.
test('a swipe along the timeline scrubs: the playhead and the picture follow, the page does not move (QA matrix Q-9, §3.9)', async ({ page, browserName }, info) => {
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']);
  await expect(main).toHaveCount(1);
  await closeTools(page);
  const box = (await page.locator('.tl-scroll').boundingBox())!;
  const y = box.y + box.height / 2, x0 = box.x + box.width * 0.75;
  // A slow swipe to the left, 150 px: the timeline moves under the finger, the playhead goes on about 2.5 s.
  if (browserName === 'chromium') {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y }] });
    for (let k = 1; k <= 15; k++) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x0 - k * 10, y }] });
      await page.waitForTimeout(30);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } else {
    for (let k = 1; k <= 15; k++) {
      await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft += 10; });
      await page.waitForTimeout(30);
    }
  }
  await expect.poll(() => seconds(page), { message: 'the playhead followed the finger' }).toBeGreaterThan(1.5);
  const at = await seconds(page);
  const shown = counterAt(await previewShot(page, info, 'swiped'));
  console.log(`swipe (${info.project.name}): playhead ${at} s, frame ${shown}`);
  expect(Math.abs(shown - at * 30), 'the picture is the frame of the playhead').toBeLessThan(4);
  expect(await page.evaluate(() => [window.scrollX, window.scrollY, document.scrollingElement?.scrollLeft ?? 0, visualViewport?.offsetLeft ?? 0]), 'the page itself did not move').toEqual([0, 0, 0, 0]);
  await expect(page.getByRole('button', { name: 'Undo' })).toBeEnabled(); // the import only: undo once and nothing is left
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(0);
});
