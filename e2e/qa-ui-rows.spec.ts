// Lane U of the sweep (docs/21 §3): the rows of the interface audit of v1.7.1 (UI-2…UI-9, reports/Chetko — аудит
// интерфейса.md §7). Each test names its row and measures what the audit measured.
import { expect, test, type Locator, type Page } from '@playwright/test';
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
const misses = (loc: ReturnType<Page['locator']>) => loc.evaluate(async (el) => {
  // Once what moves has stopped: a sheet still rising stands up to 32 px lower than it will (since the editor loads its
  // sheets after it is shown, V-143, the measure fell inside that rise). Endless animations (a spinner) are not waited for.
  await Promise.all(document.getAnimations().filter((a) => a.effect?.getComputedTiming().endTime !== Infinity).map((a) => a.finished.catch(() => {})));
  // Centred in what scrolls it, not flush with its edge: a point 21 px off the centre of a control that sits on the very
  // last pixel of a sheet fell on the edge by rounding (Android, 2026-11-16). Sideways stays put: the timeline is time.
  el.scrollIntoView({ block: 'center', inline: 'nearest' });
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
  // The second swipe has to come within the 4 s the warning holds. With the export busy on WebKit's main thread, a release
  // was handled up to seconds after the test sent it, and the app rightly took the second swipe for a new first one (one in
  // three runs at load 2, 2026-11-16). So both swipes go in the page itself, as pointer events of the mouse (an active
  // pointer, so the sheet may capture it), with only the warning waited for between them.
  const r = await head(page).evaluate(async (h) => {
    const box = h.getBoundingClientRect(), x = box.left + 60, y0 = box.top + 12;
    const ev = (type: string, y: number, buttons: number) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 1, pointerType: 'mouse', isPrimary: true, button: 0, buttons });
    const swipe = () => { h.dispatchEvent(ev('pointerdown', y0, 1)); for (let i = 1; i <= 4; i++) h.dispatchEvent(ev('pointermove', y0 + i * 55, 1)); h.dispatchEvent(ev('pointerup', y0 + 220, 0)); return performance.now(); };
    const warned = () => [...document.querySelectorAll('.toast')].some((x) => x.textContent?.includes('Экспорт ещё идёт'));
    const t1 = swipe();
    for (let i = 0; i < 100 && !warned(); i++) await new Promise((res) => setTimeout(res, 20));
    const first = { warned: warned(), open: !!document.querySelector('[role="dialog"][aria-label="Экспорт"]') };
    const t2 = swipe();
    return { first, gap: t2 - t1 };
  });
  expect(r.first.open, 'the first swipe keeps the sheet').toBe(true);
  expect(r.first.warned, 'and says the export is still running').toBe(true);
  expect(r.gap, 'the second swipe came within the 4 s of the warning').toBeLessThan(4000);
  await expect(sheet, 'a second swipe within seconds means it').toHaveCount(0);
});

