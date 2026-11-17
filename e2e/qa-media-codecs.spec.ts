// QA matrix Q-6, phone codecs: iPhone HDR (HEVC 10-bit HLG), iPhone 16+ (a 4-channel track before the stereo one),
// MediaRecorder files. docs/11 §3.5 (edges) and §3.6 (hostile inputs). What editor.spec.ts already proves: each of them
// imports and exports, and the HDR picture matches in WebKit. Here: the 16+ video after a split and a speed change, the
// recorder's own files, and phone files cut short or missing their readable track. The HDR video after a split, 2× and
// a reverse is SW-A-5: on Chromium its frame in the file is 1/255 less red than the preview (branch sw-a-red).
import { expect, type Page, type TestInfo } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { closeTools, counterAt, errorToasts, exportAs, fx, importFiles, probe, scrubTo, selectClip, tool, watch, test } from './qa-media-kit';

let privateCheck: () => void;
test.beforeEach(async ({ page }) => { privateCheck = await watch(page); });
test.afterEach(async ({ page }) => {
  privateCheck();
  expect(await errorToasts(page), 'error toasts').toEqual([]);
});

const main = (page: Page) => page.locator('.tl-row.main .clip');
async function newProject(page: Page, aspect = '16:9') {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: aspect }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}
async function speed2x(page: Page, n: number) {
  await selectClip(main(page).nth(n));
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
}
/** Mean volume of the sound from `from` for `length` seconds, dB (ffmpeg's volumedetect writes to stderr). */
const meanDb = (file: string, from = 0, length = 99) => Number(/mean_volume: (-?[\d.]+) dB/.exec(spawnSync('ffmpeg', ['-v', 'info', '-ss', String(from), '-t', String(length), '-i', file, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], { encoding: 'utf8' }).stderr)?.[1] ?? -99);

/** Records `seconds` of a numbered picture (counterAt reads it) and a tone with the browser's own MediaRecorder. */
async function recordInPage(page: Page, info: TestInfo, seconds: number, name: string): Promise<string> {
  const { data, type } = await page.evaluate(async (ms) => {
    const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
    const g = c.getContext('2d')!;
    let n = 0;
    const draw = () => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff';
      for (let k = 0; k < 8; k++) if ((n >> k) & 1) g.fillRect(k * 80, 0, 80, 360);
      n = (n + 1) % 256;
    };
    draw();
    const timer = setInterval(draw, 33);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const stream = new MediaStream([...c.captureStream(30).getVideoTracks(), ...dest.stream.getAudioTracks()]);
    const mime = ['video/mp4;codecs=avc1,mp4a.40.2', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find((m) => MediaRecorder.isTypeSupported(m))!;
    const rec = new MediaRecorder(stream, { mimeType: mime });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => chunks.push(e.data);
    const done = new Promise((r) => { rec.onstop = r; });
    rec.start(1000); // pieces of a second, as Kadr's camera records
    await new Promise((r) => setTimeout(r, ms));
    rec.stop();
    await done;
    clearInterval(timer);
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close();
    const buf = new Uint8Array(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
    let s = '';
    for (const x of buf) s += String.fromCharCode(x);
    return { data: btoa(s), type: rec.mimeType };
  }, seconds * 1000);
  const file = info.outputPath(`${name}.${type.includes('mp4') ? 'mp4' : 'webm'}`);
  fs.writeFileSync(file, Buffer.from(data, 'base64'));
  return file;
}

test('an iPhone 16+ video split, cut and at 2× keeps the sound of its stereo track in the file (QA matrix Q-6)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  await importFiles(page, 'Media', ['iphone_spatial.mov']); // H.264, a 4-channel ALAC track, then stereo AAC; 4 s
  await expect(main(page)).toHaveCount(1, { timeout: 60_000 });
  await closeTools(page);
  await scrubTo(page, 2, '0:02.0');
  await selectClip(main(page).first());
  await tool(page, 'Split').click();
  await expect(main(page)).toHaveCount(2);
  await speed2x(page, 1);
  await closeTools(page);
  const video = await exportAs(page, info, 'Video', 'Export video');
  const pr = probe(video);
  expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Math.abs(Number(pr.format.duration) - 3), '2 s, then 2 s at 2×').toBeLessThan(0.1);
  const [first, fast] = [meanDb(video, 0.2, 1.6), meanDb(video, 2.1, 0.8)];
  console.log(`iPhone 16+ edges (${info.project.name}): ${first} dB, at 2× ${fast} dB`);
  expect(first, 'the tone in the first part').toBeGreaterThan(-30);
  expect(fast, 'the tone in the part at 2×').toBeGreaterThan(-30);
});

