// SW-U-15: the iPhone puts on its Home Screen the page's apple-touch-icon only when it is a PNG; with the SVG Kadr linked
// there, «На экран "Домой"» showed a shot of the page instead of the icon — and Home advises adding Kadr there to keep the
// projects past Safari's seven days.
import { expect, test } from '@playwright/test';

test('SW-U-15: the Home Screen icon the iPhone takes is a 180 × 180 PNG the site serves', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(href, 'a PNG: the iPhone does not take an SVG for the Home Screen').toMatch(/\.png$/);
  const res = await request.get(new URL(href!, page.url()).href);
  expect(res.status()).toBe(200);
  const png = await res.body();
  expect(png.subarray(1, 4).toString(), 'a PNG file').toBe('PNG');
  expect([png.readUInt32BE(16), png.readUInt32BE(20)], '180 × 180, the size the iPhone asks for').toEqual([180, 180]);
});
