// Text in motion and in its own look is the same in the preview and the file (QA matrix Q-18, Q-19 — docs/11 §3.2).
// Before, WYSIWYG for text had one title and the Comic style; the eleven entrances, their exits, the six loops, the
// gradient, the second outline, the 3D copies, the neon glow and a font of the person's own were never compared.
// One crafted project holds them all in a row, white on black, and each is caught mid-motion.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { TEXT_ANIM_TYPES, TEXT_LOOP_TYPES, type Project, type TextClip } from '../src/core/types';
import { audits, exportAs, meanAbsDiff, note, previewAt, putProject, rgbOf, worstBlock } from './qa-platform-kit';

audits();

const SLOT = 0.8, ANIM = 0.5;
/** Matching frames stay under these (calibrated on green runs, see the notes); a moved or missing word goes far over. */
const MAX_MEAN = 3;
const MAX_BLOCK = 40;

async function oneText(page: import('@playwright/test').Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.clip-text')).toHaveCount(1);
  await page.waitForTimeout(1500); // saved
}

type Point = { name: string; t: number };

async function compare(page: import('@playwright/test').Page, info: import('@playwright/test').TestInfo, points: Point[], title: string) {
  const video = await exportAs(page, info, 'Video');
  const rows: string[] = [];
  const fails: string[] = [];
  const previews: Buffer[] = [];
  for (const { name, t: at } of points) {
    const t = Math.round(at * 30) / 30;
    const preview = rgbOf(await previewAt(page, info, t));
    previews.push(preview);
    const frame = rgbOf(video, Math.round(t * 30));
    const [mean, block] = [meanAbsDiff(preview, frame), worstBlock(preview, frame)];
    rows.push(`${name} @ ${t.toFixed(3)} s: mean ${mean.toFixed(2)}, worst block ${block.toFixed(1)}`);
    if (mean >= MAX_MEAN || block >= MAX_BLOCK) fails.push(rows.at(-1)!);
  }
  note(info, 'frames.txt', rows.join('\n'));
  console.log(`${title} (${info.project.name}):\n${rows.join('\n')}`);
  return { video, fails, previews };
}

test('every entrance, every exit and every loop: caught mid-motion, the preview is the frame of the file (Q-19)', async ({ page }, info) => {
  test.setTimeout(900_000);
  await oneText(page);
  const anims = TEXT_ANIM_TYPES.filter((a) => a !== 'none');
  const loops = TEXT_LOOP_TYPES.filter((l) => l !== 'none');
  const points: Point[] = [];
  await putProject<Project>(page, (p) => {
    const track = p.tracks.find((t) => t.clips.some((c) => c.kind === 'text'))!;
    const base = track.clips.find((c) => c.kind === 'text') as TextClip;
    const make = (i: number, over: Partial<TextClip>): TextClip => ({
      ...structuredClone(base), id: `t${i}`, start: i * SLOT, duration: SLOT, text: 'Кадр Ag',
      style: { ...base.style, size: 0.09 }, animIn: { type: 'none', duration: ANIM }, animOut: { type: 'none', duration: ANIM }, ...over,
    });
    const clips: TextClip[] = [];
    anims.forEach((type) => { clips.push(make(clips.length, { animIn: { type, duration: ANIM } })); points.push({ name: `in ${type}`, t: (clips.length - 1) * SLOT + ANIM / 2 }); });
    anims.forEach((type) => { clips.push(make(clips.length, { animOut: { type, duration: ANIM } })); points.push({ name: `out ${type}`, t: clips.length * SLOT - ANIM / 2 }); });
    loops.forEach((type) => { clips.push(make(clips.length, { loop: { type, period: 1 } })); points.push({ name: `loop ${type}`, t: (clips.length - 1) * SLOT + 0.37 }); });
    track.clips = clips;
  });
  expect(points.length).toBe(anims.length * 2 + loops.length);
  const { video, fails } = await compare(page, info, points, 'Text motion');
  // The measure sees motion: the same slide a few frames on is far from it.
  const slide = points.find((x) => x.name === 'in slideLeft')!;
  const moved = worstBlock(rgbOf(await previewAt(page, info, Math.round(slide.t * 30) / 30)), rgbOf(video, Math.round(slide.t * 30) + 4));
  expect(moved, 'four frames later the sliding word is somewhere else').toBeGreaterThan(MAX_BLOCK);
  expect(fails, 'preview against the file, mid-motion').toEqual([]);
  fs.rmSync(video);
});
