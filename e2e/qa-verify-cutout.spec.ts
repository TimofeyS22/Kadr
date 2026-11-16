// Verification, lane E4 (docs/21 §5), row C-L3 (N9: cut-out, one of the tools the CapCut complaint names). The test
// that held the cut-out counts a light halo at the edge of the person; with the cut-out switched off in a control
// build it stayed green on both engines, because a white background has no dark edge to count a halo at. Here the
// file says whether the background went: the white around the person in fixtures/person.jpg (about half of it) is
// dark in the exported photo, and the dark suit is still there.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const W = 270, H = 480;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
});

/** The exported photo as W×H gray. */
async function exportPhoto(page: Page, info: TestInfo, name: string): Promise<Buffer> {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Photo', exact: true }).click();
  await page.getByRole('button', { name: 'Save photo' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath(name);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `scale=${W}:${H}`, '-f', 'rawvideo', '-pix_fmt', 'gray', '-']);
}

test('cut-out: the background around the person is gone from the exported photo, the person stays', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('person.jpg'));
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  const plain = await exportPhoto(page, info, 'plain.jpg');
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  const cutout = page.getByRole('button', { name: 'Cutout', exact: true });
  await cutout.click();
  await expect(cutout).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
  const cut = await exportPhoto(page, info, 'cut.jpg');

  let white = 0, whiteGone = 0, suit = 0, suitKept = 0;
  for (let i = 0; i < W * H; i++) {
    if (plain[i] > 200) { white++; if (cut[i] < 40) whiteGone++; }
    if (plain[i] < 60) { suit++; if (cut[i] < 90) suitKept++; }
  }
  console.log(`cut-out (${info.project.name}): white background ${(white / (W * H) * 100).toFixed(0)}% of the frame, ${(whiteGone / white * 100).toFixed(0)}% of it dark after the cut-out; dark pixels kept ${(suitKept / suit * 100).toFixed(0)}%`);
  expect(white / (W * H), 'the plain photo shows its white background').toBeGreaterThan(0.2);
  expect(whiteGone / white, 'the background is gone from the file').toBeGreaterThan(0.8);
  expect(suitKept / suit, 'the person is still there').toBeGreaterThan(0.8);
});
