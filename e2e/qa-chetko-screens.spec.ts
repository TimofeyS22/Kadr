// Chetko, stage Ч4 (docs/17): the screens of the product moving onto the design system. Each release adds what it
// promised here: the colours and the face first, then one screen at a time.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'ru');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.iosFormatCard.v1', '1'); // on an iPhone the format card comes before the first pick (D-10)
  });
  await page.setViewportSize({ width: 375, height: 812 });
});

async function editorWithVideo(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.toolbar .tool', { hasText: /^Медиа$/ }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
}

test('UI-1: «Назад» stays opaque over the scrolled tools, and a tap on it is a tap on «Назад» only', async ({ page }) => {
  await editorWithVideo(page);
  const back = page.locator('.toolbar .tool-back');
  await expect(back).toBeVisible();
  await page.locator('.toolbar').evaluate((el) => { el.scrollLeft = 40; });
  const seen = await back.evaluate((el) => {
    const bg = getComputedStyle(el).backgroundColor;
    const r = el.getBoundingClientRect();
    const under = [...document.querySelectorAll('.toolbar .tool:not(.tool-back)')].some((t) => { const q = t.getBoundingClientRect(); return q.left < r.right - 4 && q.right > r.left + 4; });
    return { bg, under };
  });
  expect(seen.under, 'a tool lies under «Назад» once the toolbar is scrolled: the case of the defect').toBe(true);
  // Opaque: no alpha below 1 in the computed colour (rgba(…, 0) was the defect).
  expect(seen.bg).not.toMatch(/rgba\([^)]*,\s*0(\.\d+)?\)|transparent/);
});

test('the screens take the colours and the face of the system: the main action is white, nothing is the old amber', async ({ page }) => {
  await page.goto('./');
  const main = page.getByRole('button', { name: 'Новый проект' });
  await expect(main).toBeVisible();
  const look = await page.evaluate(() => {
    const px = (colour: string) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.subarray(0, 3));
    };
    const btn = document.querySelector('.ck-home-dock .ck-primary')!;
    const amber = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      const s = getComputedStyle(el);
      return [s.color, s.backgroundColor, s.borderTopColor].some((c) => { const [r, g, b] = px(c); return r > 240 && g > 180 && g < 210 && b < 90; });
    }).map((el) => el.className).slice(0, 5);
    return { button: px(getComputedStyle(btn).backgroundColor), font: getComputedStyle(document.body).fontFamily, amber };
  });
  expect(Math.min(...look.button), 'the main action is white').toBeGreaterThan(235);
  expect(look.font).toMatch(/^Geologica/);
  expect(look.amber, 'the amber of v1.7.1 (#ffc53d) is gone').toEqual([]);
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('600 16px Geologica', 'Новый проект'))).toBe(true);
});

// ---- release 2: the home screen on the components of the system ----
async function withSample(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'К проектам' }).click();
  await expect(page.locator('.project-open')).toHaveCount(1);
}

test('home: the first step is one white button in reach of the thumb, and the frame format is two taps away as before', async ({ page }) => {
  await page.goto('./');
  const main = page.getByRole('button', { name: 'Новый проект' });
  await expect(main).toBeVisible();
  const box = (await main.boundingBox())!;
  const vh = page.viewportSize()!.height;
  expect(box.y + box.height / 2, 'in the lower 40% of the screen (Ж3)').toBeGreaterThan(vh * 0.6);
  expect(box.height).toBeGreaterThanOrEqual(56);
  // The only solid white button on the screen.
  const solid = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('button')].filter((b) => {
    const r = b.getBoundingClientRect();
    if (!r.width) return false;
    const ctx = document.createElement('canvas').getContext('2d')!;
    ctx.fillStyle = getComputedStyle(b).backgroundColor; ctx.fillRect(0, 0, 1, 1);
    const [red, green, blue, alpha] = ctx.getImageData(0, 0, 1, 1).data;
    return alpha > 200 && Math.min(red, green, blue) > 235;
  }).map((b) => b.textContent?.trim()));
  expect(solid).toEqual(['Новый проект']);
  // Two taps to a project in a format, as in v1.7.1.
  await main.click();
  const sheet = page.getByRole('dialog', { name: 'Формат кадра' });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator('.aspect-card')).toHaveCount(5);
  await sheet.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  // Not a second word for the move to a first visit: it never saw the buttons at the top.
  await page.goto('./');
  await expect(page.getByRole('note').filter({ hasText: 'теперь внизу' })).toHaveCount(0);
});

