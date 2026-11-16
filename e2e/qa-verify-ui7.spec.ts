// Verifier E1 (docs/21 §5), lane U row UI-7 after 84889aa: a sheet stopped below its working set follows that set when
// it grows after the sheet opened. Before, a font that arrived late made the Values taller while the stop stayed where it
// was measured, and the bottom of the Scale and its keyframe diamond went under the cut — the UI-9 finger test caught it
// on WebKit only when the font came late, that is under load. Here the set grows on purpose, the way a late font grows it.
import { expect, test } from '@playwright/test';

test('UI-7: a sheet stopped below its working set keeps the whole set in view when the set grows after it opened', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'ru');
    localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.undoMoved.v1', '1');
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.locator('.tl-row.main .clip').first().click();
  await page.locator('.toolbar .tool', { hasText: /^Трансформация$/ }).click();
  const sheet = page.locator('.sheet[data-capped]');
  await expect(sheet, 'the sheet stops below its working set').toHaveCount(1);
  await page.waitForTimeout(500); // settled at its first measure
  // The working set: the parts of the sheet's body before the one marked data-below. The last of them grows by 60 px, more than the 24 px peek.
  const cut = () => sheet.evaluate((s) => {
    const body = s.querySelector('.ck-panel-body')!, parts = [...body.children], below = s.querySelector('[data-below]')!;
    const set = parts.slice(0, parts.indexOf(below)), last = set[set.length - 1] as HTMLElement;
    return { lastBottom: Math.round(last.getBoundingClientRect().bottom), shown: Math.round(body.getBoundingClientRect().bottom), scrolled: body.scrollTop };
  });
  const before = await cut();
  expect(before.scrolled, 'nothing scrolled yet').toBe(0);
  expect(before.lastBottom, 'at first the whole working set is in view').toBeLessThanOrEqual(before.shown);
  await sheet.evaluate((s) => {
    const body = s.querySelector('.ck-panel-body')!, parts = [...body.children], below = s.querySelector('[data-below]')!;
    // Content, not padding: a ResizeObserver sees the content box, and a late font grows the content.
    const grow = document.createElement('div'); grow.style.height = '60px'; grow.className = 'e1-grow';
    parts[parts.indexOf(below) - 1].appendChild(grow); // as a late font makes the Values taller
  });
  await page.waitForTimeout(500);
  const after = await cut();
  console.log(`UI-7 growth (${test.info().project.name}): before ${JSON.stringify(before)}, after ${JSON.stringify(after)}`);
  expect(after.lastBottom, 'after it grew the working set is still whole, the stop followed it down').toBeLessThanOrEqual(after.shown);
});
