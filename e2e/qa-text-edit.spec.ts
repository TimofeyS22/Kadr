// Moving, sizing and pinching text and stickers (QA matrix Q-17, Q-20 — docs/11 §3.1, §3.3–3.5): each gesture is one
// undo step back to exactly where it was, redo replays it, a reload keeps it, the file shows it where the preview does,
// and a pinch stops at its limits. The older pinch test ran on Chromium only (multi-touch through DevTools); here two
// fingers are two pointers dispatched in the page, on both engines — not a real finger (that is in the L5 queue).
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

/** Two pointers pinch on the preview from `d0` to `d1` px apart (each from the middle), over the selected layer. */
async function pinch(page: Page, d0: number, d1: number) {
  const b = (await page.locator('.sel-box').boundingBox())!;
  await page.locator('.preview').evaluate((el, [d0, d1, cx, cy]) => {
    const ev = (type: string, id: number, x: number) => el.dispatchEvent(new PointerEvent(type, { pointerId: id, pointerType: 'touch', isPrimary: id === 1, clientX: x, clientY: cy, bubbles: true, cancelable: true }));
    ev('pointerdown', 11, cx - d0); ev('pointerdown', 12, cx + d0);
    for (let k = 1; k <= 10; k++) { const d = d0 + ((d1 - d0) * k) / 10; ev('pointermove', 11, cx - d); ev('pointermove', 12, cx + d); }
    ev('pointerup', 11, cx - d1); ev('pointerup', 12, cx + d1);
  }, [d0, d1, b.x + b.width / 2, b.y + b.height / 2]);
}

test('a sticker pinched with two fingers grows, stops at its limits, undoes in one step, and the file shows it as the preview does (Q-20)', async ({ page }, info) => {
  test.setTimeout(240_000);
  // Pointers made in the page have no capture to take: the app's capture call must not throw on them.
  await page.addInitScript(() => {
    for (const k of ['setPointerCapture', 'releasePointerCapture'] as const) {
      const own = Element.prototype[k];
      Element.prototype[k] = function (this: Element, id: number) { try { own.call(this, id); } catch { /* a pointer made by the test */ } };
    }
  });
  await newProject(page);
  await page.getByRole('button', { name: 'Stickers' }).click();
  await page.getByRole('button', { name: 'Add 🔥' }).click();
  await expect(page.locator('.sel-box')).toBeVisible();
  const done = page.getByRole('button', { name: 'Done' });
  if (await done.isVisible()) await done.click();
  await expect.poll(async () => !!(await layer(page)), { timeout: 20_000 }).toBe(true); // saved
  const start = tf(await layer(page));
  await pinch(page, 20, 60);
  const grown = await savedAfter(page, start);
  expect(grown!.scale / start!.scale, 'three times as far apart: three times as big').toBeGreaterThan(2.5);
  // One undo: back to exactly where it was; redo: the pinch again. (Gestures of one layer within 1.2 s are one step,
  // store.ts COALESCE_MS: each group here waits that out.)
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Undo' }).click();
  await savedAs(page, start);
  await page.getByRole('button', { name: 'Redo' }).click();
  await savedAs(page, grown);
  // Its limits: never under 5%, never over 10×.
  await page.waitForTimeout(1300);
  for (let i = 0; i < 4; i++) await pinch(page, 80, 4);
  await expect.poll(async () => tf(await layer(page))!.scale, { timeout: 20_000 }).toBeLessThan(grown!.scale);
  expect(tf(await layer(page))!.scale, 'the smallest a sticker gets').toBeGreaterThanOrEqual(0.05);
  await page.waitForTimeout(1300);
  for (let i = 0; i < 6; i++) await pinch(page, 4, 120);
  await expect.poll(async () => tf(await layer(page))!.scale, { timeout: 20_000 }).toBeGreaterThan(grown!.scale);
  expect(tf(await layer(page))!.scale, 'the biggest a sticker gets').toBeLessThanOrEqual(10);
  // Back to the grown one (the two groups are two steps), then the file: the sticker where and as big as the preview shows it.
  await page.waitForTimeout(1300);
  await page.getByRole('button', { name: 'Undo' }).click();
  await page.getByRole('button', { name: 'Undo' }).click();
  await savedAs(page, grown);
  const t = 1.0;
  const preview = rgbOf(await previewAt(page, info, t));
  const photo = rgbOf(await exportAs(page, info, 'Photo'));
  const [mean, block] = [meanAbsDiff(preview, photo), worstBlock(preview, photo)];
  note(info, 'frame.txt', `mean ${mean.toFixed(2)}, worst block ${block.toFixed(1)}`);
  expect(mean, 'the photo is the preview').toBeLessThan(3);
  expect(block, 'the sticker in the same place and size').toBeLessThan(40);
});

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
