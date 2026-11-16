// Scrub response (audit V-248, CLAUDE.md §5: ≤ 100 ms to a frame), by the method of docs/04: Chromium with the CPU slowed
// 4× like a mid-range phone, a real GPU, the production build. A finger scrubs inside one 1080p clip, as a person looks
// for a moment in it; each step is a jump the preview answers with the nearest keyframe first. Timed inside the page,
// from the scroll to the first frame drawn at that time; the next step comes once the exact frame is there, so a step
// is not timed with the one before it. Runs with `npm run perf` (PERF=1), and prints every step.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
type P = { marks: Record<string, number>; last: { t: number; at: number; exact: boolean } };
const probe = (page: Page) => page.evaluate(() => (window as unknown as { __kadrPerf: P }).__kadrPerf);
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

/** The budget, written before the fix: 9 steps of 10 show a frame within 100 ms. */
const BUDGET_P90_MS = 100;
/** 40 steps across the 60 s clip, forward and back, each at least 0.6 s from the last: always a keyframe first. */
const STEPS = [12.4, 31.7, 5.2, 47.9, 22.3, 39.1, 55.6, 8.8, 27.5, 44.2, 16.9, 36.4, 51.3, 3.7, 25.1, 58.2, 19.6, 33.8, 10.3, 42.7,
  29.4, 6.1, 53.9, 14.5, 38.2, 49.6, 21.8, 2.9, 45.3, 34.6, 11.7, 57.1, 26.2, 40.8, 17.4, 50.5, 7.6, 30.9, 54.4, 23.5];

test('V-248: a scrub step inside a 1080p clip shows a frame within 100 ms (CPU 4× slower)', async ({ page }) => {
  test.setTimeout(600_000);
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.locale', 'en'); });
  const cdp = await page.context().newCDPSession(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('long_1.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 120_000 });
  await expect.poll(async () => Object.keys((await probe(page)).marks).some((k) => k.startsWith('thumbs:')), { timeout: 300_000 }).toBe(true);
  await page.waitForTimeout(3000); // the sound's wave and the copy into storage finish in the background
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // One step, timed in the page: from the scroll to the first frame drawn at that time, and to the exact one.
  const step = (x: number) => page.evaluate(async (x) => {
    const P = (window as unknown as { __kadrPerf: P }).__kadrPerf;
    const el = document.querySelector('.tl-scroll')!;
    const t0 = performance.now();
    el.scrollLeft = x;
    let first = 0, t = Number.NaN;
    while (performance.now() - t0 < 30_000) {
      await new Promise((r) => setTimeout(r, 2));
      if (P.last.at <= t0) continue;
      if (Number.isNaN(t)) t = P.last.t;
      if (Math.abs(P.last.t - t) < 1e-3) {
        first ||= P.last.at - t0;
        if (P.last.exact) return { t, first, exact: P.last.at - t0 };
      }
    }
    return { t, first: first || 30_000, exact: 30_000 };
  }, x);
  // The timeline's pixels a second, from a first step that also wakes the decoder up (not counted).
  const warm = await step(600);
  const zoom = 600 / warm.t;
  expect(zoom, 'pixels a second of the timeline').toBeGreaterThan(5);

  const got: { t: number; first: number; exact: number }[] = [];
  for (const s of STEPS) {
    const r = await step(Math.round(s * zoom));
    expect(Math.abs(r.t - s), `the step went to ${s} s`).toBeLessThan(0.1);
    got.push(r);
  }
  const first = got.map((r) => r.first);
  const report = {
    steps: got.length, firstP50: Math.round(pct(first, 0.5)), firstP90: Math.round(pct(first, 0.9)), firstMax: Math.round(Math.max(...first)),
    exactP50: Math.round(pct(got.map((r) => r.exact), 0.5)), raw: got.map((r) => `${Math.round(r.first)}/${Math.round(r.exact)}`).join(' '),
  };
  console.log('SCRUB', JSON.stringify(report));
  expect(report.firstP90, 'a frame after a scrub step, p90 (ms)').toBeLessThanOrEqual(BUDGET_P90_MS);
});
