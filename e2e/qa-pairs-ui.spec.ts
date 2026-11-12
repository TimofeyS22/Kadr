// Font pairs in the text sheet (docs/18 Ф4, Ф5), switched on by `?pairs`: off by default, on from the link and kept on;
// a pair breaks a one-line text in two and sets each line in its face; «Поменять местами» swaps the lines with their
// faces; one line's font changes alone; «Один шрифт» takes the pair off.
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
  // Ш6: under the text the sample's first frame is a dark, calm sky (measured: mean luminance 0.165, spread 0.015), so
  // the pair takes light letters and no box is pushed on it. When a box is wanted (core/pairs.ts pickVariant, unit test)
  // one tap puts it under the text.
  await expect(panel(page).locator('.swatch[aria-pressed="true"]').first()).toHaveAttribute('aria-label', '#ffffff');
  await page.waitForTimeout(1500); // the frame under the text is read once the sheet opens
  await expect(panel(page).getByRole('button', { name: 'Добавить подложку' })).toHaveCount(0);
  const lines = panel(page).getByRole('radiogroup', { name: 'Строка' });
  await expect(lines).toBeVisible();
  await expect(lines.getByRole('radio', { name: 'Весь текст' }), 'the whole text is chosen first').toBeChecked();
  const fonts = panel(page).getByRole('radiogroup', { name: 'Шрифт' });
  const caps = panel(page).getByRole('switch', { name: 'ВСЕ ЗАГЛАВНЫЕ' });
  await lines.getByRole('radio', { name: 'Строка 1' }).click();
  const first = await fonts.locator('[aria-checked="true"]').getAttribute('aria-label');
  await expect(caps, 'the accent is set in lower case').not.toBeChecked();
  await lines.getByRole('radio', { name: 'Строка 2' }).click();
  const second = await fonts.locator('[aria-checked="true"]').getAttribute('aria-label');
  expect(second, 'each line has its own face').not.toBe(first);
  // The look below follows the chosen line (Ж5: no switch is silent): the support is in capitals.
  await expect(caps, 'the support is set in capitals').toBeChecked();
  // «Поменять местами» (ADR-П7): the lines trade places, each with its face, and the chosen line is followed to its new
  // place; one «Отменить» gives the text and the faces back.
  await panel(page).getByRole('button', { name: 'Поменять местами' }).click();
  await expect(field, 'the small line goes over the accent').toHaveValue('в городе\nЛето');
  await expect(lines.getByRole('radio', { name: 'Строка 1' }), 'the chosen line is followed').toBeChecked();
  await expect(fonts.locator('[aria-checked="true"]')).toHaveAttribute('aria-label', second!);
  await expect(caps, 'with its capitals').toBeChecked();
  await lines.getByRole('radio', { name: 'Строка 2' }).click();
  await expect(fonts.locator('[aria-checked="true"]'), 'the accent went down with its face').toHaveAttribute('aria-label', first!);
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(field, 'one undo step').toHaveValue('Лето\nв городе');
  await expect(fonts.locator('[aria-checked="true"]'), 'line 2 has its own face back').toHaveAttribute('aria-label', second!);
  await fonts.getByRole('radio', { name: 'IBM Plex Mono', exact: true }).click();
  await expect(fonts.getByRole('radio', { name: 'IBM Plex Mono', exact: true })).toBeChecked();
  await lines.getByRole('radio', { name: 'Строка 1' }).click();
  await expect(fonts.locator('[aria-checked="true"]'), 'the first line kept its face').toHaveAttribute('aria-label', first!);
  // «Весь текст» takes back what the lines set for themselves: a face picked there reaches both lines.
  await lines.getByRole('radio', { name: 'Весь текст' }).click();
  await fonts.getByRole('radio', { name: 'Montserrat', exact: true }).click();
  await lines.getByRole('radio', { name: 'Строка 1' }).click();
  await expect(fonts.locator('[aria-checked="true"]')).toHaveAttribute('aria-label', 'Montserrat');
  await lines.getByRole('radio', { name: 'Строка 2' }).click();
  await expect(fonts.locator('[aria-checked="true"]')).toHaveAttribute('aria-label', 'Montserrat');
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

