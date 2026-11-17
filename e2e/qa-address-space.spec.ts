// Address space (docs/12 §1.3 item 14, stage 1): in WebKit every ArrayBuffer and WebAssembly memory of the process
// draws on one pool of address space, and a resizable ArrayBuffer reserves its whole maxByteLength at once.
// mediabunny's BufferTarget asked for 4 GiB per output and its MP4 muxer made one more per output for itself; they
// go only when the main thread collects garbage, which the speech worker cannot cause. A Mac's pool holds ~14 such
// reservations (measured, `?diag`), iOS's a fraction. These tests catch it on a Mac: nothing on the main thread may
// reserve 256 MiB or more, and with an iPhone-sized pool the speech heap still fits after exports.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

// Routing is on (the speech worker is rewritten in the pool test); a service worker would answer it itself.
test.use({ serviceWorkers: 'block' });

/** Records every ArrayBuffer that reserves 256 MiB or more on the main thread, with where it came from. */
async function watchReservations(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined });
    const big: string[] = ((window as unknown as { __reserved: string[] }).__reserved = []);
    const Native = ArrayBuffer;
    const Watched = new Proxy(Native, {
      construct(target, args: [number, { maxByteLength?: number }?], newTarget) {
        const max = args[1]?.maxByteLength ?? 0;
        if (max >= 2 ** 28) big.push(`${max / 2 ** 30} GiB at ${new Error().stack?.split('\n').slice(2, 4).join(' ← ').trim()}`);
        return Reflect.construct(target, args, newTarget) as ArrayBuffer;
      },
    });
    Object.defineProperty(window, 'ArrayBuffer', { value: Watched, writable: true, configurable: true });
  });
}
const reserved = (page: Page) => page.evaluate(() => (window as unknown as { __reserved: string[] }).__reserved);

/** The file system refuses: the export goes to memory, the path every older iPhone takes. */
const noFileSystem = (page: Page) => page.addInitScript(() => {
  StorageManager.prototype.getDirectory = () => Promise.reject(new DOMException('not here', 'SecurityError'));
});

async function exportAs(page: Page, format: 'Video' | 'Audio', button: string, file: string) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: format, exact: true }).click();
  if (format === 'Video') await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: button }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration,format_name', '-of', 'json', file]).toString()) as {
    streams: { codec_type: string }[]; format: { duration: string; format_name: string };
  };
}

