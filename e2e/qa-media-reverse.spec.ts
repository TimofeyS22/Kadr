// Cancel stops a reverse at once (SW-C-7, found by lane C of the sweep, docs/21). Reversing a 60 s clip first gathers,
// turns round and encodes all of its sound, and that phase did not look at Cancel: on WebKit the overlay stayed 24.9 s
// after the tap. Now each step of the sound phase asks, as the frame phase did.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test('Cancel ends the reverse of a 60 s clip within seconds, the sound phase included (SW-C-7)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('long_1.mp4')); // 60 s of 1080p with sound
  const clip = page.locator('.tl-row.main .clip');
  await expect(clip).toHaveCount(1, { timeout: 60_000 });
  await clip.first().click();
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  const busy = page.locator('.busy');
  await expect(busy).toBeVisible();
  await page.waitForTimeout(1000); // into the sound phase, which comes first
  const at = Date.now();
  await busy.getByRole('button', { name: 'Cancel' }).click();
  await expect(busy, 'a cancelled reverse ends').toHaveCount(0, { timeout: 120_000 });
  const took = (Date.now() - at) / 1000;
  console.log(`reverse cancelled (${info.project.name}): the overlay left ${took.toFixed(1)} s after Cancel`);
  expect(took, 'Cancel is heard within 5 s').toBeLessThan(5);
  await expect(clip, 'the clip is as it was').toHaveCount(1);
});
