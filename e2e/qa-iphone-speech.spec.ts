// iPhone speech (docs/12 stages 0–1): ONNX Runtime asked for a 4 GB shared WebAssembly heap, iOS Safari cannot
// reserve one, and speech never started on the owner's iPhone ("no available backend found. ERR: [wasm] RangeError:
// Out of memory"). A Mac reserves 4 GB without a word, so these tests make the speech worker's WebAssembly refuse a
// shared memory above a limit, as iOS does, and check that captions and the diagnostics screen still work.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

// Routing is on (which also turns the HTTP cache off), and a service worker would answer the worker script itself.
test.use({ serviceWorkers: 'block' });

/** iOS Safari, in the speech worker: a shared memory above `limitMb` cannot be reserved. */
const iosShim = (limitMb: number) => `{const N=WebAssembly.Memory;function M(d){if(d&&d.shared&&(d.maximum??0)>${limitMb * 16})throw new RangeError('Out of memory');return new N(d)}M.prototype=N.prototype;Object.defineProperty(WebAssembly,'Memory',{value:M,writable:true,configurable:true});}\n`;

/** Each new speech worker gets the next limit (0: none, the Mac as it is); the last one repeats. */
async function likeIphone(context: BrowserContext, limits: number[]) {
  let n = 0;
  await context.route(/\/assets\/asr\.worker-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    const limit = limits[Math.min(n++, limits.length - 1)];
    await route.fulfill({ response: res, body: (limit ? iosShim(limit) : '') + (await res.text()) });
  });
}

/** Requests of the page and its workers: the engine must come from our own origin, not a CDN. */
function requests(context: BrowserContext): string[] {
  const urls: string[] = [];
  context.on('request', (r) => { if (!/^(blob|data):/.test(r.url())) urls.push(r.url()); });
  return urls;
}

const report = (page: Page) => page.locator('.diag-report');

test('?diag on an iPhone-like device: the speech engine starts with a 1 GB heap, Russian speech is read, the report copies', async ({ page, context, browserName }) => {
  test.setTimeout(600_000);
  await likeIphone(context, [1024]);
  const urls = requests(context);
  await page.addInitScript(() => localStorage.setItem('kadr.locale', 'ru'));
  await page.goto('./?diag');
  await expect(report(page)).toContainText('## Video export', { timeout: 120_000 });
  await expect(page.locator('.diag [role=status]')).toHaveCount(0, { timeout: 60_000 }); // every step finished
  const text = (await report(page).textContent()) ?? '';
  for (const section of ['## Device', '## Codecs', '## Speech engine', '## WebAssembly memory', '## Address space pool', '## Video export']) expect(text).toContain(section);
  // The pool (docs/12 §1.3 item 14): how many 4 GiB reservations the process gets, and the heap beside three of them.
  expect(text).toMatch(/shared WebAssembly memories of 4 GiB at once: \d+/);
  expect(text).toMatch(/resizable ArrayBuffers of 4 GiB at once: \d+/);
  expect(text).toMatch(/heap 1024 MB with 3 resizable 4 GiB alive \(other worker\): \S+/);
  expect(text).toMatch(/## Speech engine\nresult: ok\n/);
  expect(text).toMatch(/heap: [\d.]+ MB of 1024 MB max/);
  // The plain ONNX Runtime build, from our own origin; nothing from the CDN transformers.js would pick.
  expect(urls.filter((u) => u.includes('cdn.jsdelivr.net'))).toEqual([]);
  expect(urls.some((u) => /\/assets\/ort-wasm-simd-threaded-[\w-]+\.wasm$/.test(u))).toBe(true);
  expect(urls.some((u) => u.includes('asyncify'))).toBe(false);

  // The Russian model downloads, fits in the capped heap and reads the live speech sample.
  await page.getByRole('button', { name: 'Русская речь, 225 MB' }).click();
  await expect(report(page)).toContainText(/## Speech model: ru\nresult: (ok|FAILED)/, { timeout: 500_000 });
  const ru = (await report(page).textContent())?.split('## Speech model: ru')[1] ?? '';
  console.log(`diag ${browserName}, GigaAM with a 1 GB heap:${ru}`);
  expect(ru).toContain('result: ok');
  expect(ru).toMatch(/text: .*[а-яё]{4,}/i);
  const used = Number(/heap: ([\d.]+) MB of 1024 MB max/.exec(ru)?.[1]);
  expect(used).toBeGreaterThan(200); // the model really is in this heap
  expect(used).toBeLessThanOrEqual(1024);

  if (browserName === 'chromium') { // WebKit gives no clipboard permission to grant
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.getByRole('button', { name: 'Скопировать отчёт' }).click();
    await expect(page.getByRole('button', { name: 'Скопировано' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('## Speech model: ru\nresult: ok');
  }
});

test('?diag where even 1 GB is refused: the heap steps down and says what was refused', async ({ page, context }) => {
  test.setTimeout(180_000);
  await likeIphone(context, [600]);
  await page.goto('./?diag');
  await expect(report(page)).toContainText(/## Speech engine\nresult: ok/, { timeout: 120_000 });
  await expect(report(page)).toContainText(/heap: [\d.]+ MB of 512 MB max\nheap refused: 1024 MB, 768 MB/);
});

test('iPhone-like memory, Russian interface, one tap: Russian captions (the compact model on an iPhone)', async ({ page, context }) => {
  test.setTimeout(500_000);
  await likeIphone(context, [1024]);
  await page.addInitScript(() => { localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.hint.move', '1'); });
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Медиа').click();
  await (await chooser).setFiles([fx('speech_ru.mp4')]); // «Привет! Это видеоредактор Кадр. Всё работает прямо на телефоне.»
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  expect(errors.filter((e) => /speech engine|no available backend/i.test(e))).toEqual([]);
});

test('a speech engine that ran out of memory says so plainly, and the next tap starts afresh and works', async ({ page, context }) => {
  test.setTimeout(500_000);
  await likeIphone(context, [100, 0]); // the first worker can reserve nothing; the next one is a healthy device
  await page.addInitScript(() => { localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.hint.move', '1'); });
  const toasts: string[] = [];
  await page.exposeFunction('__toast', (s: string) => { if (!toasts.includes(s)) toasts.push(s); });
  await page.addInitScript(() => new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => {
    void (window as unknown as { __toast(s: string): Promise<void> }).__toast(el.textContent ?? '');
  })).observe(document, { subtree: true, childList: true }));
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Медиа').click();
  await (await chooser).setFiles([fx('speech_ru.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click();
  await expect.poll(() => toasts.length, { timeout: 120_000 }).toBeGreaterThan(0);
  expect(toasts[0]).toContain('не хватило памяти для модели речи');
  expect(toasts[0]).not.toMatch(/backend|RangeError|wasm/i); // the engine's own words go to the log, not to the person
  // Again: a fresh worker, not the one whose engine failed (ONNX Runtime would refuse it for good).
  await page.getByRole('button', { name: 'Создать субтитры', exact: true }).click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  expect(toasts).toHaveLength(1);
});
