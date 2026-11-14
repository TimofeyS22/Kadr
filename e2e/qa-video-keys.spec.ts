// QA matrix Q-12 (docs/21 lane C): keyframes, chroma key, mask — by docs/11 §3. Points 1–4 are editor.spec.ts («keyframes,
// chroma key and a mask…», WYSIWYG «look tools» and «in motion», «history and persistence, look and AI tools»); this file
// holds point 5, the ends the matrix had as ✗: keys carried through a cut and a speed change, the key and the mask at
// their strongest and softest.
import { expect, test, type Page } from '@playwright/test';
import {
  audited, closeTools, expectSameFrames, importFiles, mainClips, newProject, scrubTo, selectClip, setSpeedPreset, sheet, tool, valueOf, valueToEnd,
} from './qa-video-kit';

audited();

/** Transform: a key for `name` at the playhead (`t` s), then, `later` s on, the value moved `steps` key presses. */
async function keyed(page: Page, k: number, name: string, t: number, later: number, steps: number) {
  const clip = mainClips(page).nth(k);
  await selectClip(page, clip);
  await scrubTo(page, Math.round(t * 60));
  await tool(page, 'Transform').click();
  await valueOf(page, name); // the sheet's tab of this value, where its ◆ is
  await page.getByRole('button', { name: `Add ${name} keyframe` }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await scrubTo(page, Math.round((t + later) * 60));
  await selectClip(page, clip);
  await tool(page, 'Transform').click();
  const s = await valueOf(page, name);
  await s.focus();
  for (let i = 0; i < steps; i++) await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: 'Done' }).click();
}

test('keyframes, chroma key and mask at their ends: keys carried through a cut and a 2× speed, the key at full strength and softness, an inverted mask with the softest edge — the preview, the photo and the video frame match (Q-12)', async ({ page }, info) => {
  test.setTimeout(900_000);
  const clips = mainClips(page);
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png', 'walk.mp4', 'person.jpg', 'landscape.mp4']); // 0–3, 3–8, 8–11, 11–17 s
  await expect(clips).toHaveCount(4);
  // 1 photo: Position X keyed at 0.5 s and 2.5 s, then the first second cut away (the keys move with the picture).
  await keyed(page, 0, 'Position X', 0.5, 2, 15);
  await selectClip(page, clips.nth(0));
  await scrubTo(page, 60, '0:01.0');
  await tool(page, 'Split').click();
  await expect(clips).toHaveCount(5);
  await selectClip(page, clips.nth(0));
  await tool(page, 'Delete').click();
  await expect(clips).toHaveCount(4); // photo 0–2, walk 2–7, person 7–10, bars 10–16
  // 2 walk: Scale keyed at 0.5 s and 4.5 s into it, then 2× (the keys at 0.25 s and 2.25 s: walk 2–4.5).
  await keyed(page, 1, 'Scale', 2.5, 4, 20);
  await selectClip(page, clips.nth(1));
  await setSpeedPreset(page, '2×');
  // 3 person: the green key at full strength and full softness (most of the picture goes).
  await selectClip(page, clips.nth(2));
  await tool(page, 'Chroma key').click();
  await page.getByRole('switch', { name: 'Remove color (green screen)' }).check();
  await valueToEnd(page, 'Strength', 'End');
  await valueToEnd(page, 'Softness', 'End');
  await page.getByRole('button', { name: 'Done' }).click();
  // 4 bars: an inverted rectangle with the softest edge, turned as far as it goes.
  await selectClip(page, clips.nth(3));
  await tool(page, 'Mask').click();
  await sheet(page).getByRole('radio', { name: 'Rectangle' }).click();
  await valueToEnd(page, 'Soft edge', 'End');
  await valueToEnd(page, 'Rotation', 'End');
  await page.getByRole('switch', { name: 'Invert (keep the outside)' }).check();
  await page.getByRole('button', { name: 'Done' }).click();
  await closeTools(page);
  const middles = await clips.evaluateAll((els) => els.map((e) => ((e as HTMLElement).offsetLeft - (els[0] as HTMLElement).offsetLeft + (e as HTMLElement).offsetWidth / 2) / 60));
  await expectSameFrames(page, info, 'WYSIWYG keys, key and mask ends', [
    { name: 'photo: between keys after the cut', t: middles[0] },
    { name: 'walk: between keys after 2×', t: middles[1] },
    { name: 'person: key at full strength and softness', t: middles[2] },
    { name: 'bars: inverted soft rectangle', t: middles[3] },
  ], 0.8);
});
