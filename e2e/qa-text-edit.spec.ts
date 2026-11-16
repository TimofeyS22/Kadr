// Moving and sizing text by hand (QA matrix Q-17 — docs/11 §3.1, §3.3–3.4): each gesture is one undo step back to
// exactly where it was, redo replays it, a reload keeps it, the file shows it where the preview does.
import { expect, test, type Page } from '@playwright/test';
import { audits, exportAs, meanAbsDiff, newProject, note, previewAt, rgbOf, storedProject, worstBlock } from './qa-platform-kit';
import type { Project, TextClip } from '../src/core/types';

audits();

const layer = async (page: Page) => {
  const p = await storedProject<Project>(page);
  return p.tracks.flatMap((t) => t.clips).find((c) => c.kind === 'text') as TextClip | undefined;
};
const tf = (c: TextClip | undefined) => (c ? { x: c.transform.x.v, y: c.transform.y.v, scale: c.transform.scale.v, rotation: c.transform.rotation.v } : null);
/** The stored transform, once the save after an edit has landed (it differs from `before`). */
async function savedAfter(page: Page, before: ReturnType<typeof tf>) {
  await expect.poll(async () => JSON.stringify(tf(await layer(page))), { timeout: 20_000 }).not.toBe(JSON.stringify(before));
  return tf(await layer(page));
}
async function savedAs(page: Page, want: ReturnType<typeof tf>) {
  await expect.poll(async () => JSON.stringify(tf(await layer(page))), { timeout: 20_000 }).toBe(JSON.stringify(want));
}

test('text moved and sized by hand: one undo step each, redo, a reload keeps it, and the file shows it where the preview does (Q-17)', async ({ page }, info) => {
  test.setTimeout(240_000);
  await newProject(page);
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill('Кадр 2026');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.sel-box')).toBeVisible();
  await expect.poll(async () => (await layer(page))?.text, { timeout: 20_000 }).toBe('Кадр 2026'); // saved
  const start = tf(await layer(page));
  // Move: drag the text by 60, 120 px.
  const b = (await page.locator('.sel-box').boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 60, b.y + b.height / 2 + 120, { steps: 10 });
  await page.mouse.up();
  const moved = await savedAfter(page, start);
  expect(moved!.y, 'lower in the frame').toBeGreaterThan(start!.y);
  // Size: the corner handle, out.
  const h = (await page.locator('.sel-handle').boundingBox())!;
  await page.mouse.move(h.x + h.width / 2, h.y + h.height / 2);
  await page.mouse.down();
  await page.mouse.move(h.x + h.width / 2 + 50, h.y + h.height / 2 + 25, { steps: 8 });
  await page.mouse.up();
  const sized = await savedAfter(page, moved);
  expect(sized!.scale, 'bigger').toBeGreaterThan(moved!.scale);
  // Undo twice: sized → moved → start, each exactly; redo twice back.
  await page.getByRole('button', { name: 'Undo' }).click();
  await savedAs(page, moved);
  await page.getByRole('button', { name: 'Undo' }).click();
  await savedAs(page, start);
  await page.getByRole('button', { name: 'Redo' }).click();
  await savedAs(page, moved);
  await page.getByRole('button', { name: 'Redo' }).click();
  await savedAs(page, sized);
  await page.reload();
  await expect(page.locator('.clip-text')).toHaveCount(1, { timeout: 30_000 });
  expect(tf(await layer(page)), 'after a reload').toEqual(sized);
  // The file shows the text where the preview does (past its entrance).
  const preview = rgbOf(await previewAt(page, info, 1.0));
  const photo = rgbOf(await exportAs(page, info, 'Photo'));
  const [mean, block] = [meanAbsDiff(preview, photo), worstBlock(preview, photo)];
  note(info, 'frame.txt', `mean ${mean.toFixed(2)}, worst block ${block.toFixed(1)}`);
  expect(mean).toBeLessThan(3);
  expect(block, 'the text in the same place and size').toBeLessThan(40);
});
