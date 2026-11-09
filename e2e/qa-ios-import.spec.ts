// Adding a video from Photos on an iPhone (owner, 2026-11-10: "videos from the gallery load very slowly"). The wait is
// inside the iPhone's picker, which re-encodes HEVC unless its format is "Current"; a site cannot set that, the person
// can. So Kadr says it before the first pick, not after, and reminds only when the facts point to a re-encoded file.
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const card = (page: Page) => page.getByRole('dialog', { name: 'Videos in seconds' });

async function editor(page: Page, seenCard: boolean) {
  await page.addInitScript((seen) => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    if (seen) localStorage.setItem('kadr.iosFormatCard.v1', '1');
  }, seenCard);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}

test('iPhone, first pick: the format advice comes before the picker, its button opens the picker, and it comes once', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'webkit', 'the advice is for iPhones');
  await page.setViewportSize({ width: 375, height: 667 });
  await editor(page, false);
  let choosers = 0;
  page.on('filechooser', () => { choosers++; });
  await tool(page, 'Media').click();
  await expect(card(page)).toBeVisible();
  await expect(card(page)).toContainText('Format: Current');
  expect(choosers, 'the picker waits for the person to read').toBe(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no sideways scroll').toBe(true);
  const go = page.getByRole('button', { name: 'Choose from Photos' });
  const box = (await go.boundingBox())!;
  expect(box.height).toBeGreaterThanOrEqual(44);
  expect(box.y + box.height, 'the button is on screen without scrolling, on a small iPhone').toBeLessThanOrEqual(667);
  await page.screenshot({ path: info.outputPath('card.png') });
  const chooser = page.waitForEvent('filechooser');
  await go.click();
  await (await chooser).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await expect(card(page)).toHaveCount(0);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  const again = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await again).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(2);
});

test('the person closes the advice without picking: it comes again, because they have not been to the picker', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the advice is for iPhones');
  await editor(page, false);
  await tool(page, 'Media').click();
  await expect(card(page)).toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(card(page)).toHaveCount(0);
  await tool(page, 'Media').click();
  await expect(card(page)).toBeVisible();
});

test('Android: no advice, the picker opens at once', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Android does not re-encode');
  await editor(page, false);
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
});

for (const [file, codec, reminded] of [['landscape.mp4', 'H.264', true], ['iphone_hdr.mov', 'HEVC', false]] as const) {
  test(`iPhone, the picker was open 20 s and an ${codec} video came out: ${reminded ? 'a reminder with the seconds' : 'no reminder, that is an original'}`, async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'the advice is for iPhones');
    test.skip(!fs.existsSync(fx(file)), 'needs npm run fixtures with libx265');
    await page.clock.install();
    await editor(page, true);
    const chooser = page.waitForEvent('filechooser');
    await tool(page, 'Media').click();
    const c = await chooser;
    await page.clock.fastForward(20_000);
    await c.setFiles(fx(file));
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    const tip = page.locator('.toast', { hasText: 'Format: Current' });
    if (reminded) await expect(tip).toContainText('open for 20 s');
    else { await page.waitForTimeout(800); await expect(tip).toHaveCount(0); }
  });
}

test('iPhone, a quick pick of an H.264 video: no reminder', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the advice is for iPhones');
  await editor(page, true);
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(fx('landscape.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.waitForTimeout(800);
  await expect(page.locator('.toast', { hasText: 'Format: Current' })).toHaveCount(0);
});