// ---- UI-7: the frame while a sheet that judges the picture is open (the art director: the header folds, the sheet stops
// a peek below its working set). The audit of v1.7.1: 13% of the screen at 667 px, 19% at 812 (§2). ----
/** The least share of the screen the frame keeps, from the measure of 2026-11-16 less a margin. */
const MIN_SHARE: Record<number, Record<string, number>> = {
  667: { 'Фильтры': 16, 'Настройка': 16, 'Трансформация': 18 },
  812: { 'Фильтры': 27, 'Настройка': 27, 'Трансформация': 34 },
};
for (const h of [667, 812]) {
  test(`UI-7 at 375×${h}: with «Фильтры», «Настройка», «Трансформация» open the header folds, the sheet stops below its working set and does not grow with a choice, the frame keeps its room`, async ({ page }) => {
    await sampleEditor(page, 'ru');
    await page.setViewportSize({ width: 375, height: h });
    await page.locator('.tl-row.main .clip').first().click();
    const share = () => page.locator('.preview-canvas').evaluate((c) => { const r = c.getBoundingClientRect(); return (r.width * r.height) / (innerWidth * innerHeight) * 100; });
    const sheetH = () => page.locator('.sheet').evaluate((s) => s.getBoundingClientRect().height);
    const top = page.locator('.ck-editor-top');
    const seen: Record<string, number> = {};
    for (const name of ['Фильтры', 'Настройка', 'Трансформация']) {
      await tool(page, name).click();
      await expect(page.getByRole('dialog', { name })).toBeVisible();
      await page.waitForTimeout(500);
      expect(await top.evaluate((e) => e.getBoundingClientRect().height), `${name}: the header gives its height to the frame`).toBe(0);
      expect(await top.evaluate((e) => (e as HTMLElement).inert), `${name}: and is out of reach of Tab and VoiceOver`).toBe(true);
      // The working set is whole in sight: the first value of the sheet ends above the bottom of the screen.
      const value = (await page.locator('.sheet').getByRole('slider').first().boundingBox())!;
      expect(value.y + value.height, `${name}: its value is in sight without a scroll`).toBeLessThanOrEqual(h + 0.5);
      const h0 = await sheetH();
      // A choice does not make the sheet grow, so the frame does not jump.
      const tiles = page.locator('.sheet .ck-picker [role="radio"]');
      if (await tiles.count() > 1) { await tiles.nth(1).click(); await page.waitForTimeout(400); }
      expect(await sheetH(), `${name}: the sheet keeps its height after a choice`).toBeCloseTo(h0, 0);
      seen[name] = Math.round(await share() * 10) / 10;
      await page.locator('.sheet').getByRole('button', { name: 'Готово' }).click();
      await expect(top, 'the header comes back with the sheet gone').toBeVisible();
      expect(await top.evaluate((e) => (e as HTMLElement).inert)).toBe(false);
    }
    console.log(`UI-7 375×${h}: frame % of the screen`, JSON.stringify(seen));
    for (const [name, pct] of Object.entries(seen)) expect(pct, `${name}: the frame, % of the screen (v1.7.1: ${h === 667 ? 13.4 : 19.2})`).toBeGreaterThanOrEqual(MIN_SHARE[h][name]);
  });
}

// ---- UI-2: the size of a one-tap export in the header, and the settings before anything renders (the owner chose this
// over a sheet before every export: one tap stays one tap). ----
for (const width of [375, 320]) {
  test(`UI-2 at ${width} px: the header says the size a tap on «Экспорт» makes; a tap on that opens the settings at that size with nothing rendered; «Экспорт» still renders in one tap`, async ({ page }) => {
    await sampleEditor(page, 'ru');
    await page.setViewportSize({ width, height: width === 320 ? 640 : 812 });
    const top = page.locator('.topbar');
    const size = top.getByRole('button', { name: /^Разрешение и настройки: / });
    await expect(size, 'the sample is 720p: a file is never larger than its video').toHaveText('720p');
    await expect(size).toHaveAccessibleName('Разрешение и настройки: 720p');
    await expect(top.getByRole('button', { name: 'Экспорт' }), 'a search for «Экспорт» finds the white button alone').toHaveCount(1);
    expect(await misses(size), 'a finger takes it').toEqual([]);
    const exp = top.getByRole('button', { name: 'Экспорт', exact: true });
    expect((await size.boundingBox())!.x, 'it qualifies the white button, on its left').toBeLessThan((await exp.boundingBox())!.x);
    expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'nothing scrolls sideways').toBe(false);
    await size.click();
    const sheet = page.getByRole('dialog', { name: 'Экспорт' });
    await expect(sheet.getByRole('button', { name: /^Экспортировать видео/ })).toBeEnabled({ timeout: 15_000 });
    await expect(sheet.locator('.ck-work-frame'), 'nothing renders until it is asked to').toHaveCount(0);
    await expect(sheet.getByRole('radio', { name: '720p', exact: true }), 'the sheet starts at the size the header said').toBeChecked();
    // The sizes stand in sight above the held button and its 24 px fade, at 320 px too (the art director).
    const [chipsBottom, footTop] = await sheet.evaluate((s) => {
      const h = [...s.querySelectorAll('h3')].find((x) => x.textContent === 'Разрешение')!;
      return [h.nextElementSibling!.getBoundingClientRect().bottom, s.querySelector('.ck-panel-foot')!.getBoundingClientRect().top];
    });
    expect(chipsBottom, 'the sizes above the fade of the held button').toBeLessThanOrEqual(footTop - 24 + 0.5);
    await sheet.getByRole('button', { name: 'Готово' }).click();
    await expect(sheet).toHaveCount(0);
    await exp.click();
    await expect(page.getByRole('dialog', { name: 'Экспорт' }).locator('.ck-work-frame').first(), 'one tap still renders').toBeVisible({ timeout: 15_000 });
  });
}

