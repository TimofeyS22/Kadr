// Chetko design system (docs/17 stage Ч2): the gallery `?ds` as each engine draws it. The unit test (src/ui/tokens.test.ts)
// checks the tokens with its own colour maths; here the browser converts the colours itself, loads the real font files and
// lays the page out at the width of a phone.
import { expect, test } from '@playwright/test';
import type { DsReport } from '../src/ui/DesignSystem';

const report = (page: import('@playwright/test').Page) => page.evaluate(() => (window as unknown as { __ckDs: DsReport }).__ckDs);

test('the gallery of tokens: contrast as the browser computes it, both alphabets of the font, nothing restyled by the old sheet', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./?ds');
  await page.waitForFunction(() => (window as unknown as { __ckDs?: DsReport }).__ckDs?.done, null, { timeout: 60_000 });
  const r = await report(page);
  expect(r.fonts, 'Geologica loaded for Cyrillic and Latin').toEqual({ cyrillic: true, latin: true });
  expect(r.pairs.length).toBeGreaterThanOrEqual(14);
  expect(r.pairs.filter((p) => !p.ok).map((p) => `${p.fg} on ${p.bg}: ${p.ratio} < ${p.min}`)).toEqual([]);
  // The old stylesheet has classes of its own (`.tile`, `.btn`): none of them may reach the new system.
  const sizes = await page.evaluate(() => ({
    wordmark: parseFloat(getComputedStyle(document.querySelector('.ds-tile .ck-wm')!).fontSize),
    root: parseFloat(getComputedStyle(document.documentElement).fontSize),
    button: document.querySelector('.ds-btn')!.getBoundingClientRect().height,
    sideways: document.querySelector('.ds')!.scrollWidth > innerWidth,
    marks: getComputedStyle(document.querySelector('.ck-yo')!, '::before').backgroundColor === getComputedStyle(document.querySelector('.ck-digit')!).color,
  }));
  expect(sizes.wordmark / sizes.root, 'the display step is 3.5 rem').toBeCloseTo(3.5, 1);
  expect(sizes.button).toBeGreaterThanOrEqual(44);
  expect(sizes.sideways, 'no sideways scroll at 375 px').toBe(false);
  expect(sizes.marks, 'the marks of the wordmark and the digit of a value share the signal colour').toBe(true);
});

test('a value in motion loses its sharpness and weight, and gets them back', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./?ds');
  await page.waitForFunction(() => (window as unknown as { __ckDs?: DsReport }).__ckDs?.done, null, { timeout: 60_000 });
  const look = () => page.locator('.ck-digit').first().evaluate((e) => { const s = getComputedStyle(e); return { weight: s.fontWeight, sharp: s.fontVariationSettings, colour: s.color }; });
  const rest = await look();
  expect(rest.sharp).toContain('100');
  const hold = page.locator('.ds-btn');
  await hold.dispatchEvent('pointerdown');
  await page.waitForTimeout(400);
  const moving = await look();
  expect(Number(moving.weight)).toBeLessThan(Number(rest.weight));
  expect(moving.sharp).not.toBe(rest.sharp);
  expect(moving.colour).not.toBe(rest.colour);
  await hold.dispatchEvent('pointerup');
  await page.waitForTimeout(400);
  expect(await look()).toEqual(rest);
});

// ---- stage Ч3: components, assembled in the gallery the way the editor will use them ----
async function openGallery(page: import('@playwright/test').Page) {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./?ds');
  await page.waitForFunction(() => (window as unknown as { __ckDs?: DsReport }).__ckDs?.done, null, { timeout: 60_000 });
  const stage = page.getByTestId('assembled');
  await stage.scrollIntoViewIfNeeded();
  return stage;
}

