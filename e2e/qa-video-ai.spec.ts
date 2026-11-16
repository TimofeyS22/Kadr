// QA matrix Q-13 (background removal) and Q-14 (hide faces, auto reframe), docs/21 lane C — point 5 of docs/11 §3, the
// ends the matrix had as ✗. Points 1–4 are editor.spec.ts («background removal…», «hide faces…», «auto reframe…», WYSIWYG
// «look tools» and «in motion», «history and persistence, look and AI tools»); the engines are lane B's (segment, faces,
// reframe): a defect found here goes there.
import { expect, test } from '@playwright/test';
import {
  audited, closeTools, exportPhoto, expectSameFrames, importFiles, mainClips, meanAbsDiff, newProject, rgbAt, scrubTo, selectClip,
  setSpeedPreset, sheet, tool, toastsSeen, valueToEnd,
} from './qa-video-kit';

audited();

test('Cutout at its ends: on a video sped up 2×, on an overlay over another clip, tapped twice to give the picture back exactly — the preview, the photo and the video frame match (Q-13)', async ({ page }, info) => {
  test.setTimeout(900_000);
  const clips = mainClips(page), overlay = page.locator('.tl-row.overlay .clip').first();
  const cutout = tool(page, 'Cutout');
  /** Cutout on, waited for as the button and the toasts say it (a failure shows what was said). */
  const cutoutOn = async () => {
    await cutout.click();
    await expect.poll(async () => `${await cutout.getAttribute('aria-pressed')} ${(await toastsSeen(page)).join(' | ')}`, { timeout: 120_000 }).toMatch(/^true/);
  };
  await newProject(page);
  await importFiles(page, 'Media', ['walk.mp4', 'landscape.mp4', 'photo.png']); // 0–5, 5–11, 11–14 s
  await expect(clips).toHaveCount(3);
  // 1 walk at 2× (0–2.5 s), then cut out.
  await selectClip(page, clips.nth(0));
  await setSpeedPreset(page, '2×');
  await selectClip(page, clips.nth(0));
  await cutoutOn();
  // 2 a person photo laid over the bars (2.5–8.5 s), cut out: the bars show around them.
  await closeTools(page);
  await scrubTo(page, 4 * 60);
  await importFiles(page, 'Overlay', ['person.jpg']);
  await expect(overlay).toHaveCount(1);
  await selectClip(page, overlay);
  await cutoutOn();
  // A picture with nobody in it: «Cutout on a picture with nobody…» (editor.spec, V-103). A fractal read as a person — SW-C-6.
  await closeTools(page);
  const at = await clips.evaluateAll((els) => els.map((e) => ((e as HTMLElement).offsetLeft - (els[0] as HTMLElement).offsetLeft + (e as HTMLElement).offsetWidth / 2) / 60));
  const overlayMid = await overlay.evaluate((e, x0) => (e.getBoundingClientRect().left - x0 + e.getBoundingClientRect().width / 2) / 60, (await clips.first().boundingBox())!.x);
  await expectSameFrames(page, info, 'WYSIWYG cutout ends', [
    { name: 'walk 2×, cut out', t: at[0] },
    { name: 'person over the bars, cut out', t: overlayMid },
  ], 0.8);
  // Twice on the same overlay: the cutout comes off and the picture is what it was before it.
  await scrubTo(page, Math.round(overlayMid * 60));
  const cutPhoto = rgbAt(await exportPhoto(page, info));
  await selectClip(page, overlay);
  await cutout.click();
  await expect(cutout).toHaveAttribute('aria-pressed', 'false');
  await closeTools(page);
  const plain = rgbAt(await exportPhoto(page, info));
  await selectClip(page, overlay);
  await cutoutOn();
  await closeTools(page);
  const again = rgbAt(await exportPhoto(page, info));
  console.log(`cutout twice (${info.project.name}): cut vs plain ${meanAbsDiff(cutPhoto, plain).toFixed(2)}, cut again vs cut ${meanAbsDiff(cutPhoto, again).toFixed(2)}`);
  expect(meanAbsDiff(cutPhoto, plain), 'the cutout came off').toBeGreaterThan(5);
  expect(meanAbsDiff(cutPhoto, again), 'and on again, the same picture').toBeLessThan(1);
});

test('Hide faces and Auto reframe at their ends: no face in the picture changes nothing, an area as big as the frame in its corner, a reframe of a shot with nobody says so — the preview, the photo and the video frame match (Q-14)', async ({ page }, info) => {
  test.setTimeout(900_000);
  const clips = mainClips(page);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'person.jpg']); // bars 0–6 s (no face, nobody), person 6–9 s
  await expect(clips).toHaveCount(2);
  await closeTools(page);
  // 1 no face: automatic hiding on, the picture is the same.
  await scrubTo(page, 180);
  const before = rgbAt(await exportPhoto(page, info));
  await selectClip(page, clips.nth(0));
  await tool(page, 'Hide faces').click();
  await page.getByRole('switch', { name: 'Hide faces automatically' }).click();
  await expect(page.getByRole('switch', { name: 'Hide faces automatically' })).toBeChecked({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await closeTools(page);
  await scrubTo(page, 180);
  const after = rgbAt(await exportPhoto(page, info));
  expect(meanAbsDiff(before, after), 'nothing to hide: nothing hidden').toBeLessThan(0.5);
  // 2 the person: an area pixelated, as wide and tall as it goes, pushed into the top left corner.
  await selectClip(page, clips.nth(1));
  await tool(page, 'Hide faces').click();
  await page.getByRole('radio', { name: 'Pixelate' }).click();
  await page.getByRole('button', { name: 'Add area' }).click();
  await valueToEnd(page, 'Width', 'End');
  await valueToEnd(page, 'Height', 'End');
  await valueToEnd(page, 'Position X', 'Home');
  await valueToEnd(page, 'Position Y', 'Home');
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(sheet(page)).toHaveCount(0);
  // 3 the bars have nobody to follow: Auto reframe says so and changes nothing.
  await selectClip(page, clips.nth(0));
  await tool(page, 'Auto reframe').click();
  await expect.poll(async () => (await toastsSeen(page)).some((x) => /No person found|Reframed/.test(x)), { timeout: 180_000 }).toBe(true);
  const said = await toastsSeen(page);
  console.log(`reframe with nobody (${info.project.name}): ${said.join(' | ')}`);
  expect(said.some((x) => x.includes('No person found in this clip')), 'a shot with nobody is not reframed').toBe(true);
  await closeTools(page);
  await expectSameFrames(page, info, 'WYSIWYG hide faces ends', [
    { name: 'bars: hiding on, no face; reframe with nobody', t: 3, maxCast: 2 }, // a bright full frame (see qa-video-look)
    { name: 'person: a frame-sized area in the corner', t: 7.5, maxCast: 2 }, // the white of the photo: a bright frame
  ], 0.8);
});