// ---- SW-U-3, SW-U-4: what the art director saw on the screens of UI-4 and UI-7 ----
test('SW-U-3: the corner handle of a picked piece that fills the frame stands whole on the stage and takes a finger, not half under the row under the frame', async ({ page }) => {
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  const handle = page.getByRole('button', { name: 'Потяните, чтобы изменить размер и повернуть' });
  await expect(handle).toBeVisible();
  await page.waitForTimeout(400);
  const [h, s] = await Promise.all([handle.boundingBox(), page.locator('.ck-stage').boundingBox()]);
  expect(h!.y + h!.height, 'the handle ends on the stage, above the row under the frame').toBeLessThanOrEqual(s!.y + s!.height + 0.5);
  expect(h!.x + h!.width, 'and inside it sideways').toBeLessThanOrEqual(s!.x + s!.width + 0.5);
  expect(await misses(handle), 'a finger takes it').toEqual([]);
});

test('SW-U-4: the ribbon fades only where more tools lie — under «Все» while more follow, under «Назад» once scrolled, nowhere at the end', async ({ page }) => {
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  const tools = page.locator('.toolbar .ck-ribbon-tools');
  const faded = () => tools.evaluate((el) => { const m = getComputedStyle(el).maskImage || getComputedStyle(el).webkitMaskImage; return m && m !== 'none' ? m : null; });
  const at = (x: number) => tools.evaluate((el, v) => { el.scrollLeft = v < 0 ? el.scrollWidth : v; }, x);
  await at(0);
  await page.waitForTimeout(200);
  expect(await faded(), 'at the start the edge under «Все» fades').toContain('gradient');
  expect(await tools.evaluate((el) => el.hasAttribute('data-more-start')), 'and nothing lies before the first tool').toBe(false);
  await at(200);
  await page.waitForTimeout(200);
  expect(await tools.evaluate((el) => el.hasAttribute('data-more-start') && el.hasAttribute('data-more-end')), 'in the middle both edges fade').toBe(true);
  await at(-1);
  await page.waitForTimeout(200);
  expect(await faded(), 'at the end the last tool is not faded: nothing lies beyond it').not.toMatch(/gradient\(90deg, (rgb\(0, 0, 0\)|black) calc/);
  expect(await tools.evaluate((el) => el.hasAttribute('data-more-end'))).toBe(false);
});

// ---- the ribbon's observer under strain (lane D saw «ResizeObserver loop completed with undelivered notifications» once,
// under load, on WebKit, in a test that enters the editor and leaves for Home) ----
test('SW-U-9: the editor raises no «ResizeObserver loop» through window resizes, picking a piece and leaving for Home', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await sampleEditor(page, 'ru');
  const sizes: [number, number][] = [[375, 812], [320, 640], [393, 852], [360, 740], [375, 667], [414, 896]];
  for (let round = 0; round < 3; round++) {
    for (const [width, height] of sizes) { await page.setViewportSize({ width, height }); await page.waitForTimeout(40); }
    await page.locator('.tl-row.main .clip').first().click();
    for (const [width, height] of [...sizes].reverse()) { await page.setViewportSize({ width, height }); await page.waitForTimeout(40); }
    await page.locator('.toolbar .tool-back').click();
    await page.getByRole('button', { name: 'К проектам' }).click();
    await page.getByRole('button', { name: /^Открыть «?Пример/ }).first().click();
    await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  }
  await page.waitForTimeout(500);
  expect(errors.filter((e) => e.includes('ResizeObserver')), 'no ResizeObserver loop in the page').toEqual([]);
});

