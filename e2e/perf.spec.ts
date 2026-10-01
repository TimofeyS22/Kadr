// Performance benchmark (docs/04-performance-prompt.md, scenario S1): 4 × 60 s 1080p clips, CPU slowed 4×.
// Prints a JSON report; budgets are asserted once the baseline is known.
import { expect, test, type Page } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
type P = { marks: Record<string, number>; drawn: number; drawMs: number[]; last: { t: number; at: number; exact: boolean }; longTasks: number[] };
const probe = (page: Page) => page.evaluate(() => (window as unknown as { __kadrPerf: P }).__kadrPerf);
const pct = (xs: number[], q: number) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(q * s.length))] : 0; };
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
const round = (x: number) => Math.round(x);

// S1 (default): four 1-minute 1080p clips, like the owner's 4-minute project. S2 (PERF_S2=1): one 15-minute clip.
const S2 = !!process.env.PERF_S2;
const FILES = S2 ? ['long_15m.mp4'] : [1, 2, 3, 4].map((i) => `long_${i}.mp4`);
const LENGTH = S2 ? 900 : 240;

test(S2 ? 'S2: one 15-minute clip' : 'S1: four 1-minute 1080p clips', async ({ page }, info) => {
  test.setTimeout(600_000);
  const report: Record<string, unknown> = {};
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); });
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Performance.enable');
  const heapMb = async () => {
    const { metrics } = await cdp.send('Performance.getMetrics');
    return round((metrics.find((m) => m.name === 'JSHeapUsedSize')?.value ?? 0) / 1e6);
  };
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });

  // Import
  const lt0 = (await probe(page)).longTasks.length;
  const t0 = Date.now();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(FILES.map(fx));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(FILES.length, { timeout: 300_000 });
  report.clipsVisibleMs = Date.now() - t0;
  await expect.poll(async () => Object.keys((await probe(page)).marks).filter((k) => k.startsWith('thumbs:')).length, { timeout: 300_000 }).toBe(FILES.length);
  report.thumbnailsMs = Date.now() - t0;
  let p = await probe(page);
  const importTasks = p.longTasks.slice(lt0);
  report.import = { longTasks: importTasks.length, tbtMs: round(sum(importTasks.map((d) => Math.max(0, d - 50)))), maxTaskMs: round(Math.max(0, ...importTasks)) };
  report.heapAfterImportMb = await heapMb();
  console.log('PERF import', JSON.stringify(report));

  // Scrubbing: seek to random points through the timeline scroller, time until that frame is drawn.
  // Measured inside the page: time from the scroll to the first frame at that time, and to the exact frame.
  const seeks: { first: number; exact: number }[] = [];
  for (const target of [0.15, 0.5, 0.02, 0.83, 0.37, 0.69, 0.97, 0.05, 0.62, 0.27, 0.44, 0.91, 0.11, 0.58, 0.76, 0.33, 0.08, 0.88, 0.21, 0.65].map((f) => Math.round(f * LENGTH))) {
    seeks.push(await page.evaluate(async ({ x, target }) => {
      const P = (window as unknown as { __kadrPerf: P }).__kadrPerf;
      const el = document.querySelector('.tl-scroll')!;
      const t0 = performance.now();
      el.scrollLeft = x;
      let first = 0;
      while (performance.now() - t0 < 30_000) {
        await new Promise((r) => setTimeout(r, 2));
        if (Math.abs(P.last.t - target) < 0.1 && P.last.at > t0) {
          first ||= P.last.at - t0;
          if (P.last.exact) return { first, exact: P.last.at - t0 };
        }
      }
      return { first: first || 30_000, exact: 30_000 };
    }, { x: target * 60, target }));
  }
  report.seekMs = {
    firstP50: round(pct(seeks.map((s) => s.first), 0.5)), firstP95: round(pct(seeks.map((s) => s.first), 0.95)),
    exactP50: round(pct(seeks.map((s) => s.exact), 0.5)), exactP90: round(pct(seeks.map((s) => s.exact), 0.9)), exactP95: round(pct(seeks.map((s) => s.exact), 0.95)),
    raw: seeks.map((s) => `${round(s.first)}/${round(s.exact)}`).join(' '),
  };
  console.log('PERF seek', JSON.stringify(report.seekMs));

  // Playback for 10 s from the start of clip 2.
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 55 * 60; });
  await page.waitForTimeout(500);
  p = await probe(page);
  const lt1 = p.longTasks.length, d0 = p.drawn, heap0 = await heapMb();
  if (process.env.PROFILE) await cdp.send('Profiler.enable').then(() => cdp.send('Profiler.start'));
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(10_000);
  if (process.env.PROFILE) {
    // Self time by function (top 15): where the main thread spends playback.
    const { profile } = await cdp.send('Profiler.stop');
    const dt = (profile.endTime - profile.startTime) / 1000 / Math.max(1, profile.samples?.length ?? 1);
    const self = new Map<string, number>();
    for (const n of profile.nodes) {
      const f = n.callFrame, key = `${f.functionName || '(anon)'} ${f.url.split('/').pop()}:${f.lineNumber}`;
      self.set(key, (self.get(key) ?? 0) + (n.hitCount ?? 0) * dt);
    }
    console.log('PROFILE', JSON.stringify([...self].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([k, v]) => `${Math.round(v)}ms ${k}`)));
  }
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  p = await probe(page);
  const playTasks = p.longTasks.slice(lt1);
  report.playback = {
    fps: Math.round(((p.drawn - d0) / 10) * 10) / 10,
    drawP95Ms: round(pct(p.drawMs.slice(-(p.drawn - d0)), 0.95)),
    tbtMs: round(sum(playTasks.map((d) => Math.max(0, d - 50)))),
    heapGrowthMb: (await heapMb()) - heap0,
  };
  console.log('PERF play', JSON.stringify(report.playback));

  // Tap → sheet open
  const taps: number[] = [];
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  for (let i = 0; i < 3; i++) {
    // In-page: from the tap event to the first paint with the sheet on screen.
    taps.push(await page.evaluate(async () => {
      const btn = [...document.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Canvas')!;
      const t0 = performance.now();
      btn.click();
      while (!document.querySelector('.sheet')) await new Promise((r) => setTimeout(r, 1));
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      return performance.now() - t0;
    }));
    await page.getByRole('button', { name: 'Done' }).click();
  }
  report.tapToSheetMs = round(pct(taps, 0.5));
  report.heapEndMb = await heapMb();
  console.log('PERF', JSON.stringify(report));
  // Regression gate (docs/04 budgets, with a margin for machine noise).
  const r = report as { clipsVisibleMs: number; import: { tbtMs: number }; seekMs: { exactP90: number }; playback: { fps: number; tbtMs: number; heapGrowthMb: number }; tapToSheetMs: number };
  expect.soft(r.clipsVisibleMs, 'clips visible').toBeLessThanOrEqual(2000);
  expect.soft(r.import.tbtMs, 'import blocking').toBeLessThanOrEqual(300);
  expect.soft(r.seekMs.exactP90, 'exact frame after seek p90').toBeLessThanOrEqual(250);
  expect.soft(r.playback.fps, 'playback fps').toBeGreaterThanOrEqual(29);
  expect.soft(r.playback.tbtMs, 'playback blocking').toBeLessThanOrEqual(300);
  expect.soft(r.playback.heapGrowthMb, 'heap growth').toBeLessThanOrEqual(20);
  expect.soft(r.tapToSheetMs, 'tap to sheet').toBeLessThanOrEqual(100);
  writeFileSync(info.outputPath('perf.json'), JSON.stringify(report, null, 2));
});

// S3: background removal on a walking person (docs/05 M4): playback rate and frame cost with segmentation on.
test('S3: cutout playback', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); });
  const cdp = await page.context().newCDPSession(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('walk.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.locator('.tl-row.main .clip').click();
  await page.getByRole('button', { name: 'Cutout', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Cutout', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  let p = await probe(page);
  const d0 = p.drawn, lt0 = p.longTasks.length;
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(3000); // walk.mp4 is 5 s long
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  p = await probe(page);
  const report = {
    fps: Math.round(((p.drawn - d0) / 3) * 10) / 10,
    drawP95Ms: round(pct(p.drawMs.slice(-(p.drawn - d0)), 0.95)),
    tbtMs: round(sum(p.longTasks.slice(lt0).map((d) => Math.max(0, d - 50)))),
  };
  console.log('PERF cutout', JSON.stringify(report));
  writeFileSync(info.outputPath('cutout.json'), JSON.stringify(report));
});
