// Slowness as a failure (audit V-214). Tests wait up to minutes, so a screen answering in 20 s or a 6 s clip exporting
// in 2 minutes passed. These bounds are on a Mac: generous enough for a busy machine, far below what a person would call
// broken. They do not replace the phone budgets of CLAUDE.md §5, which only a phone can measure.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const BUDGET_MS = { start: 8000, editor: 5000, import: 8000, sheet: 3000, export: 40_000 };

test('start, a new project, an import, a tool sheet and a 6 s export each fit their budget', async ({ page }, info) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
  const took: Record<string, number> = {};
  const timed = async (name: keyof typeof BUDGET_MS, step: () => Promise<unknown>) => { const t = Date.now(); await step(); took[name] = Date.now() - t; };

  await timed('start', async () => { await page.goto('./'); await expect(page.getByRole('button', { name: 'New project' })).toBeVisible({ timeout: 60_000 }); });
  await timed('editor', async () => {
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  });
  await timed('import', async () => {
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Media', exact: true }).click();
    await (await chooser).setFiles(fx('landscape.mp4'));
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  });
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await timed('sheet', async () => {
    await page.getByRole('button', { name: 'Speed', exact: true }).click();
    await expect(page.getByRole('dialog', { name: 'Speed' })).toBeVisible({ timeout: 60_000 });
  });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await timed('export', async () => {
    await page.getByRole('button', { name: 'Export video' }).click();
    await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 150_000 });
  });
  console.log(`budgets, ms (${info.project.name}): ${JSON.stringify(took)}`);
  for (const k of Object.keys(BUDGET_MS) as (keyof typeof BUDGET_MS)[]) expect.soft(took[k], `${k}: budget ${BUDGET_MS[k]} ms`).toBeLessThanOrEqual(BUDGET_MS[k]);
});

// The first visit's code, CLAUDE.md §5: at most 250 KB of JS (gzip) before the editor can be used (audit V-143). Counted
// in the page: every script whose request started before the editor's preview was in the document, home screen idle
// included (the page sits on the home screen until the network is quiet). Sizes are gzip level 6, what GitHub Pages
// sends (index-*.js of v1.9.11 on the live site: 93,015 bytes; gzip -6 of the same file: 92,185). The service worker's
// precache runs behind the page and is not counted: it is blocked here.
const FIRST_LOAD_KB = 250;

test.describe('the first visit', () => {
  test.use({ serviceWorkers: 'block' });
  test('downloads at most 250 KB of JS (gzip) before the editor is shown', async ({ page, request }, info) => {
    test.setTimeout(120_000);
    await page.addInitScript(() => {
      localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
      localStorage.setItem('kadr.locale', 'en');
      performance.setResourceTimingBufferSize(2000);
      const w = window as unknown as { __editorAt?: number };
      new MutationObserver((_m, o) => {
        if (!document.querySelector('.preview-canvas')) return;
        w.__editorAt = performance.now();
        o.disconnect();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
    await page.waitForLoadState('networkidle');
    const { at, scripts } = await page.evaluate(() => ({
      at: (window as unknown as { __editorAt: number }).__editorAt,
      scripts: performance.getEntriesByType('resource').filter((e) => /\.m?js(\?|$)/.test(new URL(e.name).pathname)).map((e) => ({ url: e.name, start: e.startTime })),
    }));
    // WebKit lists the entry script twice; a second request of one address comes from the cache, so each counts once.
    const first = new Map<string, number>();
    for (const s of scripts) first.set(s.url, Math.min(s.start, first.get(s.url) ?? Infinity));
    expect(at, 'the preview canvas was seen').toBeGreaterThan(0);
    const { gzipSync } = await import('node:zlib');
    const weigh = async (url: string) => gzipSync(await (await request.get(url)).body()).length;
    const rows = await Promise.all([...first].map(async ([url, start]) => ({ url, gz: await weigh(url), before: start < at })));
    const kb = (xs: typeof rows) => Math.round(xs.reduce((a, r) => a + r.gz, 0) / 102.4) / 10;
    const before = rows.filter((r) => r.before);
    const name = (u: string) => new URL(u).pathname.split('/').pop();
    console.log(`first visit, JS gzip KB (${info.project.name}): before the editor ${kb(before)} [${before.sort((a, b) => b.gz - a.gz).map((r) => `${name(r.url)} ${Math.round(r.gz / 102.4) / 10}`).join(', ')}]; after it ${kb(rows.filter((r) => !r.before))}`);
    expect(kb(before), `JS before the editor is shown: budget ${FIRST_LOAD_KB} KB gzip`).toBeLessThanOrEqual(FIRST_LOAD_KB);
  });
});

// "Hide faces" and "Cutout" are worked out off the page's thread (audit V-167, F-07): the detector's nine passes a frame
// and the segmenter's read-back held up the interface and the preview together. Seen by where MediaPipe lives: the
// page neither loads its runtime nor fetches its models; the vision worker does. Then the preview plays both. The page's
// CSP does not reach a worker: MediaPipe's telemetry (sent every 60 s) must still go nowhere, so the test waits past it.
test('hiding faces and cutting out the person run in a worker, not on the page', async ({ page }) => {
  test.setTimeout(420_000);
  const out: string[] = [];
  page.context().on('request', (r) => { if (!/^(blob|data):/.test(r.url()) && !['127.0.0.1', 'localhost'].includes(new URL(r.url()).hostname)) out.push(`${r.method()} ${r.url()}`); });
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
  await (await chooser).setFiles(fx('walk.mp4'));
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1, { timeout: 60_000 });
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Hide faces', exact: true }).click();
  const hide = page.getByRole('switch', { name: 'Hide faces automatically' });
  await hide.click();
  const modelsAt = Date.now();
  await expect(hide).toBeChecked({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await page.getByRole('button', { name: 'Cutout', exact: true }).click();
  // Headless Chromium draws WebGL in software: the segmenter's GPU setup took 86–101 s at load 40, with MediaPipe on the
  // page as in the worker (both builds, 2026-11-14); WebKit 5–8 s.
  await expect(page.getByRole('button', { name: 'Cutout', exact: true })).toHaveAttribute('aria-pressed', 'true', { timeout: 180_000 });
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 0; });
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.waitForTimeout(2000);
  const mediapipe = /vision_wasm_internal|\.tflite/;
  const onPage = await page.evaluate((re) => ({
    scripts: [...document.scripts].map((s) => s.src).filter((s) => new RegExp(re).test(s)),
    fetched: performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new RegExp(re).test(n)),
  }), mediapipe.source);
  expect(onPage.scripts, 'MediaPipe runtime loaded into the page').toEqual([]);
  expect(onPage.fetched, 'MediaPipe files fetched by the page').toEqual([]);
  const inWorkers = (await Promise.all(page.workers().map((w) => w.evaluate((re) => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => new RegExp(re).test(n)), mediapipe.source).catch(() => [] as string[])))).flat();
  expect(inWorkers.some((n) => /blaze_face/.test(n)), 'the face model is fetched by a worker').toBe(true);
  expect(inWorkers.some((n) => /selfie_segmenter/.test(n)), 'the segmenter model is fetched by a worker').toBe(true);
  await page.waitForTimeout(Math.max(0, modelsAt + 70_000 - Date.now())); // MediaPipe's telemetry goes every 60 s
  expect(out, 'requests to anywhere but this site').toEqual([]);
});
