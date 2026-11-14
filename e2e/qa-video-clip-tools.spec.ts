// QA matrix Q-10 (docs/21 lane C): clip tools — speed, freeze, reverse, volume, extract audio — by docs/11 §3.
// Points 1–4 are in editor.spec.ts («every video tool works…», «clip tools reach the file frame for frame…», «history and
// persistence across tools», «extreme speeds, 10× and 0.1×»). This file holds point 5, the edges, which the matrix had as ✗.
import { expect, test, type Page } from '@playwright/test';
import {
  audited, closeTools, exportAs, expectToast, importFiles, mainClips, newProject, pcmOf, rmsOf, selectClip, tool,
} from './qa-video-kit';

audited();

const audioClips = (page: Page) => page.locator('.tl-row.audio .clip');

test('Extract audio twice gives the clip\'s sound once: the second tap adds no copy, and the file is as loud as before (Q-10)', async ({ page }, info) => {
  test.setTimeout(420_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']); // 6 s, a steady 440 Hz tone
  await expect(mainClips(page)).toHaveCount(1);
  await closeTools(page);
  const level = async () => { const x = pcmOf(await exportAs(page, info, 'Audio', 'Export audio')); return rmsOf(x, 8000, 40000); };
  const before = await level();
  await selectClip(page, mainClips(page).first());
  await tool(page, 'Extract audio').click();
  await expect(audioClips(page)).toHaveCount(1);
  await expectToast(page, 'Audio extracted to its own track');
  // A second tap on the same clip (a double tap, or the button tried again): its sound is already on its own track.
  await selectClip(page, mainClips(page).first());
  await tool(page, 'Extract audio').click();
  await page.waitForTimeout(1000);
  await expect(audioClips(page), 'one copy of the sound, not two').toHaveCount(1);
  await closeTools(page);
  const after = await level();
  console.log(`extract audio twice (${info.project.name}): RMS ${before.toFixed(4)} before, ${after.toFixed(4)} after`);
  expect(after / before, 'the file sounds as loud as before extracting').toBeGreaterThan(0.89);
  expect(after / before).toBeLessThan(1.12);
  // Undo takes back the one extraction: the clip plays its own sound again, at the level it had.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(audioClips(page)).toHaveCount(0);
  const undone = await level();
  expect(undone / before).toBeGreaterThan(0.89);
  expect(undone / before).toBeLessThan(1.12);
});
