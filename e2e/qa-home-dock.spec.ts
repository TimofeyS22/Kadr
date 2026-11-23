// SW-A-3: the dock at the bottom of Home («Новый проект», «Открыть пример», «Восстановить копию») takes every touch
// on it, whatever the list scrolled under it. It is fixed to the screen and the projects' rows pass under it; on one
// layer with the rows' buttons (`--z-mark`) the rows, later in the page, were drawn over it: with two projects on
// 375×667 the middle of «Новый проект» was the second project's «Переименовать» (lane A, Q-4).
import { expect, test, type Page } from '@playwright/test';

async function home(page: Page) {
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.homeMoved.v1', '1'); });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'Новый проект' })).toBeVisible();
}

async function sample(page: Page) {
  await page.getByRole('button', { name: 'Открыть пример' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'К проектам' }).click();
  await expect(page.getByRole('button', { name: 'Новый проект' })).toBeVisible();
}

/** Where a touch on the dock's buttons lands, at a quarter, the middle and three quarters of each: the button itself. */
const misses = (page: Page) => page.evaluate(() => {
  const out: string[] = [];
  for (const b of document.querySelectorAll<HTMLElement>('.ck-home-dock button')) {
    const r = b.getBoundingClientRect(), name = b.textContent!.trim();
    for (const f of [0.25, 0.5, 0.75]) {
      const at = document.elementFromPoint(r.left + r.width * f, r.top + r.height / 2);
      if (!at || !b.contains(at)) out.push(`«${name}» at ${f}: ${at ? (at.closest('button')?.getAttribute('aria-label') || at.closest('button')?.textContent?.trim() || (at as HTMLElement).className) : 'nothing'}`);
    }
  }
  return out;
});

for (const [w, h] of [[375, 667], [393, 659]] as const) {
  test(`SW-A-3 at ${w}×${h}: with three projects under it, every touch on the dock takes its own button, wherever the list is scrolled`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: w, height: h });
    await home(page);
    for (let i = 0; i < 3; i++) await sample(page);
    await expect(page.locator('.project-card')).toHaveCount(3);
    const found: string[] = [];
    const end = await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight);
    for (let y = 0; y <= end + 40; y += 40) {
      await page.evaluate((y) => scrollTo(0, y), y);
      await page.waitForTimeout(30);
      for (const m of await misses(page)) found.push(`scrolled ${y}: ${m}`);
    }
    expect([...new Set(found)].slice(0, 12), 'the dock is over the list, never under it').toEqual([]);
    // And the rows still take a finger where the dock is not.
    await page.evaluate(() => scrollTo(0, 0));
    await expect(page.locator('.project-card').first().getByRole('button', { name: /^Переименовать/ })).toBeVisible();
  });
}
