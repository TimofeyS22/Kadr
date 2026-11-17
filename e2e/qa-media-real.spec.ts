// V-201, V-161: the phone video set in fixtures/real (not in git; its README says what is a real recording and what is
// a synthetic file with an iPhone's marks: HEVC Main 10 HLG, a 90° display matrix, 60 fps, a variable frame rate, ten
// minutes). One test per video found there: it goes in as long as the file is, upright, and comes out of the export as
// long as the timeline, with its picture (not black, filling a frame of its own shape) and its sound. A file over a
// minute is cut to its last 5 s first: the export seeks into the end of the file, as a cut of a long recording does.
import { expect, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { closeTools, errorToasts, exportAs, probe, scrubTo, selectClip, tool, watch, test } from './qa-media-kit';

const DIR = path.join(import.meta.dirname, '..', 'fixtures', 'real');
const FILES = fs.existsSync(DIR) ? fs.readdirSync(DIR).filter((f) => /\.(mov|mp4|m4v|webm)$/i.test(f)).sort() : [];

let privateCheck: () => void;
test.beforeEach(async ({ page }) => { privateCheck = await watch(page); });
test.afterEach(async ({ page }) => {
  privateCheck();
  expect(await errorToasts(page), 'error toasts').toEqual([]);
});

/** What the file is, as a player shows it: duration, size after its display matrix, sound. */
function source(file: string) {
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:stream_side_data=rotation:format=duration', '-of', 'json', file]).toString()) as {
    streams: { codec_type: string; codec_name: string; width?: number; height?: number; side_data_list?: { rotation?: number }[] }[]; format: { duration: string };
  };
  const v = p.streams.find((s) => s.codec_type === 'video')!;
  const turned = Math.abs(v.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ?? 0) % 180 === 90;
  const [w, h] = turned ? [v.height!, v.width!] : [v.width!, v.height!];
  return { duration: Number(p.format.duration), w, h, codec: v.codec_name, audio: p.streams.some((s) => s.codec_type === 'audio') };
}

/** Mean brightness of the top, the middle and the bottom tenth of frame `n` (0–255): black bars show as ~16 or less. */
function bands(file: string, n: number) {
  const W = 36, H = 64;
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `select=eq(n\\,${n}),scale=${W}:${H},format=gray`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-']);
  const mean = (y0: number, y1: number) => { let s = 0; for (let y = y0; y < y1; y++) for (let x = 0; x < W; x++) s += b[y * W + x]; return s / ((y1 - y0) * W); };
  return { top: mean(0, 6), middle: mean(29, 35), bottom: mean(H - 6, H) };
}

const length = (page: Page) => page.locator('.tl-row.main .clip').evaluateAll((els) => els.reduce((s, e) => s + e.getBoundingClientRect().width / 60, 0));

for (const name of FILES) {
  test(`a phone video goes in and out whole: ${name} (V-201)`, async ({ page, browserName }, info) => {
    test.setTimeout(600_000);
    const file = path.join(DIR, name);
    const src = source(file);
    const aspect = src.h > src.w ? '9:16' : '16:9';
    await page.goto('./');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: aspect }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible();
    const main = page.locator('.tl-row.main .clip');
    const t0 = Date.now();
    const chooser = page.waitForEvent('filechooser');
    await tool(page, 'Media').click();
    await (await chooser).setFiles(file);
    // Playwright's Chromium has no HEVC decoder (Android Chrome uses the phone's own: L5). There an HEVC file is refused
    // by name in Kadr's words and the project stays as it was.
    if (browserName === 'chromium' && src.codec === 'hevc') {
      await expect.poll(() => errorToasts(page), { timeout: 120_000 }).toContainEqual(expect.stringContaining(name));
      const said = await errorToasts(page);
      console.log(`real file (${info.project.name}): ${name}: HEVC, refused: ${JSON.stringify(said)}`);
      for (const e of said) expect(e, "Kadr's own words, not the engine's").not.toMatch(/undefined|null|\[object|Error:|NaN/);
      await expect(main).toHaveCount(0);
      await page.evaluate(() => { (window as unknown as { __toastErrors: string[] }).__toastErrors.length = 0; });
      return;
    }
    await expect(main).toHaveCount(1, { timeout: 120_000 });
    const tookMs = Date.now() - t0;
    await closeTools(page);
    const rows = [`${name}: ${src.w}×${src.h} shown, ${src.duration.toFixed(2)} s, sound ${src.audio}; in the timeline after ${tookMs} ms`];
    expect(Math.abs(await length(page) - src.duration), 'the clip is as long as the file').toBeLessThan(0.15);
    if (src.duration > 60) {
      // The last 5 s of a long recording: split there, the first part deleted.
      const at = Math.floor(src.duration - 5);
      await scrubTo(page, at, `${Math.floor(at / 60)}:${String(at % 60).padStart(2, '0')}.0`);
      await selectClip(main.first());
      await tool(page, 'Split').click();
      await expect(main).toHaveCount(2);
      await selectClip(main.first());
      await tool(page, 'Delete').click();
      await expect(main).toHaveCount(1);
      await closeTools(page);
    }
    const want = await length(page);
    const video = await exportAs(page, info, 'Video', 'Export video');
    const out = probe(video);
    const duration = Number(out.format.duration);
    const v = out.streams.find((s) => s.codec_type === 'video')!;
    const frames = Number(v.nb_read_frames);
    const mid = bands(video, Math.floor(frames / 2));
    rows.push(`file: ${v.width}×${v.height}, ${duration.toFixed(3)} s (timeline ${want.toFixed(3)}), ${frames} frames, sound ${out.streams.some((s) => s.codec_type === 'audio')}; middle frame top ${mid.top.toFixed(0)} / middle ${mid.middle.toFixed(0)} / bottom ${mid.bottom.toFixed(0)}`);
    console.log(`real file (${info.project.name}): ${rows.join('; ')}`);
    expect(Math.abs(duration - want), 'the file is as long as the timeline').toBeLessThan(0.15);
    expect(out.streams.some((s) => s.codec_type === 'audio'), 'sound where the file has it').toBe(src.audio);
    expect(frames, 'frames all the way').toBeGreaterThan(want * 20);
    // Upright and filling a frame of its own shape: a portrait video read as landscape would leave black bars.
    for (const [band, y] of Object.entries(mid)) expect.soft(y, `${band} of the middle frame is picture, not black`).toBeGreaterThan(30);
  });
}
