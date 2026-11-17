// Speed budgets of CLAUDE.md §5 and docs/04 that need a GPU to say anything (QA matrix §3.14, Q-1; CapCut's "lags",
// C-C2). Headless Chromium draws WebGL in software (SwiftShader): a scrub step took 173–178 ms there on main and on the
// branch alike, 31–40 ms with the GPU (load 3.6–5, 2026-11-17). Android Chrome has a GPU, so these run with it, as
// qa-overlay-speed and the perf project do. Timing tests: --workers=1, in quiet minutes.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
test.use({ launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } });

// Scrubbing and playback against the phone budgets of CLAUDE.md §5 in every run (QA matrix §3.14, CapCut's "lags" C-C2):
// a frame within 100 ms of a scrub, a 1080p clip previewed at 30 frames a second. A Mac is faster than any phone, so
// missing them here means the phone misses them too; meeting them here says nothing about the phone (L5 queue, B).
const SCRUB_MS = 100, PLAY_FPS = 30;

test('scrubbing shows a frame within 100 ms and a 1080p clip plays at 30 frames a second', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('phone_1080_h264.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  await page.waitForTimeout(1500); // thumbnails and the sound's peaks are made right after an import
  // In the page: from the scroll that seeks to the first frame drawn at that time (the exact one may come later).
  const scrubs: number[] = [];
  for (const target of [12.4, 3.1, 25.7, 18.2, 7.9, 28.3, 0.6, 21.5, 15.1, 9.8]) {
    scrubs.push(await page.evaluate(async (target) => {
      type P = { last: { t: number; at: number } };
      const P = (window as unknown as { __kadrPerf: P }).__kadrPerf;
      const el = document.querySelector('.tl-scroll')!;
      // The scroll range is the clip's 30 s; each jump is seconds long, so the next frame drawn elsewhere is the answer.
      const from = P.last.t;
      const t0 = performance.now();
      el.scrollLeft = (target / 30) * (el.scrollWidth - el.clientWidth);
      while (performance.now() - t0 < 10_000) {
        await new Promise((r) => setTimeout(r, 2));
        if (P.last.at > t0 && Math.abs(P.last.t - from) > 1) return P.last.at - t0;
      }
      return 10_000;
    }, target));
  }
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  await page.waitForTimeout(500);
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  // Pictures drawn at a new time of the video, a second, counted at every paint (a repaint of the same time is not one).
  const fps = await page.evaluate(() => new Promise<number>((done) => {
    const P = (window as unknown as { __kadrPerf: { last: { t: number } } }).__kadrPerf;
    const seen = new Set<number>();
    const t0 = performance.now() + 500; // past the start of playback
    const tick = (now: number) => {
      if (now >= t0) seen.add(Math.round(P.last.t * 1000));
      if (now < t0 + 4000) requestAnimationFrame(tick); else done(seen.size / 4);
    };
    requestAnimationFrame(tick);
  }));
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const sorted = [...scrubs].sort((a, b) => a - b);
  const p90 = sorted[Math.floor(0.9 * (sorted.length - 1))];
  console.log(`scrub and play (${info.project.name}): scrub to frame, ms ${scrubs.map(Math.round).join(' ')}, p90 ${Math.round(p90)}; playback ${fps.toFixed(1)} fps`);
  expect.soft(p90, `scrub to a frame, p90: budget ${SCRUB_MS} ms`).toBeLessThanOrEqual(SCRUB_MS);
  expect.soft(fps, `1080p preview: budget ${PLAY_FPS} frames a second`).toBeGreaterThanOrEqual(PLAY_FPS * 0.95);
});

// The page answers while a video exports (docs/04: no task over 200 ms; CapCut's "lags", C-C2; found by lane U: in
// Chromium a swipe during an export was taken 5–8 s late). A tap waits for whatever task holds the main thread, so the
// longest hold is measured: a 16 ms heartbeat that comes late by as much as the thread was busy (event.timeStamp in
// WebKit is the time of dispatch and showed no wait under a 400 ms task). Taps go on every 300 ms of a 30 s 1080p export.
// Chromium also runs with the CPU slowed 4×, as a mid-range phone.
const INPUT_DELAY_MS = 200;

test('a tap is answered within 200 ms while a 1080p video exports', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined });
    const w = window as unknown as { __holds: number[] };
    w.__holds = [];
    let last = performance.now();
    setInterval(() => { const now = performance.now(); w.__holds.push(now - last - 16); last = now; }, 16);
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('phone_1080_h264.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  if (info.project.name === 'android-chromium') await (await page.context().newCDPSession(page)).send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.getByRole('button', { name: 'Export video' }).click();
  await page.evaluate(() => { (window as unknown as { __holds: number[] }).__holds = []; });
  const progress = page.locator('.export-progress');
  await expect(progress).toBeVisible({ timeout: 30_000 });
  const box = (await progress.boundingBox())!; // a tap on the progress text does nothing but wait for the page
  const ready = page.getByText(/Ready: .* MB/);
  const t0 = Date.now();
  while (!(await ready.isVisible()) && Date.now() - t0 < 240_000) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
  }
  const delays = await page.evaluate(() => (window as unknown as { __holds: number[] }).__holds.map((d) => Math.max(0, d)));
  const sorted = [...delays].sort((a, b) => a - b);
  const p95 = sorted[Math.floor(0.95 * (sorted.length - 1))] ?? 0;
  console.log(`main thread held during export (${info.project.name}): ${delays.length} beats, median ${Math.round(sorted[sorted.length >> 1] ?? 0)} ms, p95 ${Math.round(p95)} ms, max ${Math.round(sorted.at(-1) ?? 0)} ms, export ${Math.round((Date.now() - t0) / 1000)} s`);
  expect(delays.length, 'heartbeats measured').toBeGreaterThan(20);
  expect(Math.round(sorted.at(-1) ?? 0), `the longest the main thread was held during export (a tap waits that long): budget ${INPUT_DELAY_MS} ms`).toBeLessThanOrEqual(INPUT_DELAY_MS);
});
