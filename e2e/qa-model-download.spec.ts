// Speech model download (docs/12 stage 5): large files come in 16 MiB parts — from Kadr's own site as files, from
// Hugging Face (the fallback) as byte ranges — each checked by sha256 and kept, so a connection that breaks, hangs
// or sends broken bytes costs one part, never the whole model, and never a wait without end. These tests break the
// network on the way to both and check what the person gets.
import { expect, test, type Page, type Route } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const MiB16 = 2 ** 24;

test.use({ serviceWorkers: 'block' }); // the speech worker's requests must reach the routes

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    const seen: string[] = ((window as unknown as { __toasts: string[] }).__toasts = []);
    new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => {
      if (!seen.includes(el.textContent ?? '')) seen.push(el.textContent ?? '');
    })).observe(document, { subtree: true, childList: true });
  });
});
const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);

/** Requests for Whisper's large files, from Kadr's site (…onnx.parts/<i>) or Hugging Face (…onnx with a Range). */
const MODEL_FILES = /\/(encoder|decoder)_model\w*\.onnx(\.parts\/\d+)?$/;
/**
 * The part a request asks for, whatever the host: "encoder@0", "decoder@2" (file, part number); "…@whole" for the
 * whole file. transformers.js's one-byte probes (bytes=0-0) are not downloads and are left out.
 */
const part = (route: Route): string | null => {
  const m = /\/(encoder|decoder)_model\w*\.onnx(?:\.parts\/(\d+))?$/.exec(new URL(route.request().url()).pathname);
  if (!m) return null;
  if (m[2] !== undefined) return `${m[1]}@${m[2]}`;
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
  if (!range) return `${m[1]}@whole`;
  if (range[2] && Number(range[2]) - Number(range[1]) < 1024) return null;
  return `${m[1]}@${Math.floor(Number(range[1]) / MiB16)}`;
};
const fromSite = (route: Route) => route.request().url().includes('.parts/');

async function speechProject(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([fx('speech_en.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
}

test('the connection breaks mid-download: a plain message, and the next tap goes on from the parts already kept', async ({ page }) => {
  test.setTimeout(500_000);
  const asked: string[] = [];
  let broken = true;
  await page.context().route(MODEL_FILES, async (route) => {
    const p = part(route);
    if (p) asked.push(p);
    if (broken && p === 'decoder@2') return route.abort('connectionreset');
    return route.continue();
  });
  await speechProject(page);
  await tool(page, 'Captions').click();
  await expect.poll(() => toasts(page), { timeout: 240_000 }).toContainEqual(expect.stringContaining('The speech model download stopped'));
  expect((await toasts(page)).join(' ')).not.toMatch(/Failed to fetch|HTTP|part \d/); // the person's words, not the engine's
  const first = [...asked];
  expect(first.filter((p) => p === 'decoder@2').length).toBe(4); // tried four times, with pauses
  expect(first).toEqual(expect.arrayContaining(['encoder@0', 'encoder@1', 'decoder@0', 'decoder@1']));
  expect(first.every((p) => !p.endsWith('whole'))).toBe(true); // every large file by parts

  broken = false;
  asked.length = 0;
  await page.getByRole('button', { name: 'Create captions', exact: true }).click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 300_000 });
  // Only what was missing: the decoder's first two parts were kept before its third broke (parts go in order).
  expect(asked).toEqual(expect.arrayContaining(['decoder@2', 'decoder@3']));
  expect(asked.filter((p) => p === 'decoder@0' || p === 'decoder@1')).toEqual([]);
});

test('a broken part is caught by its checksum and a hung part is asked for again: the captions are made', async ({ page }) => {
  test.setTimeout(500_000);
  const asked: string[] = [];
  await page.context().route(MODEL_FILES, async (route) => {
    const p = part(route);
    if (p) asked.push(p);
    const n = asked.filter((x) => x === p).length;
    if (p === 'encoder@0' && n === 1) { // the right size, one byte wrong
      const res = await route.fetch();
      const body = await res.body();
      body[1000] ^= 0xff;
      return route.fulfill({ response: res, body });
    }
    if (p === 'decoder@1' && n === 1) return; // sends nothing: hangs until the part loader gives up on it
    return route.continue();
  });
  await speechProject(page);
  await tool(page, 'Captions').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  expect(asked.filter((p) => p === 'encoder@0')).toHaveLength(2);
  expect(asked.filter((p) => p === 'decoder@1')).toHaveLength(2);
  expect(await toasts(page)).toEqual([]);
});

test('Kadr\'s site is down and the fallback host ignores Range (as WebKit under a service worker did): the file comes whole, checked part by part', async ({ page }) => {
  test.setTimeout(500_000);
  const asked: string[] = [];
  await page.context().route(MODEL_FILES, async (route) => {
    if (fromSite(route)) return route.abort('connectionrefused');
    const p = part(route);
    if (p) asked.push(p);
    const headers = { ...route.request().headers() };
    delete headers.range;
    return route.continue({ headers });
  });
  await speechProject(page);
  await tool(page, 'Captions').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  // One ranged try per file, answered with the whole file, then that whole file read once and cut into parts.
  expect(asked.filter((p) => p.endsWith('@whole')).sort()).toEqual(['decoder@whole', 'encoder@whole']);
  expect(await toasts(page)).toEqual([]);
});

test('Kadr\'s site does not have the file (404: a tab of an older Kadr after the models moved on): Hugging Face takes over, and the site is not asked again when Hugging Face stumbles', async ({ page }) => {
  test.setTimeout(500_000);
  const site: string[] = [], asked: string[] = [];
  await page.context().route(MODEL_FILES, async (route) => {
    const p = part(route);
    if (fromSite(route)) { if (p) site.push(p); return route.fulfill({ status: 404, body: 'Not Found' }); }
    if (p) asked.push(p);
    if (p === 'decoder@1' && asked.filter((x) => x === p).length === 1) return route.abort('connectionreset');
    return route.continue();
  });
  await speechProject(page);
  await tool(page, 'Captions').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  expect(site.sort()).toEqual(['decoder@0', 'encoder@0']); // one look per file, not one per stumble
  expect(asked.filter((p) => p === 'decoder@1')).toHaveLength(2);
  expect(await toasts(page)).toEqual([]);
});

test('a model kept whole by an older Kadr moves into parts without being downloaded again', async ({ page }) => {
  test.setTimeout(500_000);
  await speechProject(page);
  // As Kadr ≤ 1.4.16 left it: whole files in transformers.js's cache, asked for by "main".
  await page.evaluate(async () => {
    const cache = await caches.open('transformers-cache');
    for (const f of ['encoder_model_quantized', 'decoder_model_merged_quantized']) {
      const url = `https://huggingface.co/onnx-community/whisper-base_timestamped/resolve/main/onnx/${f}.onnx`;
      await cache.put(url, await fetch(url));
    }
  });
  const asked: string[] = [];
  await page.context().route(MODEL_FILES, async (route) => {
    const p = part(route);
    if (p) asked.push(p);
    return route.continue();
  });
  await tool(page, 'Captions').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 300_000 });
  expect(asked).toEqual([]);
  const left = await page.evaluate(async () => (await (await caches.open('transformers-cache')).keys()).map((r) => r.url).filter((u) => u.includes('whisper') && u.endsWith('.onnx')));
  expect(left).toEqual([]); // the old whole copies are gone: stored once, not twice
});
