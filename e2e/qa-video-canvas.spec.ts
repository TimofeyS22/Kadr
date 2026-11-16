// QA matrix Q-16 (docs/21 lane C): canvas — aspect, background (colour, blur), frame rate, safe zones — by docs/11 §3.
// Points 1–2 are editor.spec.ts («canvas: aspect ratio and blurred background…», «WYSIWYG in motion»: the blurred canvas,
// the safe zones not in the file); this file holds 3–4 beyond the blur, and the ends of every aspect.
import { expect, test } from '@playwright/test';
import {
  audited, closeTools, exportPhoto, exportVideo, historyProof, importFiles, mainClips, newProject, previewAt, probe, rgbAt, sheet, tool,
} from './qa-video-kit';

audited();

test('canvas settings are each one exact undo step and survive a reload: aspect, background colour, blur, frame rate (Q-16)', async ({ page }, info) => {
  test.setTimeout(900_000);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'person.jpg']);
  await expect(mainClips(page)).toHaveCount(2);
  await closeTools(page);
  const canvasSheet = async (fn: () => Promise<void>) => {
    await tool(page, 'Canvas').click();
    await fn();
    await page.getByRole('button', { name: 'Done' }).click();
  };
  const h = historyProof(page, info);
  await h.start();
  await h.act('aspect 4:5', () => canvasSheet(() => sheet(page).getByRole('radio', { name: '4:5' }).click()));
  await h.act('yellow background', () => canvasSheet(() => sheet(page).getByRole('button', { name: '#ffc53d' }).click()));
  await h.act('blurred background', () => canvasSheet(() => sheet(page).getByRole('radio', { name: 'Blur' }).click()));
  await h.act('25 fps', () => canvasSheet(() => sheet(page).getByRole('radio', { name: '25 fps' }).click()));
  await h.undoRedo();
  await h.reload();
});

test('every aspect exports at its own size with the picture where the preview has it; the colour behind a narrow clip is the colour chosen; safe zones stay out of the file (Q-16)', async ({ page }, info) => {
  test.setTimeout(900_000);
  await newProject(page);
  await importFiles(page, 'Media', ['person.jpg']); // a portrait photo: bars at the sides in wide frames
  await expect(mainClips(page)).toHaveCount(1);
  await closeTools(page);
  await tool(page, 'Canvas').click();
  await sheet(page).getByRole('button', { name: '#2f9bff' }).click(); // blue behind the picture
  await page.getByRole('button', { name: 'Done' }).click();
  // The safe zones are a guide over the preview: a photo taken with them shown is the photo without them.
  const zones = page.getByRole('button', { name: 'Show TikTok, Reels and Shorts safe zones' });
  await zones.click();
  await expect(page.locator('.safe-zones')).toBeVisible();
  const withZones = rgbAt(await exportPhoto(page, info));
  await zones.click();
  await expect(page.locator('.safe-zones')).toHaveCount(0);
  const sizes: Record<string, [number, number]> = { '9:16': [1080, 1920], '16:9': [1920, 1080], '1:1': [1080, 1080], '4:5': [1080, 1350] };
  const rows: string[] = [];
  for (const [aspect, [w, h]] of Object.entries(sizes)) {
    await tool(page, 'Canvas').click();
    await sheet(page).getByRole('radio', { name: aspect }).click();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect.poll(async () => { const b = (await page.locator('.preview-canvas').boundingBox())!; return b.width / b.height; }).toBeCloseTo(w / h, 1);
    const photo = await exportPhoto(page, info);
    const p = probe(photo).streams[0];
    // The file at its size (the export keeps the long side at 1080p or less: the photo is the frame's own size).
    expect([p.width! / p.height!].map((r) => Math.round(r * 100) / 100), `${aspect}: the photo's shape`).toEqual([Math.round((w / h) * 100) / 100]);
    // The preview and the photo: the same picture, and the corner (outside the portrait photo in wide frames) blue.
    const shot = rgbAt(await previewAt(page, info, 1.5)), file = rgbAt(photo);
    let d = 0;
    for (let i = 0; i < shot.length; i++) d += Math.abs(shot[i] - file[i]);
    d /= shot.length;
    const corner = [file[0], file[1], file[2]];
    rows.push(`${aspect}: photo ${p.width}×${p.height}, preview vs photo ${d.toFixed(2)}, top-left ${corner.join(',')}`);
    expect.soft(d, `${aspect}: the preview is the photo`).toBeLessThan(4);
    if (aspect === '9:16') {
      let z = 0;
      for (let i = 0; i < file.length; i++) z += Math.abs(file[i] - withZones[i]);
      rows.push(`9:16 photo with the safe zones shown vs without: ${(z / file.length).toFixed(3)}`);
      expect.soft(z / file.length, 'the safe zones are not in the file').toBeLessThan(0.5);
    }
    if (w > h * 0.7) expect.soft(Math.abs(corner[0] - 0x2f) + Math.abs(corner[1] - 0x9b) + Math.abs(corner[2] - 0xff), `${aspect}: the chosen blue behind the picture`).toBeLessThan(30);
  }
  // The video of the last aspect: its size and frame rate as set.
  const v = probe(await exportVideo(page, info)).streams.find((s) => s.codec_type === 'video')!;
  rows.push(`video 4:5: ${v.width}×${v.height} @ ${v.r_frame_rate}`);
  console.log(`canvas ends (${info.project.name}):\n${rows.join('\n')}`);
  expect(Math.round((v.width! / v.height!) * 100) / 100).toBe(0.8);
});
