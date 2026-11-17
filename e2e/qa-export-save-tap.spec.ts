// «Save» after an export, when the phone refuses the share sheet the first time (audit V-138: on an iPhone the first
// tap did nothing, the second worked). Kadr calls the sheet inside the tap — this test checks that with the browser's
// own record of the tap (navigator.userActivation) — so the refusal is the phone's. What was Kadr's: it then fell back to
// a download, which on an iPhone shows nothing, and counted the file as saved, so «Done» let it go without a word. The
// share sheet here is a stand-in that refuses its first call as the phone did and takes the second.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test('a share sheet refused on the first tap: the person is told, the file stays unsaved, the next tap saves it (V-138)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    const w = window as unknown as { __share: (boolean | null)[] };
    w.__share = [];
    Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
    Object.defineProperty(navigator, 'share', {
      configurable: true,
      value: async () => {
        w.__share.push((navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation?.isActive ?? null);
        if (w.__share.length === 1) throw new DOMException('The request is not allowed by the user agent.', 'NotAllowedError');
      },
    });
  });
  let downloads = 0;
  page.on('download', () => { downloads++; });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('silent.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  const ready = page.getByText(/Ready: .* MB/);
  await expect(ready).toBeVisible({ timeout: 120_000 });
  const shares = () => page.evaluate(() => (window as unknown as { __share: (boolean | null)[] }).__share);

  await page.getByRole('button', { name: 'Save / Share' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'The menu did not open' }), 'the refusal is said').toBeVisible();
  expect(await shares(), 'the sheet was asked for inside the tap').toEqual([true]);
  expect(downloads, 'no download that shows nothing on a phone').toBe(0);

  // Not saved: «Done» still warns before the file goes.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'not saved yet' })).toBeVisible();
  await expect(ready, 'the file is still offered').toBeVisible();

  await page.getByRole('button', { name: 'Save / Share' }).click();
  await expect.poll(shares).toEqual([true, true]);
  await page.waitForTimeout(4500); // past the guard's window of the warning above
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' }), 'saved: «Done» just closes').toHaveCount(0);
  expect(downloads).toBe(0);
});
