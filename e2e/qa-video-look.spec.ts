// QA matrix Q-11 (docs/21 lane C): crop, filters, adjust, LUT, effects — by docs/11 §3. Points 1–2 and 6 are in
// editor.spec.ts («crop, filters…», «LUT import…», «video effects…», «WYSIWYG for every look tool», «…in motion», «a photo, a
// 1D LUT or a zip picked as a LUT…»); this file holds the gaps the matrix had: 3 and 4 beyond the filter, 5 the ends.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import {
  audited, closeTools, expectSameFrames, historyProof, importFiles, mainClips, newProject, selectClip, sheet, tool, useSheet, valueToEnd,
} from './qa-video-kit';

audited();

const ADJUST = ['Exposure', 'Brightness', 'Contrast', 'Highlights', 'Shadows', 'Saturation', 'Temperature', 'Tint', 'Fade', 'Vignette', 'Sharpen', 'Grain'];

/** A 9³ .cube written for the test: `f` maps an RGB triple in 0–1. */
function cube(info: TestInfo, name: string, f: (v: number[]) => number[]) {
  const lines = [`TITLE "${name}"`, 'LUT_3D_SIZE 9'];
  for (let b = 0; b < 9; b++) for (let g = 0; g < 9; g++) for (let r = 0; r < 9; r++) lines.push(f([r / 8, g / 8, b / 8]).map((x) => x.toFixed(4)).join(' '));
  const file = info.outputPath(`${name}.cube`);
  fs.writeFileSync(file, lines.join('\n'));
  return file;
}
async function importLut(page: Page, file: string) {
  await tool(page, 'Filters').click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import LUT (.cube)' }).click();
  await (await chooser).setFiles(file);
  await expect(page.getByRole('radio', { name: file.split('/').pop()!.replace('.cube', ''), exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
}
async function effect(page: Page, name: string, strength?: 'Home' | 'End') {
  await tool(page, 'Effects').click();
  await page.getByRole('radio', { name, exact: true }).click();
  if (strength) await valueToEnd(page, 'Strength', strength);
  await page.getByRole('button', { name: 'Done' }).click();
}

test('look tools are each one exact undo step and survive a reload: crop, adjust, filter and its strength, LUT, effect, one look for every piece (Q-11)', async ({ page }, info) => {
  test.setTimeout(900_000);
  const clips = mainClips(page);
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4', 'photo.png']);
  await expect(clips).toHaveCount(2);
  await closeTools(page);
  const h = historyProof(page, info);
  await h.start();
  await h.act('crop 1:1', async () => {
    await selectClip(page, clips.nth(0));
    await tool(page, 'Crop').click();
    await page.getByRole('radio', { name: '1:1' }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('adjust', async () => { await selectClip(page, clips.nth(0)); await useSheet(page, 'Adjust'); });
  await h.act('filter', async () => {
    await selectClip(page, clips.nth(0));
    await tool(page, 'Filters').click();
    await page.getByRole('radio', { name: 'Vivid', exact: true }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('filter strength', async () => {
    await selectClip(page, clips.nth(0));
    await tool(page, 'Filters').click();
    await valueToEnd(page, 'Intensity', 'End');
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.act('LUT', async () => { await selectClip(page, clips.nth(1)); await importLut(page, cube(info, 'my-warm-lut', ([r, g, b]) => [Math.min(1, r * 1.15), g, b * 0.85])); });
  await h.act('effect', async () => { await selectClip(page, clips.nth(1)); await effect(page, 'VHS'); });
  await h.act('the filter on every piece', async () => {
    await selectClip(page, clips.nth(0));
    await tool(page, 'Filters').click();
    await sheet(page).getByRole('button', { name: /^Apply to all pieces/ }).click();
    await page.getByRole('button', { name: 'Done' }).click();
  });
  await h.undoRedo();
  await h.reload();
});

test('look tools at their ends: every Adjust value at its top and at its bottom, the strongest filter with a LUT, the smallest crop at 4×, effects at full strength — the preview, the photo and the video frame match (Q-11)', async ({ page }, info) => {
  test.setTimeout(900_000);
  const clips = mainClips(page);
  await newProject(page);
  // Natural tones for the colour ends; the fractal again for the crop corner and the blur: its corner at 4× still holds
  // colour and edges. The bars' corners at 4× are one flat bar (cyan 0,254,254): a frame of one colour at the gamut's edge
  // measures the encoder's rounding there (CI WebKit: 255 → 253, cast 2.00), not whether the file is the preview.
  await importFiles(page, 'Media', ['walk.mp4', 'person.jpg', 'photo.png', 'photo.png']);
  await expect(clips).toHaveCount(4);
  const middles = await clips.evaluateAll((els) => els.map((e) => ((e as HTMLElement).offsetLeft - (els[0] as HTMLElement).offsetLeft + (e as HTMLElement).offsetWidth / 2) / 60));
  const adjustAll = async (k: number, key: 'Home' | 'End') => {
    await selectClip(page, clips.nth(k));
    await tool(page, 'Adjust').click();
    for (const name of ADJUST) {
      await sheet(page).getByRole('radio', { name, exact: true }).click();
      await valueToEnd(page, name, key);
    }
    await page.getByRole('button', { name: 'Done' }).click();
  };
  await adjustAll(0, 'End');
  await adjustAll(1, 'Home');
  // Photo: the filter at full strength, a LUT that swaps red and blue, Glitch at full strength.
  await selectClip(page, clips.nth(2));
  await tool(page, 'Filters').click();
  await page.getByRole('radio', { name: 'Cyber', exact: true }).click();
  await valueToEnd(page, 'Intensity', 'End');
  await page.getByRole('button', { name: 'Done' }).click();
  await importLut(page, cube(info, 'my-swap-lut', ([r, g, b]) => [b, g, r]));
  await effect(page, 'Glitch', 'End');
  // The fractal: 9:16 crop at 4×, panned to the bottom right corner, and Blur at full strength.
  await selectClip(page, clips.nth(3));
  await tool(page, 'Crop').click();
  await page.getByRole('radio', { name: '9:16' }).click();
  await valueToEnd(page, 'Zoom', 'End');
  await valueToEnd(page, 'Left ↔ right', 'End');
  await valueToEnd(page, 'Up ↕ down', 'End');
  await page.getByRole('button', { name: 'Done' }).click();
  await effect(page, 'Blur', 'End');
  await closeTools(page);
  const names = ['video: every Adjust value at its top', 'photo: every Adjust value at its bottom', 'photo: Cyber 100%, LUT, Glitch 100%', 'fractal: 9:16 at 4× in the corner, Blur 100%'];
  // The fractal's corner at 4× fills the frame with bright colour: its limit is that of bright full frames (editor.spec «in motion», 2:
  // matching ≤ 0.83, export-only temperature +0.3 gave 4.9–6.1); the others are mostly dark or soft, 0.8 as «look tools».
  await expectSameFrames(page, info, 'WYSIWYG look ends', names.map((name, k) => ({ name, t: middles[k], ...(k === 3 ? { maxCast: 2 } : {}) })), 0.8);
});
