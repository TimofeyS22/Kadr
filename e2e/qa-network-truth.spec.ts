// What Kadr says when a download fails (docs/16 N7, C6). With the browser online the host may be blocked or down, so the
// message may not send the person to check a connection that works; only with the browser offline does it say "no internet".
import { expect, test, type Page } from '@playwright/test';

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
