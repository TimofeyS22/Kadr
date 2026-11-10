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
