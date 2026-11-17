// Q-28, the edges of "Reel in 1 tap" (docs/11 §3.5): what it does with a video that has no sound, sound without
// speech, a photo, and a Cancel in the middle. In every case: no error, nothing lost, and the sheet says what it did.
// Russian interface, the model a device gets by default. Needs a build with the models mirrored.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

async function project(page: Page, file: string) {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Медиа', exact: true }).click();
  await (await chooser).setFiles([fx(file)]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
}
/** Starts the reel from the editor; says yes to a model question if one comes. Resolves when the sheet has its result or its settings back. */
async function reel(page: Page) {
  await page.getByRole('button', { name: 'Рилс в 1 тап', exact: true }).click();
  await page.getByRole('button', { name: 'Сделать рилс', exact: true }).click();
}
const yes = (page: Page) => page.getByRole('button', { name: 'Скачать и сделать рилс', exact: true });
async function untilDone(page: Page) {
  await expect(async () => {
    if (await yes(page).isVisible()) await yes(page).click();
    await expect(page.locator('.reel-done')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 400_000 });
}
const noErrors = async (page: Page) => expect(await page.locator('.toast.error').allTextContents()).toEqual([]);

test('a video with no sound: the reel is made without speech and says so; no model is asked for, nothing is lost', async ({ page }) => {
  test.setTimeout(300_000);
  const models: string[] = [];
  page.on('request', (r) => { if (/\.onnx/.test(r.url())) models.push(r.url()); });
  await project(page, 'silent.mp4');
  await reel(page);
  await expect(page.locator('.reel-done')).toBeVisible({ timeout: 120_000 });
  await expect(page.locator('.reel-done')).toContainText('Речь не найдена');
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  expect(await page.locator('.tl-row.main .clip').count()).toBeGreaterThanOrEqual(1);
  expect(models, 'a video without sound needs no speech model').toEqual([]);
  await noErrors(page);
});

test('sound without speech (a tone): the reel is made, says no speech was found, puts no captions and no title', async ({ page }) => {
  test.setTimeout(500_000);
  await project(page, 'tone1k.mp4');
  await reel(page);
  await untilDone(page);
  await expect(page.locator('.reel-done')).toContainText('Речь не найдена');
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  await expect(page.locator('.tl-row .clip-text')).toHaveCount(0);
  expect(await page.locator('.tl-row.main .clip').count()).toBeGreaterThanOrEqual(1);
  await noErrors(page);
});

test('a photo: the reel does not fail and does not cut the picture away', async ({ page }) => {
  test.setTimeout(300_000);
  await project(page, 'photo.png');
  await reel(page);
  await expect(page.locator('.reel-done')).toBeVisible({ timeout: 120_000 });
  expect(await page.locator('.tl-row.main .clip').count()).toBeGreaterThanOrEqual(1);
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  await noErrors(page);
});

test('Cancel in the middle of a reel: the project is as it was, with no error, and the reel can be made after it', async ({ page }) => {
  test.setTimeout(600_000);
  await project(page, 'speech_ru_long.mp4');
  await reel(page);
  await expect(async () => {
    if (await yes(page).isVisible()) await yes(page).click();
    await expect(page.locator('.sheet [role=progressbar]')).toBeVisible({ timeout: 1000 });
  }).toPass({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Отмена', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Сделать рилс', exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await expect(page.locator('.clip-caption')).toHaveCount(0);
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(0);
  await noErrors(page);
  // Again, to the end: a cancelled run leaves nothing that stops the next one.
  await page.getByRole('button', { name: 'Сделать рилс', exact: true }).click();
  await untilDone(page);
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  await noErrors(page);
});