// ---- SW-U-12: a pointer that is already gone when its handler runs (the system cancelled it in between) ----

/** A touch whose pointer no finger holds: down near the top of `target`, carried `dy` px in ten steps, lifted. Browsers
 *  refuse to capture such a pointer (NotFoundError), which is what a pointer cancelled before the page's handler meets. */
async function goneTouch(target: Locator, dy = 0) {
  await target.evaluate((el, d) => {
    const r = el.getBoundingClientRect(), x = r.left + r.width / 2, y0 = r.top + Math.min(14, r.height / 2);
    const ev = (type: string, y: number, buttons: number) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 77, pointerType: 'touch', isPrimary: true, button: 0, buttons });
    el.dispatchEvent(ev('pointerdown', y0, 1));
    for (let i = 1; i <= 10; i++) el.dispatchEvent(ev('pointermove', y0 + (d * i) / 10, 1));
    el.dispatchEvent(ev('pointerup', y0 + d, 0));
  }, dy);
}

test('SW-U-12: a touch whose pointer is already gone raises no page error where a gesture begins — the corner handle, the preview, a sheet of the editor, a sheet of Home — and its swipe still closes a sheet', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  await expect(page.locator('.sel-handle')).toBeVisible();
  await goneTouch(page.locator('.sel-handle'), 30);
  await goneTouch(page.locator('.ck-stage'));
  await tool(page, 'Трансформация').click();
  const sheet = page.getByRole('dialog', { name: 'Трансформация' });
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(500); // its entrance
  await goneTouch(head(page), 260);
  await expect(sheet, 'a swipe of the editor sheet still carries it away').toHaveCount(0);
  await page.getByRole('button', { name: 'К проектам' }).first().click();
  await page.getByRole('button', { name: 'Новый проект' }).click();
  const open = page.locator('.ck-sheet-layer[data-open="true"]');
  await expect(open.locator('.ck-sheet-head')).toBeVisible();
  await page.waitForTimeout(500);
  await goneTouch(open.locator('.ck-sheet-head'), 260);
  await expect(open, 'a swipe of the Home sheet still carries it away').toHaveCount(0);
  expect(errors, 'no page error from a pointer that is gone').toEqual([]);
});