test('home: a project is renamed in the app\'s own sheet and deleted after one honest question; the move is said once to who knew the old place', async ({ page }) => {
  await withSample(page);
  // Someone who used v1.7.1: projects, and the move not yet announced.
  await page.evaluate(() => localStorage.removeItem('kadr.homeMoved.v1'));
  await page.reload();
  const moved = page.getByRole('note').filter({ hasText: 'теперь внизу' });
  await expect(moved).toBeVisible();
  await moved.getByRole('button', { name: 'Понятно' }).click();
  await expect(moved).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.project-open')).toHaveCount(1);
  await expect(moved, 'said once').toHaveCount(0);

  const open = page.locator('.project-open');
  await expect(open).toHaveAccessibleDescription(/сохранено/);
  const name = (await open.getAttribute('aria-label'))!.replace(/^Открыть /, ''); // «…» included
  await page.getByRole('button', { name: `Переименовать ${name}` }).click();
  const sheet = page.getByRole('dialog', { name: 'Переименовать' });
  const field = sheet.getByRole('textbox', { name: 'Название проекта' });
  // Renaming is typing: the focus is in the field and the old name is selected, ready to be written over.
  await expect(field).toBeFocused();
  expect(await field.evaluate((el: HTMLInputElement) => el.value.length > 0 && el.selectionStart === 0 && el.selectionEnd === el.value.length)).toBe(true);
  await expect(field).toHaveAccessibleDescription(/из 80 знаков/);
  await field.fill('   ');
  await expect(sheet.getByRole('button', { name: 'Сохранить' })).toBeDisabled();
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await field.fill('Алтай');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Открыть «Алтай»' })).toBeVisible();

  await page.getByRole('button', { name: 'Удалить «Алтай»' }).click();
  const ask = page.getByRole('dialog', { name: 'Удалить «Алтай»?' });
  await expect(ask).toBeVisible();
  await expect(ask).toHaveAccessibleDescription(/Вернуть их будет нельзя/);
  await expect(ask.getByRole('button', { name: 'Отмена' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Открыть «Алтай»' })).toBeVisible();
  await page.getByRole('button', { name: 'Удалить «Алтай»' }).click();
  // While the files are erased the question waits: no second «Удалить», no «Отмена» that would not cancel anything.
  const during = await ask.evaluate(async (d) => {
    [...d.querySelectorAll('button')].find((b) => b.textContent?.trim() === 'Удалить')!.click();
    await new Promise<void>((r) => queueMicrotask(r)); // React applies a tap's state in a microtask; the erasing takes longer
    return { disabled: [...d.querySelectorAll('button')].map((b) => b.disabled), said: d.querySelector('[role="status"]')?.textContent };
  });
  expect(during).toEqual({ disabled: [true, true], said: 'Удаляю…' });
  await expect(page.locator('.project-open')).toHaveCount(0);
  await expect(page.getByText('«Алтай» удалён')).toBeVisible();
  await expect.poll(() => page.evaluate(() => document.activeElement?.tagName), 'the focus lands on a button, not on the page').toBe('BUTTON');
  await expect(page.getByRole('heading', { name: 'Проектов пока нет' })).toBeVisible();
});

test('home: the dock is read right after the reel, the page ends above it, and on a low screen it stays in its place', async ({ page }) => {
  await withSample(page);
  // Reading order: the reel, then the way to start, then the projects (it used to be read last, after the footer).
  const order = await page.evaluate(() => [...document.querySelectorAll('.ck-home-reel, .ck-home-dock, .project-card, .home-foot')].map((e) => e.className.split(' ')[0]));
  expect(order).toEqual(['ck-home-card', 'ck-home-dock', 'ck-project', 'ck-home-foot']);
  await expect(page.getByRole('region', { name: 'Начать проект' })).toBeVisible();
  // At the bottom of the page the footer is above the dock, not under it.
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  const foot = (await page.locator('.home-foot').boundingBox())!;
  const dock = (await page.locator('.ck-home-dock').boundingBox())!;
  expect(foot.y + foot.height).toBeLessThanOrEqual(dock.y + 1);
  // A phone on its side: the dock is part of the page, where the buttons always were, and nothing points down to it.
  await page.evaluate(() => localStorage.removeItem('kadr.homeMoved.v1'));
  await page.setViewportSize({ width: 812, height: 375 });
  await page.reload();
  await expect(page.locator('.project-open')).toHaveCount(1);
  expect(await page.locator('.ck-home-dock').evaluate((el) => getComputedStyle(el).position)).toBe('static');
  await expect(page.getByRole('note').filter({ hasText: 'теперь внизу' })).toBeHidden();
});

test('home: nothing scrolls sideways at 320 px, every control is 44 px and named, the version is in the footer', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await withSample(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)).toBe(false);
  const small = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('.ck-home button, .ck-home [role="radio"]')].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.width > 0 && !b.closest('[inert], .ck-sheet-layer[data-open="false"]') && (r.width < 43.5 || r.height < 43.5 || !(b.getAttribute('aria-label') || b.textContent?.trim()));
  }).map((b) => `${(b.getAttribute('aria-label') || b.textContent || b.className).trim().slice(0, 30)} ${Math.round(b.getBoundingClientRect().width)}×${Math.round(b.getBoundingClientRect().height)}`));
  expect(small).toEqual([]);
  await expect(page.locator('.home-foot')).toContainText(/Kadr v\d/);
});