test('Ш4: from the text sheet a pair is two taps, a line\'s font three, each target in view without a sideways swipe', async ({ page }) => {
  await textSheet(page, './?pairs');
  let taps = 0;
  /** A tap the person can make where they are: the target is in its strip's or row's view (the sheet may scroll down). */
  const tap = async (target: ReturnType<Page['locator']>, what: string) => {
    // The strip scrolls itself after a category tap (smoothly): the target has a moment to come into view.
    await expect.poll(() => target.evaluate((el) => {
      const row = el.closest('.ck-strip, .ck-cats');
      if (!row) return true;
      const r = el.getBoundingClientRect(), s = row.getBoundingClientRect();
      return r.left >= s.left - 1 && r.right <= s.right + 1;
    }), { message: `${what}: in view without a sideways swipe`, timeout: 3000 }).toBe(true);
    taps++;
    await target.click();
  };
  const styles = panel(page).getByRole('radiogroup', { name: 'Стиль' });
  await tap(panel(page).locator('.ck-cat', { hasText: /^Пары$/ }), 'the «Пары» category');
  await tap(styles.locator('[data-cat="pairs"] [role=radio]').first(), 'the first pair');
  const lines = panel(page).getByRole('radiogroup', { name: 'Строка' });
  await expect(lines, 'the pair is on the text').toBeVisible();
  expect(taps, 'taps to a pair').toBeLessThanOrEqual(2);

  taps = 0;
  const fonts = panel(page).getByRole('radiogroup', { name: 'Шрифт' });
  await tap(lines.getByRole('radio', { name: 'Строка 2' }), 'line 2');
  await tap(fonts.locator('xpath=..').locator('.ck-cat', { hasText: /^С засечками$/ }), 'the serif fonts');
  const serif = fonts.locator('[data-cat="serif"] [role=radio]').first();
  const name = await serif.getAttribute('aria-label');
  await tap(serif, `the first serif font, ${name}`);
  await expect(fonts.locator('[aria-checked="true"]'), 'line 2 is set in it').toHaveAttribute('aria-label', name!);
  await tap(lines.getByRole('radio', { name: 'Строка 1' }), 'line 1, to look');
  await expect(fonts.locator('[aria-checked="true"]'), 'line 1 kept its own face').not.toHaveAttribute('aria-label', name!);
  expect(taps - 1, 'taps to the font of a line').toBeLessThanOrEqual(3);
});

test('a pair is one undo step both ways and is still there after a reload (docs/11 §3: 3, 4)', async ({ page }) => {
  await textSheet(page, './?pairs');
  const field = panel(page).getByRole('textbox', { name: 'Текст' });
  await field.fill('Лето в городе');
  await page.waitForTimeout(600); // the typing settles into its own history step
  await panel(page).locator('.ck-cat', { hasText: /^Пары$/ }).click();
  await panel(page).getByRole('radiogroup', { name: 'Стиль' }).locator('[data-cat="pairs"] [role=radio]').first().click();
  const lines = panel(page).getByRole('radiogroup', { name: 'Строка' });
  await expect(field).toHaveValue('Лето\nв городе');
  await expect(lines).toBeVisible();
  await page.waitForTimeout(1500); // the variant under the text is settled in the same step, not a step of its own
  await page.getByRole('button', { name: 'Отменить', exact: true }).click();
  await expect(field, 'one undo takes the pair and the line break back').toHaveValue('Лето в городе');
  await expect(lines).toHaveCount(0);
  await page.getByRole('button', { name: 'Повторить', exact: true }).click();
  await expect(field, 'one redo puts them again').toHaveValue('Лето\nв городе');
  await expect(lines).toBeVisible();
  // Reload: the project is opened again from the device, the pair with it.
  await page.waitForTimeout(1200); // the journal is written
  await page.reload(); // the project is in the address: the editor opens on it
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.locator('.tl-row .clip-text').first().click();
  await page.locator('.toolbar .tool', { hasText: /^Текст$/ }).click();
  await expect(panel(page).getByRole('textbox', { name: 'Текст' })).toHaveValue('Лето\nв городе');
  await expect(panel(page).getByRole('radiogroup', { name: 'Строка' }), 'the pair came back with the project').toBeVisible();
});
