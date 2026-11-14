// QA matrix Q-8 (docs/21 lane C): multi-select, delete, duplicate — by the 15 points of docs/11 §3.
// Points 3–4 (one undo step, reload) are editor.spec.ts «history and persistence, capture and selection»; the timeline
// fuzz (src/core/fuzz-timeline.test.ts) covers the group operations on random projects (L1).
import { expect, test } from '@playwright/test';
import {
  audited, closeTools, counterAt, durationOf, exportPhoto, exportVideo, importFiles, mainClips, newProject, previewAt, probe,
  expectToast, scrubTo, selectClip, setSpeedPreset, tool,
} from './qa-video-kit';

audited();

test('multi-select reaches the file: a picked pair duplicated, another pair deleted — the video, the photo and the preview show the expected source frames (Q-8)', async ({ page }, info) => {
  test.setTimeout(420_000);
  const main = mainClips(page), picked = page.locator('.clip.picked');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4', 'counter.mp4']); // A, B: 6 s each, frame N written in binary
  await expect(main).toHaveCount(2);
  // A at 2× (0–3 s), B reversed (3–9 s): the copies must carry both.
  await selectClip(page, main.nth(0));
  await setSpeedPreset(page, '2×');
  await selectClip(page, main.nth(1));
  await tool(page, 'Reverse').click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 90_000 });
  // Pick A and B, duplicate: A B A' B'; the copies are picked.
  await selectClip(page, main.nth(0));
  await tool(page, 'Select several').click();
  await main.nth(1).click();
  await expect(page.getByRole('status').filter({ hasText: '2 selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Duplicate', exact: true }).click();
  await expect(main).toHaveCount(4);
  await expect(picked).toHaveCount(2);
  await expect(main.nth(2)).toHaveClass(/picked/);
  await expect(main.nth(3)).toHaveClass(/picked/);
  // Pick B and A' instead (a tap on a picked clip unpicks it), delete both in one go: A B'.
  await main.nth(3).click();
  await main.nth(1).click();
  await expect(main.nth(1)).toHaveClass(/picked/);
  await expect(main.nth(2)).toHaveClass(/picked/);
  await expect(page.getByRole('status').filter({ hasText: '2 selected' })).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(main).toHaveCount(2);
  await page.getByRole('button', { name: 'Finish selecting' }).click();
  await closeTools(page);
  const source = (t: number) => {
    const f = Math.floor(t * 30 + 1e-6);
    return t < 3 ? Math.floor(t * 2 * 30 + 1e-6) : 179 - (f - 90); // A twice as fast, then B' backwards
  };
  const video = await exportVideo(page, info);
  const p = probe(video);
  const rows = [`duration ${Number(p.format.duration).toFixed(3)} s, streams ${p.streams.map((s) => s.codec_type).join('+')}`];
  expect(Math.abs(Number(p.format.duration) - 9)).toBeLessThan(0.05);
  expect(p.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  for (const k of [0, 45, 89, 90, 91, 180, 269]) {
    const got = counterAt(video, k);
    rows.push(`frame ${k}: video ${got} (expected ${source(k / 30)})`);
    expect.soft(got, `video frame ${k}`).toBe(source(k / 30));
  }
  for (const k of [45, 91, 200]) {
    const t = (k + 0.5) / 30; // mid-frame: the playhead moves 2 px per frame
    const shown = counterAt(await previewAt(page, info, t));
    const photo = counterAt(await exportPhoto(page, info));
    rows.push(`frame ${k}½: preview ${shown}, photo ${photo} (expected ${source(t)})`);
    expect.soft(shown, `preview at frame ${k}½`).toBe(source(t));
    expect.soft(photo, `photo at frame ${k}½`).toBe(source(t));
  }
  console.log(`multi-select frame for frame (${info.project.name}):\n${rows.join('\n')}`);
});

test('multi-select edges: every clip picked and deleted leaves an empty project with Export off and comes back in one undo; picks undone away are not acted on; main-track clips stay put on "To playhead" (Q-8)', async ({ page }, info) => {
  test.setTimeout(420_000);
  const main = mainClips(page), text = page.locator('.clip-text'), status = page.getByRole('status').filter({ hasText: /selected/ });
  const del = page.getByRole('button', { name: 'Delete', exact: true }), dup = page.getByRole('button', { name: 'Duplicate', exact: true });
  const exportButton = page.getByRole('button', { name: 'Export' }).first();
  await page.setViewportSize({ width: 375, height: 812 }); // docs/11 §3.9: the smallest phone width
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4', 'photo.png']);
  await expect(main).toHaveCount(2);
  await closeTools(page);
  await tool(page, 'Text').click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(text).toHaveCount(1);
  // Everything on every track, picked and deleted.
  await selectClip(page, main.nth(0));
  await tool(page, 'Select several').click();
  await main.nth(1).click();
  await text.click();
  await expect(status).toHaveText(/3 selected/);
  // At 375 px the selection's row fits: no sideways scroll, every button of it at least 44 px and named.
  expect(await page.evaluate(() => document.documentElement.scrollWidth), 'no sideways scroll').toBeLessThanOrEqual(375);
  for (const b of [del, dup, page.getByRole('button', { name: 'To playhead', exact: true }), page.getByRole('button', { name: 'Finish selecting' })]) {
    const box = (await b.boundingBox())!;
    expect(Math.min(box.width, box.height), `${await b.getAttribute('aria-label') ?? await b.textContent()}: a 44 px target`).toBeGreaterThanOrEqual(44);
    expect(box.x + box.width, 'inside the screen').toBeLessThanOrEqual(375.5);
  }
  await del.click();
  await expect(main).toHaveCount(0);
  await expect(text).toHaveCount(0);
  await expect(status).toHaveText(/0 selected/);
  await expect(del, 'nothing left to delete').toBeDisabled();
  await expect(dup).toBeDisabled();
  await page.getByRole('button', { name: 'Finish selecting' }).click();
  await expect(exportButton, 'an empty timeline has nothing to export').toBeDisabled();
  // One undo brings all three back, and the project exports as before.
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(2);
  await expect(text).toHaveCount(1);
  await expect(exportButton).toBeEnabled();
  // Copies made, then undone while still picked: the selection counts only what exists, and its buttons are off.
  await selectClip(page, main.nth(1));
  await tool(page, 'Select several').click();
  await text.click();
  await dup.click();
  await expect(main).toHaveCount(3);
  await expect(text).toHaveCount(2);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(2);
  await expect(text).toHaveCount(1);
  await expect(status).toHaveText(/0 selected/);
  await expect(del).toBeDisabled();
  await expect(dup).toBeDisabled();
  // "To playhead" with only main-track clips picked: they keep their order and the sheet says why.
  await main.nth(0).click();
  await expect(status).toHaveText(/1 selected/);
  const before = await main.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetLeft));
  await scrubTo(page, 240);
  await page.getByRole('button', { name: 'To playhead', exact: true }).click();
  await expectToast(page, 'Main-track clips keep their order');
  expect(await main.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetLeft))).toEqual(before);
  await page.getByRole('button', { name: 'Finish selecting' }).click();
  // The project is whole: 6 s video + 3 s photo, a working file.
  expect(Math.abs(durationOf(await exportVideo(page, info)) - 9)).toBeLessThan(0.05);
});
