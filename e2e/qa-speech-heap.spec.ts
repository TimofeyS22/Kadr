// The speech engine's heap over a long clip (audits V-136, V-182). ONNX Runtime's WebAssembly heap never shrinks, so
// a leak from one piece of speech to the next shows as a heap that is larger after every piece. The audit feared a
// Transformers.js leak that crashed an iPhone tab after 2–3 pieces (on WebGPU, which Kadr does not use): this holds the
// WebAssembly path Kadr does use to it, for Whisper (English interface) and for the Russian model a phone gets.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

// Routing is on, and a service worker would answer the worker script itself.
test.use({ serviceWorkers: 'block' });

/**
 * Put in front of the speech worker: the heap's size each time a piece of speech has been read (`self.__heaps`, MB).
 * With `leakMb`, the heap also grows by that much per piece: the leak this check is there to see (the control).
 */
const shim = (leakMb: number) => `{const N=WebAssembly.Memory;let heap=null;function M(d){const m=new N(d);if(d&&d.shared)heap=m;return m}
M.prototype=N.prototype;WebAssembly.Memory=M;self.__heaps=[];const P=self.postMessage.bind(self);
self.postMessage=(m,t)=>{if(m&&m.type==='result'&&heap){${leakMb ? `heap.grow(${leakMb * 16});` : ''}self.__heaps.push(heap.buffer.byteLength/1048576)}return P(m,t)}}\n`;

async function watchHeap(context: BrowserContext, leakMb = 0) {
  await context.route(/\/assets\/asr\.worker-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: shim(leakMb) + (await res.text()) });
  });
}

const UI = {
  en: { newProject: 'New project', media: 'Media', close: 'Close tools', captions: 'Captions', agree: 'Download and make captions' },
  ru: { newProject: 'Новый проект', media: 'Медиа', close: 'Закрыть инструменты', captions: 'Субтитры', agree: 'Скачать и сделать субтитры' },
};

/** Captions for 101 s of Russian speech in 24 pieces; returns the heap after each piece the engine read. */
async function captionsHeap(page: Page, locale: 'en' | 'ru'): Promise<number[]> {
  const ui = UI[locale];
  await page.addInitScript((l) => {
    localStorage.setItem('kadr.locale', l); localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
  }, locale);
  await page.goto('./');
  await page.getByRole('button', { name: ui.newProject }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: ui.media, exact: true }).click();
  await (await chooser).setFiles([fx('speech_ru_long.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: ui.close }).click();
  await page.getByRole('button', { name: ui.captions, exact: true }).click();
  await page.getByRole('button', { name: ui.agree, exact: true }).click({ timeout: 30_000 }); // the question before the first download (V-181)
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  const worker = page.workers().filter((w) => /asr\.worker/.test(w.url())).at(-1);
  expect(worker, 'the speech worker is still there to ask').toBeTruthy();
  return worker!.evaluate(() => (self as unknown as { __heaps: number[] }).__heaps);
}

for (const locale of ['en', 'ru'] as const) {
  test(`the speech heap does not grow from one piece of speech to the next (${locale === 'en' ? 'Whisper' : 'the Russian model'})`, async ({ page, context }) => {
    test.setTimeout(500_000);
    await watchHeap(context);
    const heaps = await captionsHeap(page, locale);
    console.log(`speech heap after each piece, MB (${locale}): ${heaps.map(Math.round).join(' ')}`);
    expect(heaps.length, 'enough pieces to see a leak').toBeGreaterThanOrEqual(3);
    expect(heaps.at(-1)! - heaps[0], 'the heap after the last piece is the heap after the first').toBeLessThanOrEqual(8);
  });
}

test('the check sees a leak: a heap that grows by 32 MB a piece fails it', async ({ page, context }) => {
  test.setTimeout(500_000);
  await watchHeap(context, 32);
  const heaps = await captionsHeap(page, 'ru');
  expect(heaps.length).toBeGreaterThanOrEqual(3);
  expect(heaps.at(-1)! - heaps[0]).toBeGreaterThanOrEqual(32 * (heaps.length - 1));
});
