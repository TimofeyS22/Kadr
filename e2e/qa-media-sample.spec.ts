// The sample project speaks the person's language (SW-A-1, found by the Chetko session in the sweep, docs/21): in the
// Russian interface its title and its text said "Sample project" and "Made with Kadr" in English (docs/11 §3 item 11).
import { expect, test } from '@playwright/test';

test('the sample project in the Russian interface is named and titled in Russian (SW-A-1)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'ru');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.tl-row.main .clip').first()).toBeVisible({ timeout: 60_000 });
  const text = page.locator('.tl-row .clip', { hasText: 'Kadr' });
  await expect(text, 'the title on the timeline').toHaveCount(1);
  await expect(text).toContainText('Сделано в Kadr');
  await page.getByRole('button', { name: 'К проектам' }).click();
  await expect(page.getByText('Пример проекта').first(), 'the project in the list').toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Sample project')).toHaveCount(0);
});
