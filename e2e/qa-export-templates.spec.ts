// Every template is built and exported, from the inputs people pick (C-H1 «Шаблоны не работают», QA matrix Q-3).
// The older check («home: … every template») only waited for a clip to appear: a template that built an empty, black,
// silent or short file passed it. Here each one is opened from Home with its own kind of input, and the file is read
// with ffprobe and ffmpeg: as long as the timeline, H.264 at 30 fps with every frame there, AAC stereo, a picture, the
// music audible where it was picked, decoding without an error (CLAUDE.md §4).
import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import { projectDuration } from '../src/core/timeline';
import type { Project } from '../src/core/types';
import { audits, decodeErrors, exportAs, fx, grayAt, note, probe, rmsDb, samples, storedProject, toasts } from './qa-platform-kit';

audits();

interface Case { tpl: string; files: string[]; clips: number; music: boolean; why: string }
const CASES: Case[] = [
  { tpl: 'Slideshow', files: ['photo.png', 'person.jpg', 'music.m4a'], clips: 2, music: true, why: 'photos and music, the usual pick' },
  { tpl: 'Slideshow', files: ['landscape.mp4', 'portrait.mp4'], clips: 2, music: false, why: 'videos with their own sound, no music' },
  { tpl: 'Beat edit', files: ['photo.png', 'person.jpg', 'landscape.mp4', 'beat120.m4a'], clips: 0, music: true, why: 'cuts on a 120 BPM beat' },
  { tpl: 'Vlog', files: ['landscape.mp4', 'counter.mp4', 'music.m4a'], clips: 2, music: true, why: 'two videos under music' },
  { tpl: 'Before / After', files: ['photo.png', 'landscape.mp4'], clips: 2, music: false, why: 'a square photo over a wide video' },
  { tpl: 'Quote card', files: ['person.jpg'], clips: 1, music: false, why: 'one photo, nothing else' },
  { tpl: 'Title intro', files: ['landscape.mp4', 'photo.png', 'music.m4a'], clips: 2, music: true, why: 'a video, a photo and music' },
];

async function fromTemplate(page: Page, tpl: string, files: string[]) {
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.template-card', { hasText: tpl }).click();
  await (await chooser).setFiles(files.map(fx));
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('.tl-row .clip').first()).toBeVisible({ timeout: 60_000 });
}

for (const c of CASES) {
  test(`template «${c.tpl}» (${c.why}): built from Home, the file is whole — length, codecs, every frame, picture and sound (C-H1)`, async ({ page }, info) => {
    test.setTimeout(300_000);
    await fromTemplate(page, c.tpl, c.files);
    const p = await storedProject<Project>(page);
    const main = p.tracks.find((t) => t.kind === 'main')!;
    if (c.clips) expect(main.clips.length + p.tracks.filter((t) => t.kind === 'overlay').reduce((n, t) => n + t.clips.filter((x) => x.kind !== 'text').length, 0), 'photos and videos on the timeline').toBeGreaterThanOrEqual(c.clips);
    const audio = p.tracks.flatMap((t) => t.clips).filter((x) => x.kind === 'audio');
    expect(audio.length, 'a music clip only when music was picked').toBe(c.music ? 1 : 0);
    const want = projectDuration(p);
    expect(want, 'the template made something to watch').toBeGreaterThan(1);

    const file = await exportAs(page, info, 'Video');
    const got = probe(file);
    note(info, 'probe.json', JSON.stringify({ want, got }, null, 2));
    expect(decodeErrors(file), 'ffmpeg decodes the whole file').toBe('');
    expect(got.video?.codec).toBe('h264');
    expect(got.video?.fps).toBeCloseTo(30, 1);
    expect(Math.abs(got.duration - want), `file ${got.duration} s, timeline ${want} s`).toBeLessThan(0.1);
    expect(Math.abs(got.video!.frames - Math.round(want * 30)), 'every frame is in the file').toBeLessThanOrEqual(1);
    expect(got.audio?.codec).toBe('aac');
    expect(got.audio?.channels).toBe(2);
    // A picture, not black: the middle frame has light and detail.
    const mid = grayAt(file, want / 2);
    const mean = mid.reduce((a, b) => a + b, 0) / mid.length;
    const spread = Math.sqrt(mid.reduce((a, b) => a + (b - mean) ** 2, 0) / mid.length);
    expect(mean, 'middle frame is not black').toBeGreaterThan(15);
    expect(spread, 'middle frame has detail').toBeGreaterThan(8);
    // Sound where there should be: the music, or the videos' own sound.
    const hasSound = c.music || c.files.some((f) => f.endsWith('.mp4'));
    if (hasSound) expect(rmsDb(samples(file), want * 0.3, want * 0.7), 'the middle of the file is audible').toBeGreaterThan(-45);
    fs.rmSync(file);
  });
}

test('template «Beat edit» with music that has no steady beat says so, cuts evenly and exports (C-H1)', async ({ page }, info) => {
  test.setTimeout(240_000);
  await fromTemplate(page, 'Beat edit', ['photo.png', 'person.jpg', 'speech_pauses.m4a']);
  const p = await storedProject<Project>(page);
  const music = Object.values(p.assets).find((a) => a.kind === 'audio')!;
  // Either a grid was found, or the person was told the cuts are even; never neither.
  if (!music.beats) expect(await toasts(page)).toContain('No steady beat found, clips are cut evenly instead');
  const want = projectDuration(p);
  const got = probe(await exportAs(page, info, 'Video'));
  expect(Math.abs(got.duration - want)).toBeLessThan(0.1);
  expect(got.audio?.codec).toBe('aac');
});

test('a template picked with fewer photos than it needs says how many, and makes no project (C-H1)', async ({ page }) => {
  await page.goto('./');
  const before = await page.locator('.project-open').count();
  const chooser = page.waitForEvent('filechooser');
  await page.locator('.template-card', { hasText: 'Before / After' }).click();
  await (await chooser).setFiles([fx('photo.png')]);
  await expect(page.getByText('Before / After needs at least 2 photos or videos')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0)); // this one is the point
  await expect(page.locator('.project-open')).toHaveCount(before);
  const beat = page.waitForEvent('filechooser');
  await page.locator('.template-card', { hasText: 'Beat edit' }).click();
  await (await beat).setFiles([fx('photo.png'), fx('person.jpg')]);
  await expect(page.getByText('Beat edit needs a music file too. Select it together with your photos.')).toBeVisible();
  await page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors.splice(0));
  await expect(page.locator('.project-open')).toHaveCount(before);
});
