// Font pairs in the text sheet (docs/18 Ф4, Ф5), switched on by `?pairs`: off by default, on from the link and kept on;
// a pair breaks a one-line text in two and sets each line in its face; one line's font changes alone; «Один шрифт»
// takes the pair off.
import { expect, test, type Page } from '@playwright/test';

const panel = (page: Page) => page.locator('.sheet');
async function textSheet(page: Page, address: string) {
  await page.addInitScript(() => { localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.tips', '99'); });
  await page.goto(address);
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.locator('.tl-row .clip-text').first().click();
  await page.locator('.toolbar .tool', { hasText: /^Текст$/ }).click();
  await expect(panel(page)).toBeVisible();
}
const categories = (page: Page) => panel(page).getByRole('radiogroup', { name: 'Стиль' }).locator('xpath=..').locator('.ck-cat').allTextContents();

test('pairs are off without the flag', async ({ page }) => {
  await textSheet(page, './');
  expect(await categories(page)).not.toContain('Пары');
  await expect(panel(page).getByRole('radiogroup', { name: 'Строка' })).toHaveCount(0);
});

test('with ?pairs: the pairs come second, a pair sets two faces on two lines, one line changes alone, «Один шрифт» takes it off', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await textSheet(page, './?pairs');
  const cats = await categories(page);
  expect(cats.indexOf('Пары'), 'right after «Базовые»').toBe(1);
  const field = panel(page).getByRole('textbox', { name: 'Текст' });
  await field.fill('Лето в городе');
  await panel(page).locator('.ck-cat', { hasText: /^Пары$/ }).click();
  const styles = panel(page).getByRole('radiogroup', { name: 'Стиль' });
  const pairs = styles.locator('[data-cat="pairs"] [role=radio]');
  expect(await pairs.count()).toBeGreaterThanOrEqual(8);
  await expect.poll(() => styles.locator('[data-cat="pairs"] canvas[data-ready]').count(), { message: 'pair tiles drawn once their faces are in' }).toBeGreaterThanOrEqual(3);
  await pairs.first().click();
  await expect(field, 'a one-line text is broken where Russian allows it').toHaveValue('Лето\nв городе');
  const lines = panel(page).getByRole('radiogroup', { name: 'Строка' });
  await expect(lines).toBeVisible();
  const fonts = panel(page).getByRole('radiogroup', { name: 'Шрифт' });
  const first = await fonts.locator('[aria-checked="true"]').getAttribute('aria-label');
  await lines.getByRole('radio', { name: 'Строка 2' }).click();
  const second = await fonts.locator('[aria-checked="true"]').getAttribute('aria-label');
  expect(second, 'each line has its own face').not.toBe(first);
  await fonts.getByRole('radio', { name: 'IBM Plex Mono', exact: true }).click();
  await expect(fonts.getByRole('radio', { name: 'IBM Plex Mono', exact: true })).toBeChecked();
  await lines.getByRole('radio', { name: 'Строка 1' }).click();
  await expect(fonts.locator('[aria-checked="true"]'), 'the first line kept its face').toHaveAttribute('aria-label', first!);
  await panel(page).getByRole('button', { name: 'Один шрифт' }).click();
  await expect(lines).toHaveCount(0);
  await expect(field, 'the text stays as it is').toHaveValue('Лето\nв городе');
  // The flag is kept: opened again without it, the pairs are still there.
  await page.goto('./');
  await page.getByRole('button', { name: /^Открыть «/ }).first().click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.locator('.tl-row .clip-text').first().click();
  await page.locator('.toolbar .tool', { hasText: /^Текст$/ }).click();
  expect(await categories(page)).toContain('Пары');
  expect(errors).toEqual([]);
});
