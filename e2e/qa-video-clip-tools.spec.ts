// QA matrix Q-10 (docs/21 lane C): clip tools — speed, freeze, reverse, volume, extract audio — by docs/11 §3.
// Points 1–4 are in editor.spec.ts («every video tool works…», «clip tools reach the file frame for frame…», «history and
// persistence across tools», «extreme speeds, 10× and 0.1×»). This file holds point 5, the edges, which the matrix had as ✗.
import { expect, test, type Page } from '@playwright/test';
import {
  audited, closeTools, doneSheet, exportAs, exportVideo, expectToast, importFiles, mainClips, newProject, pcmOf, probe, rmsOf, selectClip,
  setSpeedPreset, tool,
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

test('a video with no sound at 2×, with noise reduction on: no error, and the export makes the file — no sound to prepare (SW-C-4)', async ({ page }, info) => {
  test.setTimeout(600_000);
  const main = mainClips(page);
  await newProject(page);
  await importFiles(page, 'Media', ['walk.mp4', 'landscape.mp4']); // walk: 5 s, no sound; landscape: 6 s with a tone
  await expect(main).toHaveCount(2);
  await selectClip(page, main.nth(0));
  await setSpeedPreset(page, '2×'); // natural pitch is on by default: the sheet would make a pitch-kept sound
  await selectClip(page, main.nth(0));
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Reduce background noise' }).check();
  await doneSheet(page);
  await closeTools(page);
  // The audit (afterEach) fails on any error toast; the file is whole: 2.5 s of walk at 2× and the 6 s with its tone.
  const file = await exportVideo(page, info);
  const p = probe(file);
  expect(Math.abs(Number(p.format.duration) - 8.5)).toBeLessThan(0.05);
  expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  const x = pcmOf(file);
  expect(rmsOf(x, 8000 * 3, 8000 * 8), 'the tone of the second clip is in the file').toBeGreaterThan(0.05);
});