test('the Scale: a drag, the hold at the mark, a tap, the keyboard and undo', async ({ page }) => {
  const stage = await openGallery(page);
  await stage.getByRole('button', { name: 'Скорость' }).click();
  const scale = stage.getByRole('slider', { name: 'Скорость' });
  await expect(scale).toHaveAttribute('aria-valuenow', '100');
  const digit = stage.locator('.ck-digit');
  const box = (await scale.boundingBox())!;
  const cx = box.x + box.width / 2, cy = box.y + box.height / 2;

  // The strip moves under a needle that stands still: to the left is more. The first 8 units of travel are the hold.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx - 60, cy, { steps: 6 });
  await expect(scale).toHaveAttribute('aria-valuenow', '150');
  await expect(digit).toHaveAttribute('data-moving', 'true');
  await page.mouse.up();
  await expect(digit).toHaveAttribute('data-moving', 'false');
  await expect(digit).toHaveText('1,5×');
  await expect(scale).toHaveAttribute('aria-valuetext', '1,5×');

  // Back through the mark of what was: it holds there, and then goes on — nothing next to it is lost.
  await page.mouse.move(cx, cy);
  await page.mouse.down();
  await page.mouse.move(cx + 50, cy, { steps: 5 });
  await expect(scale).toHaveAttribute('aria-valuenow', '100');
  await page.mouse.move(cx + 56, cy);
  await expect(scale).toHaveAttribute('aria-valuenow', '100');
  await page.mouse.move(cx + 63, cy);
  await expect(scale).toHaveAttribute('aria-valuenow', '95');
  await page.mouse.move(cx + 70, cy);
  await expect(scale).toHaveAttribute('aria-valuenow', '90');
  await page.mouse.up();

  // While a value is set, the whole film is one strip: a tap goes anywhere, the arrows step by 1%.
  const film = stage.getByRole('slider', { name: 'Положение в видео' });
  await expect(film).toHaveAttribute('aria-valuenow', '20');
  const fb = (await film.boundingBox())!;
  await page.mouse.click(fb.x + fb.width * 0.75, fb.y + fb.height / 2);
  await expect.poll(async () => Number(await film.getAttribute('aria-valuenow')), 'three quarters of the film').toBeGreaterThanOrEqual(73);
  expect(Number(await film.getAttribute('aria-valuenow'))).toBeLessThanOrEqual(77);
  await film.evaluate((el) => (el as HTMLElement).focus());
  await page.keyboard.press('Home');
  await page.keyboard.press('PageUp');
  await expect(film).toHaveAttribute('aria-valuenow', '10');
  await film.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(film).toHaveAttribute('aria-valuetext', '1,1 с из 12 с');
  // One gesture is one step of undo.
  await stage.getByRole('button', { name: 'Отменить' }).click();
  await expect(scale).toHaveAttribute('aria-valuenow', '150');
  await stage.getByRole('button', { name: 'Отменить' }).click();
  await expect(scale).toHaveAttribute('aria-valuenow', '100');

  // No value needs a drag (WCAG 2.5.7): a tap brings the tick under the finger to the needle, the keyboard steps.
  await page.mouse.click(cx + 80, cy);
  await expect(scale).toHaveAttribute('aria-valuenow', '180');
  await scale.focus();
  await page.keyboard.press('ArrowRight');
  await expect(scale).toHaveAttribute('aria-valuenow', '185');
  await page.keyboard.press('PageDown');
  await expect(scale).toHaveAttribute('aria-valuenow', '85');
  await page.keyboard.press('Home');
  await expect(scale).toHaveAttribute('aria-valuenow', '25');
  await page.keyboard.press('End');
  await expect(scale).toHaveAttribute('aria-valuenow', '400');
  await stage.getByRole('button', { name: 'Сбросить' }).click();
  await expect(scale).toHaveAttribute('aria-valuenow', '100');
  await expect(stage.getByRole('button', { name: 'Сбросить' })).toBeDisabled();

  // One step exactly, by a button at each end of the strip; quick steps in a row are one step of undo — at once, not after a pause.
  const more = stage.getByRole('button', { name: 'Больше' });
  await more.click(); await more.click(); await more.click();
  await expect(scale).toHaveAttribute('aria-valuenow', '115');
  await stage.getByRole('button', { name: 'Отменить' }).click();
  await expect(scale).toHaveAttribute('aria-valuenow', '100');
  await stage.getByRole('button', { name: 'Меньше' }).click();
  await expect(scale).toHaveAttribute('aria-valuenow', '95');
});

