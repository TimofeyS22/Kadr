// An overlay must not make the export slow (owner, 2026-10-30: «При наложении видео долго выгружается»).
// WebKit, the engine of every iPhone browser, took each video frame into WebGL from a 2D canvas, and it copies a canvas
// through the CPU: ~11 ms per 1080p layer and ~28 ms per 4K one, every frame. A 4K overlay made a 30 s export 2.9× as
// long (15.5 → 44.4 s on this Mac), longer than the video itself. Now decoder frames go to WebGL as they are
// (Compositor.frameMax). Chromium hands a canvas to WebGL on the GPU and keeps that path; it runs on the GPU here, as
// Android Chrome does. The thresholds are the cause and the budget, not the ratio of two exports: a second decoder
// competes for the CPU, and on a loaded Mac the ratio alone wandered from 1.2 to 2.1 with the fix.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
// 30 s each, as a phone records them. The overlay is 4K HEVC, an iPhone's own; Playwright's Chromium has no HEVC decoder.
const MAIN = 'phone_1080_h264.mp4', overlayFile = (project: string) => (project === 'iphone-webkit' ? 'phone_4k_hevc.mov' : 'phone_4k_h264.mp4');
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.use({ serviceWorkers: 'block' });
// Headless Chromium draws WebGL in software, where every path is slow; Android Chrome has a GPU (as `npm run perf`).
test.use({ launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
    // Video frames handed to WebGL: how many came through a 2D canvas (the copy that cost WebKit ~11–28 ms a layer a
    // frame), and the time the page spent handing frames over.
    const w = window as unknown as { __upload: { canvases: number; ms: number } };
    w.__upload = { canvases: 0, ms: 0 };
    const tex = WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D = function (this: WebGL2RenderingContext, ...a: unknown[]) {
      const src = a[a.length - 1];
      if (!(src instanceof HTMLCanvasElement) && !(typeof VideoFrame !== 'undefined' && src instanceof VideoFrame)) return (tex as (...x: unknown[]) => void).apply(this, a);
      const t = performance.now();
      (tex as (...x: unknown[]) => void).apply(this, a);
      w.__upload.ms += performance.now() - t;
      if (src instanceof HTMLCanvasElement) w.__upload.canvases++;
    } as typeof tex;
  });
});

/** Exports the project as 1080p30 video (checked with ffprobe): the seconds it took and the frames' way into WebGL. */
async function exportVideo(page: Page, file: string, seconds = 30) {
  await tool(page, 'Export').first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'TikTok, Reels, Shorts' }).click();
  await page.evaluate(() => { (window as unknown as { __upload: { canvases: number; ms: number } }).__upload = { canvases: 0, ms: 0 }; });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 300_000 });
  const took = (Date.now() - t0) / 1000;
  const upload = await page.evaluate(() => (window as unknown as { __upload: { canvases: number; ms: number } }).__upload);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height,r_frame_rate:format=duration', '-of', 'json', file]).toString()) as
    { streams: { codec_type: string; codec_name: string; width?: number; height?: number; r_frame_rate: string }[]; format: { duration: string } };
  const v = probe.streams.find((s) => s.codec_type === 'video');
  expect(v, 'a video stream').toMatchObject({ codec_name: 'h264', width: 1080, height: 1920, r_frame_rate: '30/1' });
  expect(probe.streams.some((s) => s.codec_type === 'audio'), 'sound').toBe(true);
  expect(Math.abs(Number(probe.format.duration) - seconds)).toBeLessThan(0.2);
  return { seconds: took, canvasUploads: upload.canvases, uploadMsPerFrame: upload.ms / (seconds * 30) };
}

/** Grey pixels of the middle third of the frame at 15 s, 36×64 (where the overlay sits at its default 0.6). */
const middle = (file: string) => execFileSync('ffmpeg', ['-v', 'error', '-ss', '15', '-i', file, '-frames:v', '1', '-vf', 'crop=iw/3:ih/3,scale=36:64,format=gray', '-f', 'rawvideo', '-']);