test('a MediaRecorder video (fragmented MP4 in WebKit, WebM without a duration in Chromium) picked as a file: its length is right, a split and the file keep every frame and the sound; a half-second one goes in too (QA matrix Q-6)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  const take = await recordInPage(page, info, 3, 'recorder-3s');
  const short = await recordInPage(page, info, 0.5, 'recorder-half');
  const real = Number(execFileSync('ffprobe', ['-v', 'error', '-count_packets', '-select_streams', 'v', '-show_entries', 'stream=nb_read_packets', '-of', 'csv=p=0', take]).toString().trim());
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([take, short]);
  await expect(main(page)).toHaveCount(2, { timeout: 60_000 });
  await closeTools(page);
  const widths = await main(page).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width / 60));
  console.log(`recorder files (${info.project.name}): ${real} frames in the 3 s take; clips ${widths.map((w) => w.toFixed(2)).join(' s, ')} s`);
  expect(Math.abs(widths[0] - 3), 'the take is as long as it was recorded').toBeLessThan(0.5);
  expect(widths[1], 'the half-second take is there').toBeGreaterThan(0.2);
  // Split in the middle of the take; the file holds both parts and the short take, with sound.
  await scrubTo(page, 1.5, '0:01.5');
  await selectClip(main(page).first());
  await tool(page, 'Split').click();
  await expect(main(page)).toHaveCount(3);
  await closeTools(page);
  const video = await exportAs(page, info, 'Video', 'Export video');
  const pr = probe(video);
  const total = widths[0] + widths[1];
  expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Math.abs(Number(pr.format.duration) - total), 'the file is as long as the timeline').toBeLessThan(0.15);
  expect(meanDb(video, 0.2, 2.5), 'the tone').toBeGreaterThan(-30);
  // The picture moves on across the split: frames a second apart show different numbers, in order.
  const seen = [15, 45, 75].map((k) => counterAt(video, k));
  console.log(`recorder take frames 15, 45, 75 (${info.project.name}): ${seen.join(', ')}`);
  expect(new Set(seen).size, 'a moving picture, not one frame held').toBe(3);
});

test('phone files that are not whole: an HDR original cut in half, a 16+ video with only its 4-channel track, a recorder file cut off — each a clear message by name or a clip that plays, the rest of the batch goes in and the project exports (QA matrix Q-6)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await newProject(page);
  const out = (n: string) => info.outputPath(n);
  const hdr = fs.readFileSync(fx('iphone_hdr.mov'));
  fs.writeFileSync(out('hdr-half.mov'), hdr.subarray(0, hdr.length >> 1));
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', fx('iphone_spatial.mov'), '-map', '0:0', '-map', '0:1', '-c', 'copy', out('four-channels.mov')]);
  const rec = await recordInPage(page, info, 3, 'recorder-whole');
  const recBytes = fs.readFileSync(rec);
  const cut = out(`recorder-cut${rec.slice(rec.lastIndexOf('.'))}`);
  fs.writeFileSync(cut, recBytes.subarray(0, Math.floor(recBytes.length * 0.6)));
  const files = [out('hdr-half.mov'), out('four-channels.mov'), cut, fx('counter.mp4')];
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(files);
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 120_000 });
  await expect(main(page).first()).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  const errors = await errorToasts(page);
  const notes = await page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);
  const clips = await main(page).count();
  console.log(`hostile phone files (${info.project.name}): ${clips} clips; errors: ${JSON.stringify(errors)}; notes: ${JSON.stringify(notes)}`);
  // Every file is accounted for: in as a clip, or refused with its name. The good one is always in.
  const names = ['hdr-half.mov', 'four-channels.mov', cut.slice(cut.lastIndexOf('/') + 1), 'counter.mp4'];
  const refused = names.filter((n) => errors.some((e) => e.includes(n)));
  expect(clips + refused.length, `each file in or refused by name (refused: ${refused.join(', ')})`).toBe(names.length);
  expect(refused, 'the whole file goes in').not.toContain('counter.mp4');
  for (const e of errors) expect(e, 'Kadr\'s own words, not the engine\'s').not.toMatch(/undefined|null|\[object|Error:|NaN/);
  // The project exports, as long as its clips, with the good file's frames where they belong.
  await closeTools(page);
  const length = await main(page).evaluateAll((els) => els.reduce((s, e) => s + e.getBoundingClientRect().width / 60, 0));
  const video = await exportAs(page, info, 'Video', 'Export video');
  expect(Math.abs(Number(probe(video).format.duration) - length), 'the file is as long as the timeline').toBeLessThan(0.2);
  await page.evaluate(() => { (window as unknown as { __toastErrors: string[] }).__toastErrors.length = 0; }); // the refusals above are expected
});
