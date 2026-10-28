// Speech model download (docs/12 stage 5): large files come in 16 MiB parts, each checked by sha256 and kept, so a
// connection that breaks, hangs or sends broken bytes costs one part, never the whole model, and never a wait
// without end. These tests break the network on the way to Hugging Face and check what the person gets.
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

/**
 * Model parts asked of Hugging Face: "encoder@0", "decoder@2" (file, part number). transformers.js's own one-byte
 * probes (bytes=0-0, it checks a file is there) are not downloads and are left out.
 */
const part = (route: Route): string | null => {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range ?? '');
  const file = /\/(encoder|decoder)_model[\w]*\.onnx$/.exec(new URL(route.request().url()).pathname)?.[1];
  if (!file) return null;
  if (!range) return `${file}@whole`;
  if (range[2] && Number(range[2]) - Number(range[1]) < 1024) return null;
  return `${file}@${Math.floor(Number(range[1]) / MiB16)}`;
};

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
  await page.context().route(/huggingface\.co\/.+_model\w*\.onnx$/, async (route) => {
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
  await page.context().route(/huggingface\.co\/.+_model\w*\.onnx$/, async (route) => {
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

test('a host that ignores Range (WebKit under a service worker drops it): the file comes whole, checked part by part', async ({ page }) => {
  test.setTimeout(500_000);
  const asked: string[] = [];
  await page.context().route(/huggingface\.co\/.+_model\w*\.onnx$/, async (route) => {
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
  await page.context().route(/huggingface\.co\/.+_model\w*\.onnx$/, async (route) => {
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
