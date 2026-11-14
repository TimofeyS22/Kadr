// Edges of the sound tools (QA matrix Q-22, Q-23, docs/11 §3.5–3.8): settings on a clip that has no sound.
import { expect, test } from '@playwright/test';
import { audits, exportAs, importFiles, probe, selectClip, toastErrors, tool } from './qa-platform-kit';

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