test('the Scale: a gesture the system takes away sets nothing, a second finger does not steal the strip', async ({ page }) => {
  const stage = await openGallery(page);
  await stage.getByRole('button', { name: 'Скорость' }).click();
  const scale = stage.getByRole('slider', { name: 'Скорость' });
  const fire = (type: string, id: number, x: number) => scale.evaluate((el, a) => {
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent(a.type, { bubbles: true, cancelable: true, pointerId: a.id, pointerType: 'touch', clientX: r.left + r.width / 2 + a.x, clientY: r.top + 20 }));
  }, { type, id, x });
  await fire('pointerdown', 5, 0);
  await fire('pointermove', 5, -60);
  await expect(scale).toHaveAttribute('aria-valuenow', '150');
  // A second finger comes down, moves and lifts (the start of a pinch): the value belongs to the first.
  await fire('pointerdown', 6, 40);
  await fire('pointermove', 6, 140);
  await fire('pointerup', 6, 140);
  await expect(scale).toHaveAttribute('aria-valuenow', '150');
  await expect(stage.locator('.ck-digit')).toHaveAttribute('data-moving', 'true');
  // The browser takes the gesture (a scroll began, an edge swipe): the value returns, and there is nothing to undo.
  await fire('pointercancel', 5, -60);
  await expect(scale).toHaveAttribute('aria-valuenow', '100');
  await expect(stage.locator('.ck-digit')).toHaveAttribute('data-moving', 'false');
  await stage.getByRole('button', { name: 'Отменить' }).click();
  await expect(stage.getByRole('status')).toHaveText('Отменять пока нечего');
});

test('the ribbon keeps today\'s order; all tools open as a sheet that gives the focus back', async ({ page }) => {
  const stage = await openGallery(page);
  const ribbon = stage.getByRole('navigation', { name: 'Инструменты' });
  const names = await ribbon.locator('.ck-ribbon-tools .ck-tool').allInnerTexts();
  expect(names.slice(0, 5).map((s) => s.trim())).toEqual(['Разрезать', 'Дублировать', 'Удалить', 'Скорость', 'Громкость']);
  expect(names.length).toBe(23);
  const seen = await ribbon.locator('.ck-ribbon-tools').evaluate((el) => {
    const view = el.getBoundingClientRect();
    return [...el.children].filter((c) => { const r = c.getBoundingClientRect(); return r.left >= view.left - 0.5 && r.right <= view.right + 0.5; }).length;
  });
  expect(seen, 'as many tools in sight as today (four), without a swipe').toBeGreaterThanOrEqual(4);

  const all = ribbon.getByRole('button', { name: 'Все' });
  await all.click();
  const sheet = stage.getByRole('dialog', { name: 'Все инструменты' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.ck-tool')).toHaveCount(23);
  expect(await sheet.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  expect(await ribbon.evaluate((el) => (el as HTMLElement).inert), 'what lies under an open sheet is out of reach of Tab and of a screen reader').toBe(true);
  await page.keyboard.press('Escape');
  await expect(stage.locator('.ck-sheet-layer')).toHaveAttribute('data-open', 'false');
  expect(await all.evaluate((el) => el === document.activeElement), 'the focus returns to «Все»').toBe(true);

  await all.click();
  await stage.locator('.ck-scrim').click({ position: { x: 20, y: 20 } });
  await expect(stage.locator('.ck-sheet-layer')).toHaveAttribute('data-open', 'false');

  await all.click();
  await sheet.getByRole('button', { name: 'Настройка' }).click();
  await expect(stage.getByRole('slider', { name: 'Экспозиция' })).toBeVisible();
  // The button that opened the sheet is gone with the ribbon: the focus goes to what came instead, not to nowhere.
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('role') ?? document.activeElement?.tagName)).toBe('slider');
  const tabs = stage.getByRole('tablist', { name: 'Параметры' });
  await expect(tabs.getByRole('tab')).toHaveCount(5);
  await tabs.getByRole('tab', { name: 'Экспозиция' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(tabs.getByRole('tab', { name: 'Контраст' })).toHaveAttribute('aria-selected', 'true');
  await expect(stage.getByRole('slider', { name: 'Контраст' })).toBeVisible();
  await stage.getByRole('button', { name: 'Готово' }).click();
  await expect(ribbon).toBeVisible();
});

test('everything that is pressed is at least 44 px and has a name', async ({ page }) => {
  const stage = await openGallery(page);
  await stage.getByRole('button', { name: 'Скорость' }).click();
  const small = await page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll<HTMLElement>('.ds button, .ds [role="slider"], .ds [role="tab"]')) {
      if (el.closest('[inert]') || el.hasAttribute('data-demo')) continue; // a drawn "pressed" state is scaled down on purpose
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const name = (el.getAttribute('aria-label') || el.textContent || '').trim();
      if (!name) out.push(`no name: ${el.className}`);
      if (r.width < 43.5 || r.height < 43.5) out.push(`${name}: ${Math.round(r.width)}×${Math.round(r.height)}`);
    }
    return out;
  });
  expect(small).toEqual([]);
  // The old stylesheet dims every disabled <button> by its tag; in the new system "disabled" is a colour with a known contrast.
  const disabled = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ds .ck-btn:disabled, .ds .ck-ib:disabled, .ds .ck-tool:disabled')].map((el) => getComputedStyle(el).opacity));
  expect(disabled.length).toBeGreaterThan(4);
  expect([...new Set(disabled)]).toEqual(['1']);
  // A tool is not a switch: none of them says "pressed", the one that has changed the piece says so in words.
  expect(await page.locator('.ds .ck-tool[aria-pressed]').count()).toBe(0);
  await expect(page.locator('.ds .ck-tool[data-on="true"]').first()).toContainText('изменено');
});

