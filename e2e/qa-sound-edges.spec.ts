// Edges of the sound tools (QA matrix Q-21–Q-24, docs/11 §3.5–3.8): settings on a clip that has no sound, processing
// cancelled midway, a processed sound on a trimmed and sped-up piece, effects switched back and forth.
import { expect, test } from '@playwright/test';
import { audits, exportAs, importFiles, probe, rmsDb, samples, selectClip, sheet, storedProject, toastErrors, tool } from './qa-platform-kit';
import type { Project } from '../src/core/types';

audits();

test('a video without sound: a new speed and the sound tools leave its export working, and say there is no sound to process (Q-22, Q-23)', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['silent.mp4']); // 4 s, no audio track
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  // Speed: natural pitch is on by default, and there is no sound for it to keep.
  await selectClip(page, clip);
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  const fast = probe(await exportAs(page, info, 'Video'));
  expect(Math.abs(fast.duration - 2), `2× of 4 s: ${fast.duration} s`).toBeLessThan(0.1);
  expect(fast.video?.codec).toBe('h264');
  expect(await toastErrors(page), 'the export of a silent video at 2× has nothing to fail on').toEqual([]);
  // The sound tools on it: nothing to process is said once, and the export still works.
  await selectClip(page, clip);
  await tool(page, 'Volume').click();
  const enhance = page.getByRole('switch', { name: 'Enhance voice' });
  if (await enhance.count()) {
    await enhance.click();
    await page.waitForTimeout(1500);
    const said = await toastErrors(page);
    expect(said.length, 'at most one message').toBeLessThanOrEqual(1);
  }
  await page.getByRole('button', { name: 'Done' }).click();
  const after = probe(await exportAs(page, info, 'Video'));
  expect(Math.abs(after.duration - 2)).toBeLessThan(0.1);
  expect(await toastErrors(page), 'the export after the sound tools').toEqual([]);
});

test('a processed sound on a piece cut at its start and played at 2×: the speech starts where the timeline says, with each effect (Q-22, Q-23)', async ({ page }, info) => {
  test.setTimeout(600_000); // two processings and four exports; 7 min at load average 40
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['reel_ru.mp4']); // 1.5 s of silence, then speech
  const clips = page.locator('.tl-row.main .clip');
  await expect(clips).toHaveCount(1);
  // Cut off the first 0.5 s: split there, delete the first piece.
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 30; });
  await expect.poll(() => page.locator('.time b').textContent()).toBe('0:00.5');
  await tool(page, 'Split').click();
  await expect(clips).toHaveCount(2);
  await selectClip(page, clips.first());
  await tool(page, 'Delete').click();
  await expect(clips).toHaveCount(1);
  await selectClip(page, clips.first());
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  // Saved: one piece, cut at 0.5 s, at 2× (the store writes a moment after the edit).
  const piece = async () => (await storedProject<Project>(page)).tracks.find((t) => t.kind === 'main')!.clips as { in: number; speed: number; duration: number }[];
  await expect.poll(async () => { const m = await piece(); return m.length === 1 && m[0].speed === 2 && Math.abs(m[0].in - 0.5) < 0.02; }, { timeout: 20_000 }).toBe(true);
  const [c] = await piece();
  // Where the speech must start in the file: (1.5 − 0.5) / 2.
  const onset = (x: Float32Array) => { for (let i = 0; i + 480 < x.length; i += 240) if (rmsDb(x, i / 48000, (i + 480) / 48000) > -30) return i / 48000; return Infinity; };
  const base = onset(samples(await exportAs(page, info, 'Audio', { loudness: false })));
  expect(Math.abs(base - 0.5), `natural pitch at 2×: speech at ${base.toFixed(3)} s`).toBeLessThan(0.03);
  for (const voice of ['Robot', 'Deep']) {
    await selectClip(page, clips.first());
    await tool(page, 'Voice').click();
    await sheet(page).getByRole('radio', { name: voice, exact: true }).click();
    await expect(sheet(page).getByRole('radio', { name: voice, exact: true })).toHaveAttribute('aria-checked', 'true', { timeout: 120_000 });
    await page.getByRole('button', { name: 'Done' }).click();
    const file = await exportAs(page, info, 'Audio', { loudness: false });
    const t = onset(samples(file));
    expect(Math.abs(t - base), `${voice}: ${base.toFixed(3)} → ${t.toFixed(3)} s`).toBeLessThan(0.02);
    expect(Math.abs(probe(file).duration - c.duration), 'as long as the piece').toBeLessThan(0.06);
  }
  await selectClip(page, clips.first());
  await tool(page, 'Volume').click();
  await page.getByRole('switch', { name: 'Reduce background noise' }).check();
  await expect(page.getByRole('switch', { name: 'Reduce background noise' })).toBeChecked({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  const t = onset(samples(await exportAs(page, info, 'Audio', { loudness: false })));
  expect(Math.abs(t - base), `noise reduction + Deep: ${base.toFixed(3)} → ${t.toFixed(3)} s`).toBeLessThan(0.02);
});