test('no 4 GiB reservations: a reel, a video export to memory, an audio export and enhance voice reserve nothing big; the files are whole', async ({ page }, info) => {
  test.setTimeout(500_000);
  await watchReservations(page);
  await noFileSystem(page);
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Reel in 1 tap/ }).click();
  await (await chooser).setFiles(fx('reel_ru.mp4'));
  // The question before a model download (audit V-181) comes once for the first model, and once more when the speech
  // turns out Russian and the Russian model reads it better (docs/20): each is answered (SW-B-4: the test waited at the
  // second for 300 s, on v1.9.11 already).
  const ask = page.getByRole('button', { name: 'Download and make the reel', exact: true });
  await ask.click({ timeout: 60_000 });
  await expect(async () => {
    if (await ask.isVisible()) await ask.click();
    await expect(page.locator('.reel-done')).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 300_000 });
  const afterReel = await reserved(page);
  await page.getByRole('button', { name: 'Watch the reel' }).click();
  await expect(page.locator('.sheet')).toHaveCount(0);
  await page.getByRole('button', { name: 'Pause' }).click();
  const video = await exportAs(page, 'Video', 'Export video', info.outputPath('reel.mp4'));
  expect(video.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Number(video.format.duration)).toBeGreaterThan(5);
  const audio = await exportAs(page, 'Audio', 'Export audio', info.outputPath('reel.m4a'));
  expect(audio.streams.map((s) => s.codec_type)).toEqual(['audio']);
  expect(Math.abs(Number(audio.format.duration) - Number(video.format.duration))).toBeLessThan(0.2);
  // Enhance voice: the processed sound is a new file made in memory, then decoded for the preview.
  if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
  await page.locator('.tl-row.main .clip').first().click();
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Enhance voice' }).check();
  await expect(page.getByRole('switch', { name: 'Enhance voice' })).toBeChecked({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  expect({ afterReel, all: await reserved(page) }).toEqual({ afterReel: [], all: [] });
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

/** iPhone-sized pool (16 GiB, docs/12 §1.3 item 14), nothing collected in time: what the page reserved is gone. */
const POOL_GIB = 16;
const shim = (limitMb: number) => `{const N=WebAssembly.Memory;function M(d){if(d&&d.shared&&(d.maximum??0)>${limitMb * 16})throw new RangeError('Out of memory');return new N(d)}M.prototype=N.prototype;Object.defineProperty(WebAssembly,'Memory',{value:M,writable:true,configurable:true});}\n`;

async function iphonePool(context: BrowserContext, page: Page) {
  await context.route(/\/assets\/asr\.worker-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    const taken = (await reserved(page)).reduce((s, r) => s + Number(r.split(' ')[0]), 0);
    const left = Math.max(0, POOL_GIB - taken - 1) * 1024; // the rest of the process (code, the page, WebGL) takes ~1 GiB
    await route.fulfill({ response: res, body: shim(Math.min(left, 1024) || 1) + (await res.text()) });
  });
}

test('an iPhone-sized address space: after two exports the speech heap still fits and captions are made', async ({ page, context }) => {
  test.setTimeout(500_000);
  await watchReservations(page);
  await noFileSystem(page);
  await iphonePool(context, page);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([fx('speech_en.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  for (const n of [1, 2]) await exportAs(page, 'Video', 'Export video', test.info().outputPath(`v${n}.mp4`));
  await tool(page, 'Captions').click();
  await page.getByRole('button', { name: 'Download and make captions', exact: true }).click({ timeout: 30_000 }); // the question before the first model download (audit V-181)
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 300_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
});

// Canvases are given back, not left to the collector (audit V-169): on an iPhone every canvas of a page draws on one
// memory limit, and full-size frames waiting for a collection make the next canvas fail. Every canvas the page makes is
// counted (the test keeps them, so nothing is collected under it); what still has pixels after an action, outside the
// document, is what the page left to the collector. Done three times, that must not grow: a freeze frame (a full-size
// frame through captureFrame), a reverse and a scrub of twelve steps.
test('freeze frames, a reverse and a scrub leave no canvas with its pixels to the collector (V-169)', async ({ page }, info) => {
  test.setTimeout(400_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1');
    const made: (HTMLCanvasElement | OffscreenCanvas)[] = ((window as unknown as { __canvases: unknown[] }).__canvases = []) as never;
    const create = Document.prototype.createElement;
    Document.prototype.createElement = function (this: Document, name: string, ...rest: unknown[]) {
      const el = (create as (...a: unknown[]) => HTMLElement).call(this, name, ...rest);
      if (String(name).toLowerCase() === 'canvas') made.push(el as HTMLCanvasElement);
      return el;
    } as typeof create;
    if (typeof OffscreenCanvas !== 'undefined') {
      const Native = OffscreenCanvas;
      const Counted = new Proxy(Native, { construct(target, args: [number, number], newTarget) { const c = Reflect.construct(target, args, newTarget) as OffscreenCanvas; made.push(c); return c; } });
      Object.defineProperty(window, 'OffscreenCanvas', { value: Counted, writable: true, configurable: true });
    }
  });
  const left = () => page.evaluate(() => (window as unknown as { __canvases: (HTMLCanvasElement | OffscreenCanvas)[] }).__canvases
    .filter((c) => !(c instanceof HTMLCanvasElement && c.isConnected))
    .reduce((mp, c) => mp + (c.width * c.height) / 1e6, 0));
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(fx('landscape.mp4'));
  const clips = page.locator('.tl-row.main .clip');
  await expect(clips).toHaveCount(1, { timeout: 60_000 });
  const select = async () => {
    const clip = clips.first();
    await expect(async () => {
      if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
      await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
    }).toPass({ timeout: 10_000 });
  };
  const scrub = () => page.evaluate(async () => {
    const el = document.querySelector('.tl-scroll')!;
    for (const f of [0.6, 0.1, 0.8, 0.3, 0.95, 0.05, 0.5, 0.7, 0.2, 0.9, 0.4, 0.15]) { el.scrollLeft = f * (el.scrollWidth - el.clientWidth); await new Promise((r) => setTimeout(r, 120)); }
    el.scrollLeft = 0;
    await new Promise((r) => setTimeout(r, 300));
  });
  const areas: number[] = [];
  for (let round = 0; round < 3; round++) {
    await select();
    await tool(page, 'Freeze').click();
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
    await expect(page.locator('.tl-row.main .clip-image')).toHaveCount(round + 1, { timeout: 30_000 });
    await select();
    await tool(page, 'Reverse').click();
    await expect(page.locator('.busy')).toHaveCount(0, { timeout: 120_000 });
    if (await page.getByRole('button', { name: 'Close tools' }).isVisible()) await page.getByRole('button', { name: 'Close tools' }).click();
    await scrub();
    await page.waitForTimeout(1500); // streams nobody uses are let go after a moment
    areas.push(Math.round((await left()) * 100) / 100);
  }
  console.log(`canvas megapixels outside the page after each round (${info.project.name}): ${areas.join(', ')}`);
  expect(areas[2], 'megapixels of canvases left with their pixels after round 3, against round 1').toBeLessThanOrEqual(areas[0] + 0.1);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});