// ---- stage Ч3, the second batch: choices, a field, the home screen and the editor assembled ----
async function openPart(page: import('@playwright/test').Page, id: 'home' | 'editor') {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./?ds');
  await page.waitForFunction(() => (window as unknown as { __ckDs?: DsReport }).__ckDs?.done, null, { timeout: 60_000 });
  const stage = page.getByTestId(id);
  await stage.scrollIntoViewIfNeeded();
  return stage;
}

test('choices are radio groups: arrows move the choice and the focus, one tab stop each; a field names itself and is never zoomed into', async ({ page }) => {
  await openPart(page, 'home');
  const format = page.getByRole('radiogroup', { name: 'Формат кадра' });
  await expect(format.getByRole('radio', { name: '9:16' })).toHaveAttribute('aria-checked', 'true');
  expect(await format.locator('[tabindex="0"]').count()).toBe(1);
  await format.getByRole('radio', { name: '9:16' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(format.getByRole('radio', { name: '16:9' })).toHaveAttribute('aria-checked', 'true');
  await expect(format.getByRole('radio', { name: '16:9' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(format.getByRole('radio', { name: '3:4' })).toHaveAttribute('aria-checked', 'true');
  const looks = page.getByRole('radiogroup', { name: 'Фильтр' });
  await looks.getByRole('radio', { name: 'Нуар' }).click();
  await expect(looks.getByRole('radio', { name: 'Нуар' })).toHaveAttribute('aria-checked', 'true');
  expect(await looks.locator('.ck-held').count(), 'the chosen look lies between two marks').toBe(1);

  const title = page.getByRole('textbox', { name: 'Название проекта' });
  await expect(title).toHaveValue('Поход на Алтай');
  await expect(title, 'the limit is heard, not only seen').toHaveAccessibleDescription('14 из 80 знаков');
  expect(Number(await title.evaluate((e) => parseFloat(getComputedStyle(e).fontSize))), 'Safari zooms into a field under 16 px').toBeGreaterThanOrEqual(16);
  const empty = page.getByLabel('Название, пустое');
  await expect(empty).toHaveAttribute('aria-invalid', 'true');
  await expect(empty).toHaveAccessibleDescription(/хотя бы одну букву/);
});

test('home: a project is deleted only after one honest question; with none left, the empty screen offers the example', async ({ page }) => {
  const home = await openPart(page, 'home');
  const rows = home.getByRole('article');
  await expect(rows).toHaveCount(3);
  await home.getByRole('button', { name: 'Удалить «Огни города»' }).click();
  const ask = page.getByRole('dialog', { name: 'Удалить «Огни города»?' });
  await expect(ask).toBeVisible();
  await expect(ask).toHaveAccessibleDescription(/Вернуть их будет нельзя/);
  await expect(ask.getByRole('button', { name: 'Отмена' }), 'the safe answer has the focus').toBeFocused();
  await page.keyboard.press('Escape');
  await expect(ask).toBeHidden();
  await expect(rows).toHaveCount(3);

  for (const name of ['Огни города', 'Рецепт за минуту', 'Поход на Алтай']) {
    await home.getByRole('button', { name: `Удалить «${name}»` }).click();
    await page.getByRole('dialog', { name: `Удалить «${name}»?` }).getByRole('button', { name: 'Удалить' }).click();
    await expect(home.getByRole('status')).toContainText(`«${name}» удалён`);
    // The row is gone with its button: the focus goes to the next row or the main button, never to nowhere.
    await expect.poll(() => page.evaluate(() => document.activeElement?.closest('[data-testid="home"]') !== null && document.activeElement?.tagName === 'BUTTON')).toBe(true);
  }
  await expect(rows).toHaveCount(0);
  await expect(home.getByRole('heading', { name: 'Посмотрите, что получается' })).toBeVisible();
  await home.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(rows).toHaveCount(3);

  // The row opens the project anywhere on it, and its own buttons still act on their own.
  const first = rows.first();
  const box = (await first.boundingBox())!;
  await first.click({ position: { x: box.width - 20, y: 20 } });
  await expect(home.getByRole('status')).toContainText('открывается в редакторе');
  await home.getByRole('button', { name: 'Переименовать «Поход на Алтай»' }).click();
  const sheet = page.getByRole('dialog', { name: 'Название проекта' });
  const field = sheet.getByLabel('Название');
  await field.fill('');
  await expect(sheet.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.fill('Алтай, июль');
  await page.keyboard.press('Enter');
  await expect(home.getByRole('article', { name: 'Алтай, июль' })).toBeVisible();
});

test('editor: a piece is held by its two marks, trimmed by a finger or the arrows, cut at the playhead, deleted and brought back', async ({ page }) => {
  const ed = await openPart(page, 'editor');
  const piece = ed.getByRole('button', { name: /^Видео, 5 с/ });
  await piece.click();
  await expect(piece).toHaveAttribute('aria-pressed', 'true');
  const end = ed.getByRole('slider', { name: 'Обрезать конец' });
  await expect(end).toHaveAttribute('aria-valuenow', '5');
  // The marks are sliders beside the piece's button, not inside it: a key on them never drops the selection.
  await end.focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press(' ');
  await expect(piece).toHaveAttribute('aria-pressed', 'true');
  expect(await end.evaluate((el) => el.closest('button')), 'no control inside a button').toBeNull();
  const hit = (await end.boundingBox())!;
  expect(Math.round(hit.width), 'the mark is 8 px to the eye, 44 to the finger').toBeGreaterThanOrEqual(44);
  await end.focus();
  await page.keyboard.press('ArrowRight');
  await expect(end).toHaveAttribute('aria-valuenow', '5.1');
  await page.keyboard.press('Shift+ArrowLeft');
  await expect(end).toHaveAttribute('aria-valuenow', '4.1');
  // A finger: 45 px is one second. The mark has moved with the keys: take it where it is now.
  const at = (await end.boundingBox())!;
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 45, at.y + at.height / 2, { steps: 5 });
  await page.mouse.up();
  await expect(end).toHaveAttribute('aria-valuenow', '5.1');
  await ed.getByRole('button', { name: 'Отменить' }).click();
  await expect(end).toHaveAttribute('aria-valuenow', '4.1');

  // Cut at the white line (2,4 s): two pieces where there was one.
  const main = ed.locator('.ck-lane[data-main] .ck-clip');
  await expect(main).toHaveCount(3);
  await ed.getByRole('navigation', { name: 'Инструменты' }).getByRole('button', { name: 'Разрезать' }).click();
  await expect(main).toHaveCount(4);
  // Delete, and bring it back from the toast.
  await ed.getByRole('navigation', { name: 'Инструменты' }).getByRole('button', { name: 'Удалить' }).click();
  await expect(main).toHaveCount(3);
  await expect.poll(() => page.evaluate(() => document.activeElement?.classList.contains('ck-clip-select')), 'the focus goes to the piece that took its place').toBe(true);
  const toast = ed.getByRole('status');
  await expect(toast).toContainText('Кусок удалён');
  await toast.getByRole('button', { name: 'Отменить' }).click();
  await expect(main).toHaveCount(4);
  await expect(toast).not.toContainText('Кусок удалён');
  await expect.poll(() => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '')).toMatch(/^Видео/);

  // A failure is read out at once and stays until it is closed: cutting where the white line is not on the piece.
  await ed.getByRole('button', { name: /^Привет, Алтай/ }).click();
  await ed.locator('.ds-tl').evaluate((el) => { el.scrollLeft = 11 * 45; }); // after the tap: tapping scrolls the piece into view
  await ed.getByRole('navigation', { name: 'Инструменты' }).getByRole('button', { name: 'Разрезать' }).click();
  const alert = ed.getByRole('alert');
  await expect(alert).toContainText('Не разрезано');
  await page.waitForTimeout(5_000); // longer than a plain toast is shown
  await expect(alert).toContainText('Не разрезано');
  await alert.getByRole('button', { name: 'Закрыть' }).click();
  await expect(alert).not.toContainText('Не разрезано');
});

test('editor: the toast with an action waits while a finger is on it, a plain one goes by itself', async ({ page }) => {
  const ed = await openPart(page, 'editor');
  await ed.getByRole('button', { name: /^Orchid/ }).click();
  await ed.getByRole('navigation', { name: 'Инструменты' }).getByRole('button', { name: 'Удалить' }).click();
  const toast = ed.locator('.ck-toast', { hasText: 'Кусок удалён' });
  await toast.hover();
  await page.waitForTimeout(8_000); // longer than it is shown (7 s)
  await expect(toast, 'held under the pointer').toBeVisible();
  await page.mouse.move(5, 5);
  await expect(toast).toBeHidden({ timeout: 12_000 });
  await ed.getByRole('button', { name: 'Добавить переход' }).first().click();
  const plain = ed.locator('.ck-toast', { hasText: 'Переход: плавный' });
  await expect(plain).toBeVisible();
  await expect(plain).toBeHidden({ timeout: 10_000 });
  // The join is small to the eye and full size to the finger.
  const join = (await ed.getByRole('button', { name: 'Переход: плавный' }).boundingBox())!;
  expect(Math.round(join.width)).toBeGreaterThanOrEqual(44);
  expect(Math.round(join.height)).toBeGreaterThanOrEqual(44);
});

test('editor: a selected text is boxed on the frame in white with a dark edge, and the tools follow what is selected', async ({ page }) => {
  const ed = await openPart(page, 'editor');
  const ribbon = ed.getByRole('navigation', { name: 'Инструменты' });
  await expect(ribbon.getByRole('button', { name: 'Медиа' })).toBeVisible();
  await expect(ed.locator('.ck-object')).toHaveCount(0);
  await ed.getByRole('button', { name: /^Привет, Алтай/ }).click();
  await expect(ed.locator('.ck-object')).toHaveCount(1);
  await expect(ribbon.getByRole('button', { name: 'Трансформация' })).toBeVisible();
  const edge = await ed.locator('.ck-object').evaluate((e) => getComputedStyle(e).boxShadow);
  expect(edge.match(/(?:rgba?|oklch|color)\(/g)?.length, 'a white line and a dark one around it').toBe(2);
  const handle = (await ed.locator('.ck-object-handle').boundingBox())!;
  expect(Math.round(handle.width)).toBeGreaterThanOrEqual(44);
  await ribbon.getByRole('button', { name: 'Назад' }).click();
  await expect(ed.locator('.ck-object')).toHaveCount(0);
  await expect(ribbon.getByRole('button', { name: 'Медиа' })).toBeVisible();
});