// On the iPhone the scroll of the timeline is applied by another process and its `scroll` event can come after a frame
// of playback; D4 there (iPhone 15, live v1.9.14) lost 3 of 10 jumps of the timeline during playback: the playhead put
// the scroll back under itself first, and the late event looked like its own (2.4–3.5 s until the preview reached the
// place by playing). Here the first scroll event of each jump is held back 60 ms, as on the phone.
test('SW-U-17: a jump of the timeline during playback is a scrub even when its scroll event comes after a frame of playback', async ({ page }) => {
  await sampleEditor(page, 'ru');
  await page.evaluate(() => {
    const w = window as unknown as { __holdNext: boolean };
    w.__holdNext = false;
    addEventListener('scroll', (e) => {
      const el = e.target as Element;
      if (!w.__holdNext || !e.isTrusted || !el.classList?.contains('tl-scroll')) return;
      w.__holdNext = false;
      e.stopImmediatePropagation();
      setTimeout(() => el.dispatchEvent(new Event('scroll')), 60);
    }, { capture: true });
  });
  const play = page.locator('.transport .play-btn');
  // «0:03.4 / 0:07.4»: where the playhead is, and how long the project is (the scroll's range is that long).
  const clock = async () => { const m = (await page.locator('.transport').textContent())!.match(/(\d+):(\d+\.\d)\s*\/\s*(\d+):(\d+\.\d)/)!; return { t: +m[1] * 60 + +m[2], total: +m[3] * 60 + +m[4] }; };
  const lost: string[] = [];
  for (const f of [0.75, 0.2, 0.6, 0.15, 0.85]) {
    await page.evaluate(() => { document.querySelector('.tl-scroll')!.scrollLeft = 0; });
    await page.waitForTimeout(200);
    if ((await play.getAttribute('aria-label')) !== 'Пауза') await play.click();
    await expect(play).toHaveAttribute('aria-label', 'Пауза');
    await page.waitForTimeout(500);
    const want = await page.evaluate((f) => {
      const el = document.querySelector<HTMLElement>('.tl-scroll')!, max = el.scrollWidth - el.clientWidth;
      (window as unknown as { __holdNext: boolean }).__holdNext = true;
      el.scrollLeft = Math.round(f * max);
      return { x: el.scrollLeft, max };
    }, f);
    await page.waitForTimeout(500);
    const { t, total } = await clock(), playing = (await play.getAttribute('aria-label')) === 'Пауза';
    const at = (want.x / want.max) * total;
    if (playing || Math.abs(t - at) > 0.25) lost.push(`jump to ${at.toFixed(1)} s: the playhead at ${t} s, ${playing ? 'still playing' : 'paused'}`);
  }
  expect(lost, 'every jump during playback seeks there and pauses, as a scrub does').toEqual([]);
});

test('SW-U-17: while a finger holds the timeline during playback, the playhead does not move its scroll; after it lets go, it does again', async ({ page }) => {
  await sampleEditor(page, 'ru');
  const play = page.locator('.transport .play-btn');
  await play.click();
  await expect(play).toHaveAttribute('aria-label', 'Пауза');
  await page.waitForTimeout(400);
  const state = () => page.evaluate(() => {
    const m = document.querySelector('.transport')!.textContent!.match(/(\d+):(\d+\.\d)/)!;
    return { x: document.querySelector('.tl-scroll')!.scrollLeft, t: +m[1] * 60 + +m[2] };
  });
  const press = (type: 'pointerdown' | 'pointerup') => page.evaluate((type) => {
    const el = document.querySelector('.tl-scroll')!, r = el.getBoundingClientRect();
    (type === 'pointerdown' ? el : window).dispatchEvent(new PointerEvent(type, { bubbles: true, clientX: r.left + 40, clientY: r.top + 20, pointerId: 9, pointerType: 'touch', isPrimary: true }));
  }, type);
  await press('pointerdown');
  const a = await state();
  await page.waitForTimeout(500);
  const b = await state();
  expect(b.t - a.t, 'the preview keeps playing under the finger').toBeGreaterThan(0.2);
  expect(Math.abs(b.x - a.x), 'the scroll stays where the finger holds it').toBeLessThan(1);
  await press('pointerup');
  await page.waitForTimeout(500);
  const c = await state();
  expect(c.x - b.x, 'after the finger lets go the timeline follows the playhead again').toBeGreaterThan(5);
});

