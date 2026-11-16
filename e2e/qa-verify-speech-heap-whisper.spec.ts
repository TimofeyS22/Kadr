// Verification, lane E4 (docs/21 §5), row V-136: the speech heap under Whisper. qa-speech-heap.spec.ts runs Whisper
// through an English interface on Russian speech and answers only the first question; since docs/20 (ADR-С2, С3) the
// run then asks whether to take the Russian model ("This is Russian speech…"), and the old test waits for captions
// that never come — red at any load. Here that question is answered "Not now", which keeps Whisper at work
// (qa-captions-honest.spec.ts), and the heap is read after every piece as in the old test.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

// Routing is on, and a service worker would answer the worker script itself.
test.use({ serviceWorkers: 'block' });

/** The heap's size each time a piece of speech has been read (`self.__heaps`, MB); `leakMb` grows it per piece. */
const shim = (leakMb: number) => `{const N=WebAssembly.Memory;let heap=null;function M(d){const m=new N(d);if(d&&d.shared)heap=m;return m}
M.prototype=N.prototype;WebAssembly.Memory=M;self.__heaps=[];self.__model='';const P=self.postMessage.bind(self);
self.postMessage=(m,t)=>{if(m&&m.type==='result'&&heap){${leakMb ? `heap.grow(${leakMb * 16});` : ''}self.__heaps.push(heap.buffer.byteLength/1048576)}return P(m,t)}}\n`;

async function watchHeap(context: BrowserContext, leakMb = 0) {
  await context.route(/\/assets\/asr\.worker-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: shim(leakMb) + (await res.text()) });
  });
}

async function whisperHeap(page: Page): Promise<{ heaps: number[]; models: string[] }> {
  const models: string[] = [];
  page.on('request', (r) => { if (/\.onnx(\.parts\/\d+)?(\?|$)/.test(r.url())) models.push(r.url()); });
  await page.addInitScript(() => {
    localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('speech_ru_long.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  const ask = page.locator('.model-ask');
  await expect(ask, 'Whisper base first, for an English interface').toContainText('77 MB');
  await page.getByRole('button', { name: 'Download and make captions', exact: true }).click();
  // The speech is Russian: "Not now" keeps Whisper reading it (the question is the change of docs/20).
  await expect(ask).toContainText('This is Russian speech', { timeout: 400_000 });
  await ask.getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 400_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  const worker = page.workers().filter((w) => /asr\.worker/.test(w.url())).at(-1);
  expect(worker, 'the speech worker is still there to ask').toBeTruthy();
  return { heaps: await worker!.evaluate(() => (self as unknown as { __heaps: number[] }).__heaps), models };
}

test('the speech heap does not grow from one piece of speech to the next under Whisper (V-136)', async ({ page, context }, info) => {
  test.setTimeout(900_000);
  await watchHeap(context);
  const { heaps, models } = await whisperHeap(page);
  console.log(`Whisper speech heap after each piece, MB (${info.project.name}): ${heaps.map(Math.round).join(' ')}`);
  expect(models.some((u) => /whisper/i.test(u)), 'Whisper did the reading').toBe(true);
  expect(models.filter((u) => /gigaam|fastconformer/i.test(u)), 'and no Russian model was fetched').toEqual([]);
  expect(heaps.length, 'enough pieces to see a leak').toBeGreaterThanOrEqual(3);
  expect(heaps.at(-1)! - heaps[0], 'the heap after the last piece is the heap after the first').toBeLessThanOrEqual(8);
});

test('the Whisper check sees a leak: a heap that grows by 32 MB a piece fails it', async ({ page, context }) => {
  test.setTimeout(900_000);
  await watchHeap(context, 32);
  const { heaps } = await whisperHeap(page);
  expect(heaps.length).toBeGreaterThanOrEqual(3);
  expect(heaps.at(-1)! - heaps[0]).toBeGreaterThanOrEqual(32 * (heaps.length - 1));
});
