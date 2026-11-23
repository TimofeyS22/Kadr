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

/**
 * `questions`: what the sheet asks before each model download (audit V-181, qa-model-consent.spec.ts), in the order
 * the questions come; each is answered yes. None when the model is on the device already.
 */
async function russianCaptions(page: Page, questions: RegExp[] = [/Один раз скачается \d+ МБ/]) {
  await page.addInitScript(() => { localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.hint.move', '1'); });
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Медиа').click();
  await (await chooser).setFiles([fx('speech_ru.mp4')]); // «Привет! Это видеоредактор Кадр. Всё работает прямо на телефоне.»
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click(); // one tap: the default model for this device
  for (const q of questions) {
    await expect(page.locator('.model-ask')).toContainText(q, { timeout: 400_000 });
    await page.getByRole('button', { name: 'Скачать и сделать субтитры', exact: true }).click();
  }
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  return page.locator('.clip-caption').textContent();
}

test('an Android phone with 4 GB: Russian captions come from the compact model on Kadr\'s site — no GigaAM, no Whisper, no Hugging Face', async ({ page, context, browserName }) => {
  test.skip(browserName === 'webkit', 'an iPhone starts with GigaAM since 2026-11-17 (the owner, after Г4 of docs/20): the test below');
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

test('GigaAM does not fit in memory: the compact model takes over without an error (asked about first, as any download), and next time is chosen directly', async ({ page, context, browserName }) => {
  test.setTimeout(600_000);
  // An iPhone too: it starts with GigaAM, and an older one that cannot hold it gets the compact model this way.
  // 400 MB of heap at most: the compact model needs ~360, GigaAM ~480 (?diag, 2026-10-29).
  await memoryLimit(context, 400);
  await recordLoads(page);
  const urls = requests(context);
  // Yes to GigaAM; it does not fit; the compact model is another 132 MB, so it is asked about too (audit V-181).
  await russianCaptions(page, [/Один раз скачается 225 МБ/, /не поместилась в память устройства.*Один раз скачается 132 МБ/]);
  expect(await loads(page)).toEqual(['ru', 'ru-fast']); // GigaAM first (a phone with the memory of a desktop), then the compact one
  expect(from(urls, GIGAAM).length).toBeGreaterThan(0);
  expect(from(urls, FAST).length).toBeGreaterThan(0);
  expect(await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem('kadr.speech.tooBig') ?? '{}')))).toEqual(['ru']);
  // The model that did not fit is taken off the device: its 225 MB would only take the compact model's room.
  expect(await page.evaluate(async () => (await (await caches.open('kadr-model-parts')).keys()).filter((r) => r.url.includes('gigaam')).length)).toBe(0);
  // Next time, in a new project: straight to the compact model (now kept on the device: no question), GigaAM is not tried.
  // WebKit's test profile keeps no Cache from one page to the next (measured 2026-11-18: 8 parts of the compact
  // model before `goto`, 0 after), so the next visit is checked in Chromium only. A real iPhone keeps the model
  // (L5, Г4 on v1.9.12: «она уже на устройстве» on the next page).
  if (browserName === 'webkit') return;
  await russianCaptions(page, []);
  expect(await loads(page)).toEqual(['ru-fast']);
});

/**
 * Hugging Face, played by the test build's own copy of the models: the same addresses and byte ranges, at the
 * stand's speed. The test below checks that Kadr goes over to the second host, not how fast that host is today
 * (2026-11-23: the real one gave this Mac 116 KB/s, and 225 MB did not come within the test's time).
 */
async function huggingFaceFromMirror(context: BrowserContext, baseURL: string) {
  const PART = 16 * 1024 * 1024; // models.json "part"
  const cors = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-expose-headers': '*' };
  await context.route(/^https:\/\/huggingface\.co\//, async (route) => {
    const req = route.request();
    if (req.method() === 'OPTIONS') { await route.fulfill({ status: 204, headers: cors }); return; }
    const key = new URL(req.url()).pathname.slice(1);
    const mirror = new URL(`models/${key}`, baseURL).href; // asked for by the test itself: the page's own way there is cut
    const range = /^bytes=(\d+)-(\d+)$/.exec(req.headers().range ?? '');
    if (!range) {
      const res = await fetch(mirror);
      await route.fulfill(res.ok ? { status: 200, headers: cors, body: Buffer.from(await res.arrayBuffer()) } : { status: 404, headers: cors });
      return;
    }
    // A large file: the mirror keeps it as parts; a range is a part, or the rest of one (SW-S-3).
    const from = Number(range[1]), to = Number(range[2]), i = Math.floor(from / PART);
    const res = await fetch(`${mirror}.parts/${i}`);
    if (!res.ok) { await route.fulfill({ status: 404, headers: cors }); return; }
    const part = Buffer.from(await res.arrayBuffer());
    const body = part.subarray(from - i * PART, to - i * PART + 1);
    await route.fulfill({ status: 206, headers: { ...cors, 'content-range': `bytes ${from}-${to}/*`, 'content-type': 'application/octet-stream' }, body });
  });
}

test('Kadr\'s site does not answer for the models: they come from the second host (Hugging Face), and the captions are made', async ({ page, context, baseURL }) => {
  test.setTimeout(500_000);
  await context.route(/\/models\//, (route) => route.abort('connectionrefused'));
  await huggingFaceFromMirror(context, baseURL!);
  const urls = requests(context);
  const text = (await russianCaptions(page))?.toLowerCase() ?? '';
  expect(text).toContain('привет');
  expect(from(urls, HF).length).toBeGreaterThan(0);
  // Every large part came from the second host, as a byte range; none from the site.
  expect(from(urls, HF).filter((u) => u.endsWith('.onnx')).length).toBeGreaterThan(1);
});
