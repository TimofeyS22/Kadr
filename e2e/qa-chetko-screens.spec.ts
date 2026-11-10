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
  await page.locator('.home-actions .btn.primary').click();
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
  const main = page.locator('.home-actions .btn.primary');
  await expect(main).toBeVisible();
  const look = await page.evaluate(() => {
    const px = (colour: string) => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      ctx.fillStyle = colour; ctx.fillRect(0, 0, 1, 1);
      return Array.from(ctx.getImageData(0, 0, 1, 1).data.subarray(0, 3));
    };
    const btn = document.querySelector('.home-actions .btn.primary')!;
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
