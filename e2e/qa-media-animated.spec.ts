// A picture that moves is told to come in still (V-227, found again by E2 of the sweep): an animated WebP and an APNG
// came in without a word, and a GIF too when added from the home screen.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

test('an animated picture added from the home screen is said to come in as its first frame (V-227)', async ({ page }, info) => {
  test.setTimeout(120_000);
  fs.mkdirSync(info.outputDir, { recursive: true });
  const gif = path.join(info.outputDir, 'moving.gif');
  const apng = path.join(info.outputDir, 'moving.png');
  for (const [out, args] of [[gif, []], [apng, ['-plays', '0', '-f', 'apng']]] as const) {
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=64x64:rate=5:duration=1', ...args, out]);
  }
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.locale', 'en'); });
  await page.goto('./#/start/music'); // a home task that takes pictures: its files are imported on the home screen
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.task-banner').getByRole('button', { name: 'Choose a video' }).click();
  await (await chooser).setFiles([gif, apng]);
  await expect(page.locator('.toast').filter({ hasText: 'moving.gif' })).toContainText('first frame', { timeout: 60_000 });
  await expect(page.locator('.toast').filter({ hasText: 'moving.png' })).toContainText('first frame');
});
