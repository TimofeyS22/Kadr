// QA matrix Q-13 (background removal) and Q-14 (hide faces, auto reframe), docs/21 lane C — point 5 of docs/11 §3, the
// ends the matrix had as ✗. Points 1–4 are editor.spec.ts («background removal…», «hide faces…», «auto reframe…», WYSIWYG
// «look tools» and «in motion», «history and persistence, look and AI tools»); the engines are lane B's (segment, faces,
// reframe): a defect found here goes there.
import { expect, test } from '@playwright/test';
import {
  audited, closeTools, exportPhoto, expectSameFrames, importFiles, mainClips, meanAbsDiff, newProject, rgbAt, scrubTo, selectClip,
  setSpeedPreset, tool, toastsSeen,
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
