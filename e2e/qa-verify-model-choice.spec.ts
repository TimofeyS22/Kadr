// Verification, lane E4 (docs/21 §5), row O-13-2: «выбранная модель забывалась». The owner picked a model and the next
// tap went back to the default (docs/20 ADR-С2). Here a model is chosen, the page is opened again, and the next tap on
// Captions asks about that model and shows it chosen. Nothing is downloaded: every question is answered "Not now".
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const ask = (page: Page) => page.locator('.model-ask');

test('the speech model a person chose is the one the next visit asks about and shows chosen', async ({ page }) => {
  test.setTimeout(180_000);
  const models: string[] = [];
  page.on('request', (r) => { if (/\.onnx(\.parts\/\d+)?(\?|$)/.test(r.url())) models.push(r.url()); });
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('speech_en.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();

  // The first tap asks about the default for an English interface (Whisper base, 77 MB).
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await expect(ask(page)).toContainText('77 MB');
  await ask(page).getByRole('button', { name: 'Not now', exact: true }).click();
  const recognition = page.getByRole('radiogroup', { name: 'Recognition' });
  const mostAccurate = recognition.getByRole('radio', { name: /^Most accurate/ });
  await mostAccurate.click();
  await expect(mostAccurate).toHaveAttribute('aria-checked', 'true');

  // Another visit: the page is opened again.
  await page.reload();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 30_000 });
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  await page.getByRole('button', { name: 'Captions', exact: true }).click();
  await expect(ask(page), 'the one-tap run asks about the model chosen, not the default').toContainText('249 MB');
  await ask(page).getByRole('button', { name: 'Not now', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Recognition' }).getByRole('radio', { name: /^Most accurate/ })).toHaveAttribute('aria-checked', 'true');
  expect(models, 'nothing was downloaded').toEqual([]);
});
