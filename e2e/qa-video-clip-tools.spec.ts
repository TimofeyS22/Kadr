// QA matrix Q-10 (docs/21 lane C): clip tools — speed, freeze, reverse, volume, extract audio — by docs/11 §3.
// Points 1–4 are in editor.spec.ts («every video tool works…», «clip tools reach the file frame for frame…», «history and
// persistence across tools», «extreme speeds, 10× and 0.1×»). This file holds point 5, the edges, which the matrix had as ✗.
import { expect, test, type Page } from '@playwright/test';
import {
  audited, closeTools, counterAt, durationOf, exportAs, exportVideo, importFiles, mainClips, newProject, pcmOf, probe, rmsOf,
  doneSheet, scrubTo, selectClip, setSpeedPreset, settledProject, tool, toastsSeen, expectToast, playhead, valueToEnd,
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
  await expectToast(page, 'The sound of this clip is off or already on its own track'); // said, not silently ignored
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

test('Freeze at the very first and the very last frame of a clip: the still shows that frame, nothing is cut away, the file is 4 s longer (Q-10)', async ({ page }, info) => {
  test.setTimeout(420_000);
  const main = mainClips(page);
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']); // 6 s at 30 fps, frame N in binary
  await expect(main).toHaveCount(1);
  await selectClip(page, main.first());
  await scrubTo(page, 0, '0:00.0');
  await tool(page, 'Freeze').click();
  await expect(main).toHaveCount(2, { timeout: 30_000 });
  // The clip now runs 2–8 s; its last frame (source 179) is on screen from 7.967 s.
  await selectClip(page, main.nth(1));
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 478; }); // 7.967 s, the start of frame 239
  await expect.poll(() => playhead(page)).toBeGreaterThan(7.96);
  expect(await playhead(page)).toBeLessThan(8);
  await tool(page, 'Freeze').click();
  await expect(main).toHaveCount(3, { timeout: 30_000 });
  // The video chosen, the playhead over the first still: nothing to freeze there, and the tool says where to stand.
  await selectClip(page, main.nth(1));
  await scrubTo(page, 60, '0:01.0');
  await tool(page, 'Freeze').click();
  await expectToast(page, 'Put the playhead over a video clip');
  await expect(main, 'no still made from a still').toHaveCount(3);
  await closeTools(page);
  const video = await exportVideo(page, info);
  const d = durationOf(video);
  const expected = (k: number) => (k < 60 ? 0 : k < 240 ? k - 60 : 179);
  const rows = [`duration ${d.toFixed(3)} s`];
  expect(Math.abs(d - 10)).toBeLessThan(0.05);
  for (const k of [0, 59, 60, 61, 238, 239, 240, 299]) {
    const got = counterAt(video, k);
    rows.push(`frame ${k}: ${got} (expected ${expected(k)})`);
    expect.soft(got, `video frame ${k}`).toBe(expected(k));
  }
  console.log(`freeze at the edges (${info.project.name}):\n${rows.join('\n')}`);
});

