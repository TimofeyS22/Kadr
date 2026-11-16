// Verifier E1 (docs/21 §5), audit V-102: a guide track longer than the video adds nothing to the file. The original e2e
// stayed green with the fix taken out (control, 2026-11-14), and it never showed that the music made the timeline
// longer in the first place. Here the same project is exported twice: as a plain music track the file must be as long
// as the music (the check can see a tail), as a guide track as long as the video. Music put on a video ends with it since
// S-1-4, which is why the original test made no tail at all: here its edge is dragged past the video, as a person would.
import { execSync } from 'node:child_process';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const seconds = (f: string) => Number(execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${f}"`));

async function importFiles(page: Page, tool: string, files: string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: tool, exact: true }).click();
  await (await chooser).setFiles(files.map(fx));
}

async function exportVideo(page: Page, file: string) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return seconds(file);
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
});

test('music longer than the video lengthens the file; the same music as a guide track does not (audit V-102)', async ({ page }, info) => {
  test.setTimeout(600_000);
  const video = seconds(fx('silent.mp4')), music = seconds(fx('music.m4a'));
  expect(music - video, 'the music is longer than the video').toBeGreaterThan(3);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['silent.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await importFiles(page, 'Audio', ['music.m4a']);
  const sound = page.locator('.tl-row.audio .clip').first();
  await expect(sound).toHaveCount(1);
  // Put on top of the video, the music ends with it (S-1-4); its edge drags it longer again: five seconds past the video.
  await sound.click();
  for (let k = 0; k < 5; k++) await sound.getByRole('slider', { name: 'Trim end' }).press('Shift+ArrowRight');
  const plain = await exportVideo(page, info.outputPath('plain.mp4'));
  expect(plain, 'as plain music past the video it is exported: the check sees a tail').toBeGreaterThan(video + 3);
  await page.locator('.tl-row.audio .clip').first().click();
  await page.getByRole('button', { name: 'Volume', exact: true }).click();
  await page.getByRole('switch', { name: /Guide track/ }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  const guided = await exportVideo(page, info.outputPath('guided.mp4'));
  expect(guided, 'as a guide track: as long as the video, not as the music').toBeLessThan(video + 0.2);
});
