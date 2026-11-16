// Text in motion and in its own look is the same in the preview and the file (QA matrix Q-18, Q-19 — docs/11 §3.2).
// Before, WYSIWYG for text had one title and the Comic style; the eleven entrances, their exits, the six loops, the
// gradient, the second outline, the 3D copies, the neon glow and a font of the person's own were never compared.
// One crafted project holds them all in a row, white on black, and each is caught mid-motion.
import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import { TEXT_ANIM_TYPES, TEXT_LOOP_TYPES, type Project, type TextClip } from '../src/core/types';
import { audits, exportAs, meanAbsDiff, note, previewAt, putProject, rgbOf, worstBlock, worstCast } from './qa-platform-kit';

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

test('a gradient, a second outline, 3D copies, neon and a font of one\'s own: the preview is the frame of the file (Q-18, Q-19)', async ({ page }, info) => {
  test.setTimeout(600_000);
  await oneText(page);
  // The person's own font, through the sheet as people add it.
  const fontFile = info.outputPath('MyFont.woff2');
  fs.copyFileSync(`${import.meta.dirname}/../node_modules/@fontsource/lobster/files/lobster-cyrillic-400-normal.woff2`, fontFile);
  await page.locator('.clip-text').first().click();
  await page.getByRole('button', { name: 'Edit text', exact: true }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Add font' }).click();
  await (await chooser).setFiles(fontFile);
  await expect(page.getByRole('radiogroup', { name: 'Font' }).getByRole('radio', { name: 'MyFont' })).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1500);
  const points: Point[] = [];
  await putProject<Project>(page, (p) => {
    const track = p.tracks.find((t) => t.clips.some((c) => c.kind === 'text'))!;
    const base = track.clips.find((c) => c.kind === 'text') as TextClip;
    const looks: [string, Partial<TextClip['style']>][] = [
      ['own font', {}],
      ['gradient', { gradient: '#ff2d92', color: '#ffe000' }],
      ['two outlines', { stroke: { color: '#000000', width: 0.08 }, outline2: { color: '#ff2d92', width: 0.16 } }],
      ['3D copies', { copies: [{ color: '#ff2d92', x: 0.04, y: 0.04, depth: true }] }],
      ['glitch copies', { copies: [{ color: '#00e5ff', x: -0.03, y: 0 }, { color: '#ff2d92', x: 0.03, y: 0 }] }],
      ['neon glow', { shadow: true, shadowColor: '#00e5ff', color: '#e0ffff' }],
      ['box per line', { background: { color: '#ffe000', opacity: 1, lines: true }, color: '#000000' }],
    ];
    track.clips = looks.map(([name, look], i) => {
      points.push({ name, t: i * SLOT + 0.4 });
      return { ...structuredClone(base), id: `s${i}`, start: i * SLOT, duration: SLOT, text: 'Кадр Ag\nвторая строка', style: { ...base.style, size: 0.08, ...look } };
    });
  });
  const { video, fails, previews } = await compare(page, info, points, 'Text looks');
  expect(fails, 'preview against the file, each look').toEqual([]);
  // A look that is missing is seen: its preview against the frame of the plain text is over the limit, by |difference|
  // or, for thin coloured copies that |difference| at this size blurs into edge noise, by the signed colour of a block.
  const frameOf = (x: Point) => rgbOf(video, Math.round(Math.round(x.t * 30) / 30 * 30));
  const same = points.map((x, i) => worstCast(previews[i], frameOf(x)));
  const plain = frameOf(points[0]);
  const apart = points.slice(1).map((x, i) => ({ pair: `${x.name} / plain`, block: worstBlock(previews[i + 1], plain), cast: worstCast(previews[i + 1], plain) }));
  const castLimit = Math.max(...same) * 1.5;
  note(info, 'apart.txt', `matching frames, worst signed block: ${same.map((v) => v.toFixed(1)).join(' ')}\n${apart.map((a) => `${a.pair}: block ${a.block.toFixed(1)}, cast ${a.cast.toFixed(1)}`).join('\n')}`);
  expect(apart.filter((a) => a.block <= MAX_BLOCK && a.cast <= castLimit), `looks the measure cannot tell from the plain text (cast limit ${castLimit.toFixed(1)})`).toEqual([]);
  fs.rmSync(video);
});
