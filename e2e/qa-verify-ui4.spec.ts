// Verifier E1 (docs/21 §5), lane U row UI-4: the note about black bars judges the video by the shape it plays in, not by
// the shape it is stored in. A phone keeps a portrait recording on its side (1920×1080 and a turn of 90°), so a note
// that read the stored size would tell every vertical iPhone video in 9:16 that it is wider than the frame. The lane's
// test used a portrait file stored upright; here the same recording is stored on its side, as a phone makes it.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1');
  });
});

async function newProjectWith(page: Page, aspect: string, file: string) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: aspect }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.toolbar .tool', { hasText: /^Media$/ }).click();
  await (await chooser).setFiles([fx(file)]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.waitForTimeout(1_000);
}

const note = (page: Page) => page.getByRole('note').filter({ hasText: 'black bars' });

test('UI-4: a portrait recording stored on its side, as a phone keeps it, is portrait to the note — none in 9:16, bars at the sides in 16:9', async ({ page }) => {
  // rotated.mp4: stored 640×360 with a turn of 90°, plays 360×640.
  await newProjectWith(page, '9:16', 'rotated.mp4');
  await expect(note(page), 'a portrait recording fills 9:16, whatever way it is stored').toHaveCount(0);
  await newProjectWith(page, '16:9', 'rotated.mp4');
  await expect(note(page), 'in 16:9 the same recording leaves bars at its sides').toContainText('narrower than the frame');
  await expect(page.getByRole('button', { name: 'Frame format 9:16' })).toBeVisible();
});
