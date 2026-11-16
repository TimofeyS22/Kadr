// A value's keys stay in its sheet (regression of the v1.9.12 candidate, found by editor.spec «every video tool works…»):
// a Scale greyed out until a choice is made — Intensity before a filter, there from the start since UI-7 — kept the focus
// it was given and let the arrows through to the editor, which stepped the playhead a frame each behind the sheet. A
// freeze then cut a 0.1 s piece under the transition button, too thin to pick.
import { expect, test } from '@playwright/test';
import { audited, closeTools, importFiles, mainClips, newProject, playhead, selectClip, sheet, tool } from './qa-video-kit';

audited();

test('the arrows of a greyed-out value do nothing behind its sheet; once it is live they move the value, not the playhead', async ({ page }) => {
  test.setTimeout(240_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(mainClips(page)).toHaveCount(1);
  await closeTools(page);
  await selectClip(page, mainClips(page).first()); // the tap puts the playhead where it lands
  const at = await playhead(page);
  await tool(page, 'Filters').click();
  const intensity = sheet(page).getByRole('slider', { name: 'Intensity' });
  await expect(intensity, 'no filter yet: Intensity is greyed out').toHaveAttribute('aria-disabled', 'true');
  await intensity.focus(); // as when the focus stays on it while it greys (a filter taken off)
  await expect(intensity).toBeFocused();
  for (const key of ['ArrowRight', 'ArrowRight', 'End', 'PageUp']) await page.keyboard.press(key);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(await playhead(page), 'the playhead stays where it was').toBe(at);
  // A filter picked: the same keys move the value, and still not the playhead.
  await tool(page, 'Filters').click();
  await sheet(page).getByRole('radio', { name: 'Warm', exact: true }).click();
  await expect(intensity).not.toHaveAttribute('aria-disabled', 'true');
  const before = Number(await intensity.getAttribute('aria-valuenow'));
  await intensity.focus();
  await page.keyboard.press('ArrowLeft');
  await expect.poll(async () => Number(await intensity.getAttribute('aria-valuenow'))).toBeLessThan(before);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toHaveCount(0);
  expect(await playhead(page)).toBe(at);
});