test('a 4K overlay does not make the export slow; video frames reach WebGL without a 2D canvas on WebKit', async ({ page }, info) => {
  const OVERLAY = overlayFile(info.project.name);
  test.skip(![MAIN, OVERLAY].every((f) => fs.existsSync(fx(f))), 'needs npm run fixtures');
  test.setTimeout(600_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  let chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([fx(MAIN)]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Close tools' }).click();
  const plain = await exportVideo(page, info.outputPath('plain.mp4'));

  chooser = page.waitForEvent('filechooser');
  await tool(page, 'Overlay').click();
  await (await chooser).setFiles([fx(OVERLAY)]);
  await expect(page.locator('.tl-row.overlay .clip, .toast.error')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('.toast.error')).toHaveCount(0);
  const overlay = await exportVideo(page, info.outputPath('overlay.mp4'));

  console.log(`overlay export (${info.project.name}): ${plain.seconds.toFixed(1)} s plain, ${overlay.seconds.toFixed(1)} s with a 4K overlay `
    + `(${(overlay.seconds / plain.seconds).toFixed(2)}×); frames into WebGL ${plain.uploadMsPerFrame.toFixed(1)} and ${overlay.uploadMsPerFrame.toFixed(1)} ms per frame, `
    + `${plain.canvasUploads} and ${overlay.canvasUploads} through a canvas`);
  // The overlay is in the file: the middle of the frame is not the plain export's.
  const a = middle(info.outputPath('plain.mp4')), b = middle(info.outputPath('overlay.mp4'));
  expect(a.reduce((s, x, i) => s + Math.abs(x - b[i]), 0) / a.length, 'the overlay is drawn').toBeGreaterThan(8);
  if (info.project.name === 'iphone-webkit') {
    expect(plain.canvasUploads + overlay.canvasUploads, 'video frames copied from a 2D canvas into WebGL').toBe(0);
  }
  // Before (WebKit): ~39 ms per frame for the two layers, 2.4–5 ms after even on a loaded Mac; Chromium ~0.1 ms.
  expect(overlay.uploadMsPerFrame, 'time spent handing video frames to WebGL, ms per frame').toBeLessThan(15);
  // The export budget (CLAUDE.md §5: at least real time). Before: 44–122 s for these 30 s in WebKit; after: 8–27 s.
  expect(overlay.seconds, 'a 30 s project with a 4K overlay exports within its own length').toBeLessThan(30);
});

// Phone videos carry their turn in the file (a portrait iPhone video is stored on its side). WebKit turns the decoder
// frame upright in the compositor now, no longer through a 2D canvas: each of the four turns must come out upright.
test('a video stored turned by 0°, 90°, 180° or 270° comes out upright: the white mark at the top left', async ({ page }, info) => {
  const files = ['rotated_0.mp4', 'rotated.mp4', 'rotated_180.mp4', 'rotated_270.mp4']; // on the timeline 0–2, 2–6, 6–8, 8–10 s
  test.skip(!files.every((f) => fs.existsSync(fx(f))), 'needs npm run fixtures');
  test.setTimeout(240_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(files.map(fx));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(4, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Close tools' }).click();
  const file = info.outputPath('turns.mp4');
  const { canvasUploads } = await exportVideo(page, file, 10);
  if (info.project.name === 'iphone-webkit') expect(canvasUploads, 'video frames copied from a 2D canvas into WebGL').toBe(0);
  const rows: string[] = [];
  for (const [name, t] of [['0°', 1], ['90°', 4], ['180°', 7], ['270°', 9]] as const) {
    const frame = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'scale=90:160,format=gray', '-f', 'rawvideo', '-']);
    const at = (x: number, y: number) => frame[y * 90 + x];
    const black = Array.from({ length: 160 }, (_, y) => y).filter((y) => Array.from({ length: 90 }, (_, x) => at(x, y)).every((v) => v < 30)).length;
    rows.push(`${name}: top left ${at(8, 8)}, top right ${at(81, 8)}, bottom left ${at(8, 151)}, bottom right ${at(81, 151)}, black rows ${black}`);
    expect.soft(at(8, 8), `${name}: the mark is at the top left`).toBeGreaterThan(200);
    expect.soft(Math.max(at(81, 8), at(8, 151), at(81, 151)), `${name}: nowhere else`).toBeLessThan(170);
    expect.soft(black, `${name}: fills the frame`).toBeLessThan(4);
  }
  console.log(`turns (${info.project.name}):\n${rows.join('\n')}`);
});

// Insurance (docs/12 rule 10): should WebGL on some iPhone refuse a decoder frame of a format the 2×2 probe did not try
// (NV12, 10-bit), the frame is not lost: the export starts again with every video through a canvas, and the preview
// goes on through canvases too.
test('WebGL refuses decoder frames mid-export: the export starts again through canvases and the file is whole', async ({ page }, info) => {
  test.skip(info.project.name !== 'iphone-webkit', 'decoder frames go to WebGL only in WebKit');
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __refused: number };
    w.__refused = 0;
    const tex = WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D = function (this: WebGL2RenderingContext, ...a: unknown[]) {
      const src = a[a.length - 1];
      // The 2×2 probe passes; a real frame from the decoder is refused, as an untried format would be, and only by the
      // export's context (it keeps its drawing buffer): the preview takes them, so the export meets the refusal first.
      if (src instanceof VideoFrame && src.displayWidth > 2 && this.getContextAttributes()?.preserveDrawingBuffer) { w.__refused++; throw new DOMException('refused', 'InvalidStateError'); }
      return (tex as (...x: unknown[]) => void).apply(this, a);
    } as typeof tex;
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Close tools' }).click();
  const file = info.outputPath('refused.mp4');
  const { canvasUploads } = await exportVideo(page, file, 6);
  expect(await page.evaluate(() => (window as unknown as { __refused: number }).__refused), 'a decoder frame was refused, once: then canvases').toBe(1);
  expect(canvasUploads, 'the export went on through canvases').toBeGreaterThan(100);
  expect(await page.locator('.error-text, .toast.error').count(), 'no error shown').toBe(0);
  // Every second of the file has the picture (testsrc bars in the middle of the 9:16 frame), not an empty frame.
  for (const t of [0.2, 3, 5.8]) {
    const y = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-vf', 'crop=iw:ih/4,scale=32:32,format=gray', '-f', 'rawvideo', '-']);
    expect(y.reduce((s, v) => s + v, 0) / y.length, `the picture at ${t} s`).toBeGreaterThan(40);
  }
});