test('Reverse: cancelled midway leaves the clip as it was and can run again; a trimmed 2× clip reversed and reversed back shows its own frames (Q-10)', async ({ page }, info) => {
  test.setTimeout(420_000);
  const main = mainClips(page);
  await newProject(page);
  await importFiles(page, 'Media', ['long_1.mp4']); // 60 s of 1080p: reversing takes long enough to cancel
  await expect(main).toHaveCount(1);
  await selectClip(page, main.first());
  const width = await main.first().evaluate((e) => (e as HTMLElement).offsetWidth);
  const saved = await settledProject(page);
  await tool(page, 'Reverse').click();
  const busy = page.locator('.busy');
  await expect(busy).toBeVisible();
  await page.waitForTimeout(1500);
  const cancelled = Date.now();
  await busy.getByRole('button', { name: 'Cancel' }).click();
  await expect(busy, 'a cancelled reverse ends').toHaveCount(0, { timeout: 120_000 });
  console.log(`reverse cancelled (${info.project.name}): the overlay left ${((Date.now() - cancelled) / 1000).toFixed(1)} s after Cancel`);
  expect(await settledProject(page) === saved, 'a cancelled reverse leaves the project as it was').toBe(true);
  await expect(page.getByRole('button', { name: 'Redo' })).toBeDisabled();
  expect(await main.first().evaluate((e) => (e as HTMLElement).offsetWidth)).toBe(width);
  expect(await toastsSeen(page), 'a cancel is no error and no "changed while" notice').toEqual([]);
  // The same clip trimmed and sped up instead: counter.mp4, start trimmed by 1 s, at 2× (source 1–6 s in 2.5 s).
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4']);
  await expect(main).toHaveCount(1);
  await selectClip(page, main.first());
  await scrubTo(page, 60, '0:01.0');
  await tool(page, 'Split').click();
  await expect(main).toHaveCount(2);
  await selectClip(page, main.first());
  await tool(page, 'Delete').click();
  await expect(main).toHaveCount(1);
  await selectClip(page, main.first());
  await setSpeedPreset(page, '2×');
  await selectClip(page, main.first());
  await tool(page, 'Reverse').click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90_000 });
  expect((await toastsSeen(page)).filter((x) => x.includes('changed while'))).toEqual([]);
  await closeTools(page);
  const backwards = await exportVideo(page, info);
  const rows = [`reversed: ${durationOf(backwards).toFixed(3)} s`];
  expect(Math.abs(durationOf(backwards) - 2.5)).toBeLessThan(0.05);
  // Timeline frame k shows source 30 + 2k forwards, so 179 - 2k backwards (the last source frame first).
  for (const k of [0, 1, 37, 74]) {
    const got = counterAt(backwards, k);
    rows.push(`frame ${k}: ${got} (expected ${179 - 2 * k} ±1)`);
    expect.soft(Math.abs(got - (179 - 2 * k)), `reversed frame ${k}`).toBeLessThanOrEqual(1);
  }
  await selectClip(page, main.first());
  await tool(page, 'Reverse').click(); // back to the forward video
  await expectToast(page, 'Playing forward again');
  await closeTools(page);
  const forwards = await exportVideo(page, info);
  expect(Math.abs(durationOf(forwards) - 2.5)).toBeLessThan(0.05);
  for (const k of [0, 1, 37, 74]) {
    const got = counterAt(forwards, k);
    rows.push(`forward again, frame ${k}: ${got} (expected ${30 + 2 * k})`);
    expect.soft(got, `forward frame ${k}`).toBe(30 + 2 * k);
  }
  console.log(`reverse edges (${info.project.name}):\n${rows.join('\n')}`);
});

test('Volume at its ends: 0 gives a file with a silent sound track, 200% twice the level without clipping; Mute is silent too (Q-10)', async ({ page }, info) => {
  test.setTimeout(420_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']); // a sine at 1/8 of full scale
  await expect(mainClips(page)).toHaveCount(1);
  await closeTools(page);
  const sound = async () => {
    const file = await exportVideo(page, info);
    expect(probe(file).streams.map((s) => s.codec_type).sort(), 'the file keeps its sound track').toEqual(['audio', 'video']);
    const x = pcmOf(file);
    return { rms: rmsOf(x, 8000, 40000), peak: x.reduce((m, v) => Math.max(m, Math.abs(v)), 0) };
  };
  const base = await sound();
  const setVolume = async (key: 'Home' | 'End') => {
    await selectClip(page, mainClips(page).first());
    await tool(page, 'Volume').click();
    const v = await valueToEnd(page, 'Volume', key);
    await page.getByRole('button', { name: 'Done' }).click();
    await closeTools(page);
    return v;
  };
  expect(await setVolume('Home')).toBe(0);
  const zero = await sound();
  expect(await setVolume('End')).toBe(2);
  const loud = await sound();
  await selectClip(page, mainClips(page).first());
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Mute' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await closeTools(page);
  const muted = await sound();
  console.log(`volume ends (${info.project.name}): 100% rms ${base.rms.toFixed(4)} peak ${base.peak.toFixed(3)}; 0% rms ${zero.rms.toFixed(5)}; 200% rms ${loud.rms.toFixed(4)} peak ${loud.peak.toFixed(3)}; muted rms ${muted.rms.toFixed(5)}`);
  expect(zero.rms, 'volume 0 is silent').toBeLessThan(0.002);
  expect(muted.rms, 'mute is silent').toBeLessThan(0.002);
  expect(loud.rms / base.rms, '200% is twice the level').toBeGreaterThan(1.8);
  expect(loud.rms / base.rms).toBeLessThan(2.2);
  expect(loud.peak, 'and not clipped').toBeLessThan(1);
});