// The owner on the iPhone: «Она двигалась, когда я двигал ползунок» — a drag on the Speed scale moved the sheet. The
// strip let the browser have a drag's vertical part (`touch-action: pan-y`) and the sheet's body, 40 px taller than its
// window, scrolled under the finger. A finger is never level: a drag at ±20° must change the speed and nothing else.
// Real touches (CDP) on Chromium, where the browser decides who gets a gesture as Safari does; WebKit checks the rule.
test('SW-U-18: a drag on the Speed scale at ±20° changes the speed and moves nothing else — not the sheet, not the page', async ({ page, browserName }) => {
  await sampleEditor(page, 'ru');
  await page.locator('.tl-row.main .clip').first().click();
  await tool(page, 'Скорость').scrollIntoViewIfNeeded();
  await tool(page, 'Скорость').click();
  const strip = page.locator('.sheet .ck-scale-strip');
  await expect(strip).toBeVisible();
  await page.waitForTimeout(500);
  expect.soft(await strip.evaluate((e) => getComputedStyle(e).touchAction), 'the strip takes the whole drag').toBe('none');
  if (browserName !== 'chromium') return;
  const cdp = await page.context().newCDPSession(page);
  const state = () => page.evaluate(() => ({
    body: document.querySelector('.sheet .ck-panel-body')!.scrollTop,
    page: [scrollY, Math.round(visualViewport!.pageTop)],
    value: document.querySelector('.sheet .ck-scale .ck-digit')!.textContent,
  }));
  const moved: string[] = [];
  // Right and down, left and up, right and up, left and down: 20° off level each way, so the value goes both ways;
  // then a finger that starts steeply (60° for its first 30 px, as a thumb does) and goes on sideways.
  for (const [deg, steep] of [[20, 0], [200, 0], [-20, 0], [160, 0], [20, 60], [200, 240]]) {
    await page.evaluate(() => { document.querySelector('.sheet .ck-panel-body')!.scrollTop = 20; });
    const b = (await strip.boundingBox())!, x0 = b.x + b.width * 0.5, y0 = b.y + b.height / 2;
    const before = await state();
    const path: [number, number][] = [];
    let x = x0, y = y0;
    if (steep) for (let i = 1; i <= 3; i++) { x += 10 * Math.cos((steep * Math.PI) / 180); y += 10 * Math.sin((steep * Math.PI) / 180); path.push([x, y]); }
    for (let i = 1; i <= 12; i++) path.push([x + (120 * Math.cos((deg * Math.PI) / 180) * i) / 12, y + (120 * Math.sin((deg * Math.PI) / 180) * i) / 12]);
    let peak = before.body, low = before.body;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x0, y: y0 }] });
    for (const [px, py] of path) {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: px, y: py }] });
      const now = (await state()).body;
      peak = Math.max(peak, now); low = Math.min(low, now);
    }
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForTimeout(300);
    const after = await state();
    const how = steep ? `${steep}° then ${deg}°` : `${deg}°`;
    if (peak !== before.body || low !== before.body || after.body !== before.body) moved.push(`${how}: the sheet's body scrolled (${before.body} → ${low}…${peak} px)`);
    if (after.page.some((v) => v !== 0)) moved.push(`${how}: the page moved (scrollY, pageTop ${after.page})`);
    if (after.value === before.value) moved.push(`${how}: the speed did not change («${before.value}»)`);
  }
  expect(moved, 'a tilted drag on the scale sets the speed and moves nothing else').toEqual([]);
});

// The window of the editor never stretches (SW-U-18, the lead): iOS takes the root's overscroll-behavior for the window,
// not body's. Home and the site keep theirs and still scroll. A finger on the iPhone checks the zones (the owner's list).
test('SW-U-18: in the editor the window does not stretch (the root takes no overscroll); Home keeps its own and scrolls', async ({ page }) => {
  const root = () => page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.undoMoved.v1', '1'); });
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Открыть пример' })).toBeVisible();
  expect(await root(), 'Home: the window as before').toBe('auto');
  const scrolled = await page.evaluate(async () => { scrollTo(0, 200); await new Promise((r) => requestAnimationFrame(r)); const y = scrollY; scrollTo(0, 0); return y; });
  expect(scrolled, 'Home still scrolls').toBeGreaterThan(0);
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  expect(await root(), 'the editor: the window does not stretch').toBe('none');
  await page.getByRole('button', { name: 'К проектам' }).click();
  await expect(page.getByRole('button', { name: 'Открыть пример' })).toBeVisible();
  expect(await root(), 'Home again: the window as before').toBe('auto');
});
