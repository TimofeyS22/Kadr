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
