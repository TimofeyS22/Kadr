// Lane U of the sweep (docs/21 §3): the rows of the interface audit of v1.7.1 (UI-2…UI-9, reports/Chetko — аудит
// интерфейса.md §7). Each test names its row and measures what the audit measured.
import { expect, test, type Page } from '@playwright/test';

async function sampleEditor(page: Page, locale: 'ru' | 'en') {
  await page.addInitScript((l) => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', l);
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1');
  }, locale);
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./');
  await page.getByRole('button', { name: locale === 'ru' ? 'Открыть пример' : 'Try a sample' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
}

for (const [locale, tool, field, word] of [['ru', 'Текст', 'Текст', 'Ваш текст'], ['en', 'Text', 'Text', 'Your text']] as const) {
  test(`UI-6: a new text starts with a word of the interface's language (${locale}: «${word}»), in the field and on the timeline`, async ({ page }) => {
    await sampleEditor(page, locale);
    const named = page.locator(`.tl-row .clip-text[aria-label^="${word},"]`);
    const before = await named.count();
    await page.locator('.toolbar .tool', { hasText: new RegExp(`^${tool}$`) }).click();
    await expect(page.locator('.sheet').getByRole('textbox', { name: field })).toHaveValue(word);
    // The piece on the timeline is named by its words: one more piece says that word.
    await expect(named).toHaveCount(before + 1);
  });
}

/** The audit's measure (§3): a finger lands on the control when it is anywhere within 21.5 px of its centre on either
 *  axis. Returns the offsets that land elsewhere (on a neighbour, on nothing), so an empty list means 44 px to a finger. */
const misses = (loc: ReturnType<Page['locator']>) => loc.evaluate((el) => {
  el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const r = el.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
  return [[0, 0], [-21, 0], [21, 0], [0, -21], [0, 21]].filter(([dx, dy]) => {
    const hit = document.elementFromPoint(cx + dx, cy + dy);
    return !(hit && (hit === el || el.contains(hit)));
  }).map(([dx, dy]) => `${dx},${dy}`);
});
const tool = (page: Page, name: string) => page.locator('.toolbar .tool', { hasText: new RegExp(`^${name}$`) });

test('UI-9: the tools of fine work take a finger from 21 px off their centre — trim handles, a piece on an upper row, the transition, the keyframe diamond, the actions of a project', async ({ page }) => {
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  for (const name of ['Обрезать начало', 'Обрезать конец']) expect(await misses(page.getByRole('slider', { name })), name).toEqual([]);
  expect(await misses(page.locator('.tl-row .clip-text').first()), 'a text piece on an upper row').toEqual([]);
  await tool(page, 'Трансформация').click();
  expect(await misses(page.locator('.sheet').getByRole('button', { name: 'Добавить ключевой кадр: Положение X' })), 'the keyframe diamond').toEqual([]);
  await page.locator('.sheet').getByRole('button', { name: 'Готово' }).click();
  await page.locator('.toolbar .tool-back').click();
  expect(await misses(page.getByRole('button', { name: /^Переход 1–2/ })), 'the transition').toEqual([]);
  await page.goto('./');
  for (const name of [/^Сохранить копию «/, /^Переименовать «/, /^Удалить «/]) expect(await misses(page.getByRole('button', { name }).first()), String(name)).toEqual([]);
});

test('UI-3: a value is set on a control as wide as the sheet with 44 px to a finger — the text sheet and the values of a piece', async ({ page }) => {
  await sampleEditor(page, 'ru');
  const check = async (where: string) => {
    const width = await page.locator('.sheet .ck-panel-body').evaluate((b) => b.clientWidth - parseFloat(getComputedStyle(b).paddingLeft) - parseFloat(getComputedStyle(b).paddingRight));
    const values = page.locator('.sheet').getByRole('slider');
    expect(await values.count(), `${where}: values on view`).toBeGreaterThan(0);
    for (const v of await values.all()) {
      const name = `${where}: ${await v.getAttribute('aria-label') ?? ''}`;
      expect((await v.boundingBox())!.width, `${name} — its width of the ${Math.round(width)} px of the sheet`).toBeGreaterThanOrEqual(0.8 * width);
      expect(await misses(v), name).toEqual([]);
    }
  };
  await tool(page, 'Текст').click();
  await check('Текст');
  await page.locator('.sheet').getByRole('button', { name: 'Готово' }).click();
  await page.locator('.tl-row.main .clip').first().click();
  for (const name of ['Трансформация', 'Громкость', 'Настройка']) {
    await tool(page, name).click();
    await expect(page.locator('.sheet')).toBeVisible();
    await check(name);
    await page.locator('.sheet').getByRole('button', { name: 'Готово' }).click();
  }
});

test('UI-5: in the panel of a piece every tool is two taps away — «Все» is in sight with no scroll and names them all; «Фильтры» opens from there', async ({ page }) => {
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  const ribbon = await page.locator('.toolbar .tool:not(.tool-back) span').allTextContents();
  expect(ribbon.length, 'the panel of a piece holds many tools (23 in 1.7.1)').toBeGreaterThan(15);
  const all = page.getByRole('button', { name: 'Все инструменты' });
  expect(await misses(all), '«Все» is on screen and takes a finger without scrolling the ribbon').toEqual([]);
  await all.click();
  const sheet = page.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet).toBeVisible();
  expect(await sheet.locator('.ck-tool span').allTextContents(), 'every tool of the ribbon, by its name').toEqual(ribbon);
  await sheet.getByRole('button', { name: 'Фильтры', exact: true }).click();
  await expect(page.locator('.sheet h2')).toHaveText('Фильтры');
});
