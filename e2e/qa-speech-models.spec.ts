// Speech models without errors (docs/12 rule 10, v1.4.18): the model is chosen for the device before anything is
// downloaded, a model that does not fit in memory gives way to a lighter one instead of an error, and the files come
// from Kadr's own site, with Hugging Face only as the fallback.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.use({ serviceWorkers: 'block' }); // the speech worker's requests must reach the routes

/** Every request of the page and its workers, as host + path. */
function requests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (r) => { if (!/^(blob|data):/.test(r.url())) { const u = new URL(r.url()); urls.push(u.host + u.pathname); } });
  return urls;
}
const from = (urls: string[], repo: RegExp) => urls.filter((u) => repo.test(u));

/**
 * The speech models the page asks its worker to load, in order (since this page load). Requests alone cannot tell:
 * a model kept on the device loads without the network.
 */
async function recordLoads(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __loads: string[] };
    w.__loads = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (this: Worker, ...args: Parameters<Worker['postMessage']>) {
      const msg = args[0] as { type?: string; model?: string } | null;
      if (msg?.type === 'load' && msg.model) w.__loads.push(msg.model);
      return post.apply(this, args as [unknown, StructuredSerializeOptions]);
    };
  });
}
const loads = (page: Page) => page.evaluate(() => (window as unknown as { __loads: string[] }).__loads);
const FAST = /stt_ru_fastconformer/, GIGAAM = /gigaam-v3-onnx/, WHISPER = /whisper-/, HF = /huggingface\.co|\.hf\.co/;

/** iOS Safari, in the speech worker: a shared memory above `limitMb` cannot be reserved (qa-iphone-speech.spec.ts). */
const iosShim = (limitMb: number) => `{const N=WebAssembly.Memory;function M(d){if(d&&d.shared&&(d.maximum??0)>${limitMb * 16})throw new RangeError('Out of memory');return new N(d)}M.prototype=N.prototype;Object.defineProperty(WebAssembly,'Memory',{value:M,writable:true,configurable:true});}\n`;
async function memoryLimit(context: BrowserContext, limitMb: number) {
  await context.route(/\/assets\/asr\.worker-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: iosShim(limitMb) + (await res.text()) });
  });
}

async function russianCaptions(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.hint.move', '1'); });
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Медиа').click();
  await (await chooser).setFiles([fx('speech_ru.mp4')]); // «Привет! Это видеоредактор Кадр. Всё работает прямо на телефоне.»
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click(); // one tap: the default model for this device
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  return page.locator('.clip-caption').textContent();
}

test('a phone (an iPhone; Android with 4 GB): Russian captions come from the compact model on Kadr\'s site — no GigaAM, no Whisper, no Hugging Face', async ({ page, context, browserName }) => {
  test.setTimeout(500_000);
  if (browserName !== 'webkit') await page.addInitScript(() => Object.defineProperty(navigator, 'deviceMemory', { value: 4 }));
  await recordLoads(page);
  const urls = requests(context);
  const text = (await russianCaptions(page))?.toLowerCase() ?? '';
  for (const w of ['привет', 'видеоредактор', 'телефоне']) expect(text).toContain(w);
  expect(await loads(page)).toEqual(['ru-fast']);
  expect(from(urls, FAST).filter((u) => u.includes('/models/')).length).toBeGreaterThan(0);
  expect(from(urls, GIGAAM)).toEqual([]);
  expect(from(urls, WHISPER)).toEqual([]);
  expect(from(urls, HF)).toEqual([]);
});

test('GigaAM does not fit in memory: the compact model takes over without a word, and next time is chosen directly', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'an iPhone starts with the compact model (test above)');
  test.setTimeout(600_000);
  // 400 MB of heap at most: the compact model needs ~360, GigaAM ~480 (?diag, 2026-10-29).
  await memoryLimit(context, 400);
  await recordLoads(page);
  const urls = requests(context);
  await russianCaptions(page);
  expect(await loads(page)).toEqual(['ru', 'ru-fast']); // GigaAM first (a phone with the memory of a desktop), then the compact one
  expect(from(urls, GIGAAM).length).toBeGreaterThan(0);
  expect(from(urls, FAST).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('kadr.speech.tooBig') ?? '{}')))).toEqual(['ru']);
  // Next time, in a new project: straight to the compact model (now kept on the device), GigaAM is not tried.
  await russianCaptions(page);
  expect(await loads(page)).toEqual(['ru-fast']);
});

test('Kadr\'s site does not answer for the models: they come from Hugging Face, and the captions are made', async ({ page, context }) => {
  test.setTimeout(500_000);
  await context.route(/\/models\//, (route) => route.abort('connectionrefused'));
  const urls = requests(context);
  const text = (await russianCaptions(page))?.toLowerCase() ?? '';
  expect(text).toContain('привет');
  expect(from(urls, HF).length).toBeGreaterThan(0);
});
