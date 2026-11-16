// Lane U of the sweep (docs/21 §3): the rows of the interface audit of v1.7.1 (UI-2…UI-9, reports/Chetko — аудит
// интерфейса.md §7). Each test names its row and measures what the audit measured.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

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
    // The sheet's own width less its 16 px margins: the same yardstick in 1.7.1, whose sheets had other inner parts.
    const width = await page.locator('.sheet').first().evaluate((s) => s.clientWidth - 32);
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

// ---- Q-33: a sheet closes by a swipe and by keys — the edges (docs/11 §3, item 5) ----

/** A finger down on `where`, carried `dy` px in `steps` steps, then lifted (or not, for the caller to cancel). */
async function swipe(page: Page, where: ReturnType<Page['locator']>, dy: number, lift = true, steps = 8) {
  const b = (await where.boundingBox())!;
  await page.mouse.move(b.x + 60, b.y + 12);
  await page.mouse.down();
  for (let i = 1; i <= steps; i++) { await page.mouse.move(b.x + 60, b.y + 12 + (dy * i) / steps); if (steps > 3) await page.waitForTimeout(30); }
  if (lift) await page.mouse.up();
}
const head = (page: Page) => page.locator('.sheet .ck-panel-head');

test('Q-33: only the header carries a sheet away, and only down — a drag on its body scrolls it, a drag up does nothing', async ({ page }) => {
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  await tool(page, 'Трансформация').click();
  const sheet = page.getByRole('dialog', { name: 'Трансформация' });
  await expect(sheet).toBeVisible();
  await swipe(page, page.locator('.sheet .ck-panel-body h3').first(), 220);
  await page.waitForTimeout(300);
  await expect(sheet, 'a drag on the body is not a swipe of the sheet').toBeVisible();
  await swipe(page, head(page), -120);
  await page.waitForTimeout(300);
  await expect(sheet, 'a drag up keeps it').toBeVisible();
  expect(await sheet.evaluate((e) => (e as HTMLElement).style.transform), 'and leaves it in its place').toBe('');
  await swipe(page, head(page), 220);
  await expect(sheet, 'a swipe down the header closes it').toHaveCount(0);
});

test('Q-33: a swipe the browser cancels (a system gesture, a call) springs the sheet back instead of closing it', async ({ page }) => {
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  await tool(page, 'Трансформация').click();
  const sheet = page.getByRole('dialog', { name: 'Трансформация' });
  await expect(sheet).toBeVisible();
  await swipe(page, head(page), 220, false); // past 30% of the sheet: lifted here, it would close
  await head(page).evaluate((h) => h.dispatchEvent(new PointerEvent('pointercancel', { bubbles: true, pointerId: 1, pointerType: 'mouse' })));
  await page.mouse.up();
  await page.waitForTimeout(400);
  await expect(sheet, 'a cancelled gesture is not the person letting go').toBeVisible();
  expect(await sheet.evaluate((e) => (e as HTMLElement).style.transform), 'it springs back to its place').toBe('');
});

test('Q-33: Escape that ends a word being composed (an input method) leaves the sheet open; a plain Escape closes it — in the editor and in a dialog', async ({ page }) => {
  const composingEscape = (field: ReturnType<Page['locator']>) => field.evaluate((f) => f.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', isComposing: true, bubbles: true, cancelable: true })));
  await sampleEditor(page, 'ru');
  await tool(page, 'Текст').click();
  const text = page.getByRole('dialog', { name: 'Текст' });
  const field = text.getByRole('textbox', { name: 'Текст' });
  await field.focus();
  await composingEscape(field);
  await page.waitForTimeout(300);
  await expect(text, 'the input method takes that Escape').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(text).toHaveCount(0);
  await page.goto('./');
  await page.getByRole('button', { name: /^Переименовать «/ }).first().click();
  const rename = page.getByRole('dialog', { name: 'Переименовать' });
  const name = rename.getByRole('textbox');
  await name.focus();
  await composingEscape(name);
  await page.waitForTimeout(300);
  await expect(rename, 'the same in a dialog').toBeVisible();
  await page.keyboard.press('Escape');
  await expect(rename).toHaveCount(0);
});

test('Q-33: a swipe of a sheet that holds work warns first, as «Готово» and Escape do; a second swipe means it (V-225)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Медиа').click();
  await (await chooser).setFiles([path.join(import.meta.dirname, '..', 'fixtures', 'long_1.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.locator('.topbar').getByRole('button', { name: 'Экспорт' }).click();
  const sheet = page.getByRole('dialog', { name: 'Экспорт' });
  const go = sheet.getByRole('button', { name: 'Экспортировать видео' });
  await go.waitFor({ timeout: 5_000 }).then(() => go.click(), () => {}); // a first export opens on its settings
  await expect(sheet.locator('.ck-work-frame').first()).toBeVisible();
  // The second swipe has to come within the 4 s the warning holds. Each call to the browser can take a second on a loaded
  // Mac, so a swipe is three calls and the state is read in one; the gap is measured, and a slow Mac says so (2026-11-16:
  // 8 steps took 5.2 s and the app rightly took the second swipe for a new first one).
  const quick = async () => {
    const b = (await head(page).boundingBox())!;
    await page.mouse.move(b.x + 60, b.y + 12);
    await page.mouse.down();
    await page.mouse.move(b.x + 60, b.y + 232, { steps: 4 });
    await page.mouse.up();
    return page.evaluate(() => ({
      at: performance.now(),
      open: !!document.querySelector('[role="dialog"][aria-label="Экспорт"]'),
      warned: [...document.querySelectorAll('.toast')].some((x) => x.textContent?.includes('Экспорт ещё идёт')),
    }));
  };
  const first = await quick();
  expect(first.open, 'the first swipe keeps the sheet').toBe(true);
  expect(first.warned, 'and says the export is still running').toBe(true);
  const second = await quick();
  expect(second.at - first.at, 'the second swipe came within the 4 s of the warning (else this Mac is too slow to tell)').toBeLessThan(4000);
  await expect(sheet, 'a second swipe within seconds means it').toHaveCount(0);
});

