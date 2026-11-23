// SW-S-2: a speech model download that stops in the middle never stays on the screen for ever. The owner, 2026-11-23:
// in Kadr opened from the iPhone's Home Screen the model downloaded again (its own storage, apart from Safari's) and
// «зависла на месте». The network is watched already (modelFiles.ts: 20 s without a byte, then the other host); the
// two places with no limit were the part being written to the device, and the page waiting for a worker that went
// silent. Each is made to happen here, once: the first must heal itself, the second must say so and let a tap go on.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.use({ serviceWorkers: 'block' }); // the speech worker's script must reach the route

/** Puts `shim` in front of the speech worker's script. */
async function inWorker(context: BrowserContext, shim: string) {
  await context.route(/\/assets\/asr\.worker-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, body: shim + (await res.text()) });
  });
}
/** True the first time only, in any worker of this profile: the mark is kept in the Cache API. */
const ONCE = "const once=async()=>{if(await caches.has('test-stall-once'))return false;await caches.open('test-stall-once');return true};";
/** The second part of a model written to the device never finishes, once. */
const HUNG_WRITE = `{${ONCE}const put=Cache.prototype.put;let n=0;Cache.prototype.put=async function(...a){if(String(a[0]).includes('__kadr-model-parts')&&++n===2&&await once())return new Promise(()=>{});return put.apply(this,a)};}`;
/** No part is ever written to the Cache Storage: every `put` of a model part stays unfinished, in every worker. */
const DEAD_CACHE = "{const put=Cache.prototype.put;Cache.prototype.put=function(...a){if(String(a[0]).includes('__kadr-model-parts'))return new Promise(()=>{});return put.apply(this,a)};}";
/** The worker goes silent after its third word about the download, once: nothing it says reaches the page. */
const SILENT = `{${ONCE}const post=self.postMessage.bind(self);let n=0,mute=false;self.postMessage=(m,...r)=>{if(mute)return;if(m&&m.type==='download'&&++n===3){mute=true;void once().then((first)=>{mute=first});return}return post(m,...r)};}`;

async function tapCaptions(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.hint.move', '1'); });
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Медиа').click();
  await (await chooser).setFiles([fx('speech_ru.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await tool(page, 'Субтитры').click();
  await expect(page.locator('.model-ask')).toContainText(/Один раз скачается \d+ МБ/);
  await page.getByRole('button', { name: 'Скачать и сделать субтитры', exact: true }).click();
}

test('a part that never finishes being written to the device: the download goes on by itself, and the captions are made', async ({ page, context }) => {
  test.setTimeout(240_000);
  await inWorker(context, HUNG_WRITE);
  const warnings: string[] = [];
  page.on('console', (m) => { if (m.type() === 'warning') warnings.push(m.text()); });
  await tapCaptions(page);
  // The write is given 30 s, then the part is fetched and written again: no word to the person, nothing to tap.
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 150_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  expect(warnings.some((w) => /did not answer/.test(w)), 'the hung write was seen and named').toBe(true);
});

test('a worker that goes silent in the middle of a download: the sheet says it stopped, and the next tap finishes it', async ({ page, context }) => {
  test.setTimeout(240_000);
  await inWorker(context, SILENT);
  await page.addInitScript(() => { (window as unknown as { __toastErrors?: string[] }).__toastErrors = []; });
  await tapCaptions(page);
  // The megabytes that came are on the screen while it downloads (frozen ones would be seen to be frozen).
  await expect(page.locator('.sheet')).toContainText(/Скачиваем модель речи: \d+ из \d+ МБ/, { timeout: 30_000 });
  await expect(page.locator('.toast.error')).toContainText('Скачивание модели речи остановилось', { timeout: 90_000 });
  await expect(page.locator('.toast.error')).toContainText('Нажмите ещё раз');
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  // The person can hand the notes over without a developer: «Подробнее» → «Скопировать для поддержки».
  await page.locator('.toast.error').getByRole('button', { name: 'Подробнее' }).click();
  await expect(page.locator('.error-details pre')).toContainText(/the worker said nothing for 45 s at \d+ of \d+ MB, quota \S+ MB used \S+ MB, persisted (yes|no|\?)/);
  await expect(page.getByRole('button', { name: 'Скопировать для поддержки' })).toBeVisible();
  await page.locator('.toast.error').getByRole('button', { name: /Закрыть/ }).click();
  // The next tap: a new worker, the parts already kept are not fetched again, the captions are made.
  await page.evaluate(() => (window as unknown as { __toastErrors?: string[] }).__toastErrors?.splice(0));
  const again = page.getByRole('button', { name: 'Создать субтитры' });
  await expect(async () => {
    if (await again.isVisible()) await again.click(); else await tool(page, 'Субтитры').click();
    const yes = page.getByRole('button', { name: 'Скачать и сделать субтитры', exact: true });
    if (await yes.isVisible({ timeout: 1500 }).catch(() => false)) await yes.click();
    await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 60_000 });
  }).toPass({ timeout: 150_000 });
});

/** Kadr's error log on this device (lib/errorLog.ts: idb-keyval, database kadr-log, store log, key entries). */
const logged = (page: Page) => page.evaluate(() => new Promise<string[]>((resolve) => {
  const open = indexedDB.open('kadr-log');
  open.onerror = () => resolve([]);
  open.onsuccess = () => {
    if (!open.result.objectStoreNames.contains('log')) { resolve([]); return; }
    const get = open.result.transaction('log').objectStore('log').get('entries');
    get.onsuccess = () => resolve(((get.result as { message: string }[] | undefined) ?? []).map((x) => x.message));
    get.onerror = () => resolve([]);
  };
}));

test('a Cache Storage that never finishes a write: the parts go to another store, the captions are made, and the log says what happened', async ({ page, context }) => {
  test.setTimeout(300_000);
  await inWorker(context, DEAD_CACHE);
  await tapCaptions(page);
  // Two writes that did not finish (15 s each), then the parts go where writing works: nothing to tap, no error.
  await expect(page.locator('.clip-caption')).toHaveCount(1, { timeout: 200_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  // What tells Safari from the Home Screen app on a phone, kept for "Copy for support" and ?diag.
  await expect.poll(async () => (await logged(page)).find((m) => /cache stalled → fallback/.test(m)) ?? '', { timeout: 15_000 })
    .toMatch(/first byte \d+ ms.*first part written \d+ ms.*cache stalled → fallback (opfs|memory).*store (opfs|memory).*quota .*persisted (yes|no)/);
});
