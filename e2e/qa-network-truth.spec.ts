// What Kadr says when a download fails (docs/16 N7, C6). With the browser online the host may be blocked or down, so the
// message may not send the person to check a connection that works; only with the browser offline does it say "no internet".
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const toast = (page: Page) => page.locator('.toast.error');

async function musicSheet(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'ru');
    localStorage.setItem('kadr.hint.move', '1');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Музыка', exact: true }).click();
  await expect(page.locator('.music-row').first()).toBeVisible();
}
const addTrack = (page: Page) => page.locator('.music-row').first().getByRole('button', { name: 'Добавить', exact: false }).click();

async function fitsTheScreen(page: Page) {
  const box = (await toast(page).first().boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
}

test('the music host refuses while the browser is online: the server did not answer, nobody is told to check the internet', async ({ page }, info) => {
  await page.route(/\/music\/tracks\//, (route) => route.abort('connectionrefused'));
  await musicSheet(page);
  await addTrack(page);
  await expect(toast(page).first()).toContainText(/сервер не ответил/i);
  await expect(toast(page).first()).not.toContainText(/Проверьте|Нет интернета/);
  await fitsTheScreen(page);
  await page.screenshot({ path: info.outputPath('server-did-not-answer.png') });
});

test('the browser is offline: the message says there is no internet', async ({ page, context }) => {
  await musicSheet(page);
  await context.setOffline(true);
  expect(await page.evaluate(() => navigator.onLine), 'the browser knows it is offline').toBe(false);
  await addTrack(page);
  await expect(toast(page).first()).toContainText(/нет.*интернет/i);
  await fitsTheScreen(page);
  await context.setOffline(false);
});

test('the site stops answering while the browser is online, after a first visit: the music list says the server did not answer in Kadr\'s words (S-1-6)', async ({ page, baseURL }, info) => {
  test.skip(!baseURL?.startsWith('http://'), 'the way to the server is cut by a local proxy (e2e/network.ts)');
  // The list is asked of the service worker, which has neither the network nor a copy (the list was never opened):
  // WebKit then said "FetchEvent.respondWith received an error: no-response…", word for word, in the sheet.
  const { switchableNetwork } = await import('./network');
  const net = await switchableNetwork(baseURL!);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'ru');
    localStorage.setItem('kadr.hint.move', '1');
  });
  await page.goto(net.url);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload(); // now controlled by the service worker
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  net.off();
  expect(await page.evaluate(() => navigator.onLine), 'the browser still says it is online').toBe(true);
  await page.getByRole('button', { name: 'Музыка', exact: true }).click();
  const sheet = page.getByRole('dialog', { name: 'Музыка' });
  await expect(sheet).toContainText(/Сервер не ответил/i, { timeout: 20_000 });
  await expect(sheet).not.toContainText(/FetchEvent|no-response|Failed|Load failed/);
  await expect(sheet).not.toContainText(/Нет подключения|Нет интернета/);
  await page.screenshot({ path: info.outputPath('music-site-down.png') });
  await net.close();
});

test('the site stops answering before captions were ever used: the message says the site did not answer, and nothing is left unhandled (S-1-10)', async ({ page, baseURL }) => {
  test.skip(!baseURL?.startsWith('http://'), 'the way to the server is cut by a local proxy (e2e/network.ts)');
  // Before: "Не удалось загрузить модель речи (worker)", and an uncaught "no-response" for the worker's script.
  const { switchableNetwork } = await import('./network');
  const net = await switchableNetwork(baseURL!);
  const uncaught: string[] = [];
  page.on('pageerror', (e) => uncaught.push(e.message));
  // What the page's own code is given as uncaught (window error and unhandledrejection), apart from the engine's reports.
  await page.addInitScript(() => {
    const w = window as unknown as { __uncaught: string[] };
    w.__uncaught = [];
    addEventListener('error', (e) => w.__uncaught.push(`error: ${e.message}`));
    addEventListener('unhandledrejection', (e) => w.__uncaught.push(`rejection: ${String((e as PromiseRejectionEvent).reason)}`));
  });
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'ru');
    localStorage.setItem('kadr.hint.move', '1');
  });
  await page.goto(net.url);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.reload();
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Медиа', exact: true }).click();
  await (await chooser).setFiles(path.join(import.meta.dirname, '..', 'fixtures', 'speech_ru.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 30_000 });
  const close = page.getByRole('button', { name: 'Закрыть инструменты' });
  if (await close.isVisible()) await close.click();
  net.off();
  await page.getByRole('button', { name: 'Субтитры', exact: true }).click();
  await page.getByRole('button', { name: /Скачать и сделать субтитры/ }).click();
  await expect(toast(page).first()).toContainText(/Модель речи не загрузилась: сайт не ответил/, { timeout: 30_000 });
  await expect(toast(page).first()).not.toContainText(/worker|no-response/);
  console.log(`S-1-10 ${test.info().project.name}: engine reports ${JSON.stringify(uncaught)}; page code got ${JSON.stringify(await page.evaluate(() => (window as unknown as { __uncaught: string[] }).__uncaught))}`);
  expect(await page.evaluate(() => (window as unknown as { __uncaught: string[] }).__uncaught), 'nothing left unhandled in the page').toEqual([]);
  // Chromium reports a worker's error the page did not handle; WebKit also reports, on its own, the service worker's
  // failed answer for the script, which no page code receives or can stop.
  if (test.info().project.name.includes('chromium')) expect(uncaught, 'nothing reported as unhandled').toEqual([]);
  await net.close();
});
