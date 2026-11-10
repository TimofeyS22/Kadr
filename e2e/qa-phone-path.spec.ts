// The main path on a phone never stands still and never makes a silently broken file (docs/12 stage 2, G2–G3).
// Each test makes the browser misbehave the way phones do — the GPU resets mid-export, the encoder never answers,
// the network hangs mid-download, the recorder never says it stopped — and checks for a plain answer in time.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.use({ serviceWorkers: 'block' }); // routed requests must reach the test, not a service worker

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined });
  });
});

async function projectWith(page: Page, file: string) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([fx(file)]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
}

/** The export draws into a WebGL context of its own (preserveDrawingBuffer): each one is kept, to lose it on cue. */
const keepExportContexts = (page: Page) => page.addInitScript(() => {
  const native = HTMLCanvasElement.prototype.getContext;
  const kept: WebGL2RenderingContext[] = ((window as unknown as { __exportGl: WebGL2RenderingContext[] }).__exportGl = []);
  HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, type: string, opts?: { preserveDrawingBuffer?: boolean }) {
    const ctx = (native as (t: string, o?: unknown) => RenderingContext | null).call(this, type, opts);
    if (type === 'webgl2' && opts?.preserveDrawingBuffer && ctx) kept.push(ctx as WebGL2RenderingContext);
    return ctx;
  } as typeof native;
});
/** Once the export is past 20%, the GPU resets: the newest export context is lost. */
async function loseGpuMidExport(page: Page, round: number) {
  await expect.poll(() => page.evaluate(() => (window as unknown as { __exportGl: unknown[] }).__exportGl.length), { timeout: 60_000 }).toBeGreaterThanOrEqual(round);
  await expect(page.getByText(/\b([2-9]\d)% — keep this screen open/)).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => {
    const gl = (window as unknown as { __exportGl: WebGL2RenderingContext[] }).__exportGl.at(-1);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  })).toBe(true);
}
async function startVideoExport(page: Page) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
}

test('the GPU resets mid-export: the export starts again by itself and the file is whole, not empty frames', async ({ page }, info) => {
  test.setTimeout(300_000);
  await keepExportContexts(page);
  await projectWith(page, 'long_1.mp4');
  await startVideoExport(page);
  await loseGpuMidExport(page, 1);
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  await expect(page.locator('.error-text')).toHaveCount(0);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  const { execFileSync } = await import('node:child_process');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file]).toString()) as { streams: { codec_type: string }[]; format: { duration: string } };
  expect(probe.streams.map((x) => x.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Number(probe.format.duration)).toBeGreaterThan(10);
  // A frame from late in the file, made after the reset: the clip's picture, not an empty (black) frame.
  const y = Number(execFileSync('ffmpeg', ['-v', 'error', '-sseof', '-2', '-i', file, '-frames:v', '1', '-vf', 'scale=32:32,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }).reduce((a, b) => a + b, 0)) / 1024;
  expect(y).toBeGreaterThan(20); // the clip letterboxed in 9:16; an empty frame is the black background, ~0
});

test('the GPU keeps resetting: after one fresh start the export stops with a plain message', async ({ page }) => {
  test.setTimeout(300_000);
  await keepExportContexts(page);
  await projectWith(page, 'long_1.mp4');
  await startVideoExport(page);
  await loseGpuMidExport(page, 1);
  await loseGpuMidExport(page, 2); // the fresh start loses its context too
  await expect(page.locator('.error-text')).toContainText('The graphics of this device were reset during the export', { timeout: 60_000 });
  await expect(page.getByText(/Ready: .* MB/)).toHaveCount(0);
  await page.locator('.error-more summary').click(); // what support needs, kept on the device (docs/12 stage 4)
  await expect(page.locator('.error-more pre')).toContainText(/export: MediaError: The graphics of this device were reset/);
});

test('the video encoder never answers what it can do: sizes are still offered, and the export says why it cannot start', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => { VideoEncoder.isConfigSupported = () => new Promise(() => undefined); });
  await projectWith(page, 'photo.png');
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await expect(page.getByRole('radio', { name: '1080p' })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.locator('.error-text')).toContainText('did not say whether it can encode video', { timeout: 20_000 });
});

test('a music download that hangs: the reel is still made, says why the music is missing, and the screen is let go', async ({ page }) => {
  test.setTimeout(400_000);
  // Screen wake lock as a counter: held while the reel works, released after.
  await page.addInitScript(() => {
    const w = window as unknown as { __locks: { held: number; max: number } };
    w.__locks = { held: 0, max: 0 };
    Object.defineProperty(navigator, 'wakeLock', {
      value: { request: async () => { w.__locks.held++; w.__locks.max = Math.max(w.__locks.max, w.__locks.held); let on = true; return { release: async () => { if (on) { on = false; w.__locks.held--; } } }; } },
    });
  });
  await page.route(/\/music\/tracks\//, () => undefined); // never answered: the connection hangs
  await page.goto('./');
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /^Reel in 1 tap/ }).click();
  await (await chooser).setFiles(fx('reel_ru.mp4'));
  await page.getByRole('button', { name: 'Download and make the reel', exact: true }).click({ timeout: 60_000 }); // the question before the first model download (audit V-181)
  const done = page.locator('.reel-done');
  await expect(done).toBeVisible({ timeout: 300_000 });
  await expect(done).toContainText('Music was not added: Could not download the track');
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(0);
  const locks = await page.evaluate(() => (window as unknown as { __locks: { held: number; max: number } }).__locks);
  expect(locks.max).toBeGreaterThan(0);
  await expect.poll(() => page.evaluate(() => (window as unknown as { __locks: { held: number } }).__locks.held)).toBe(0);
});

test('a recorder that never says it stopped: the voice-over is still added', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async function () {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return dest.stream;
    };
    // Stops handing over data and never fires "stop", as a stuck WebKit recorder does.
    MediaRecorder.prototype.stop = function (this: MediaRecorder) { this.pause(); };
  });
  await projectWith(page, 'photo.png');
  await tool(page, 'Record').click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(1500);
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.locator('.tl-row.audio .clip')).toHaveCount(1, { timeout: 20_000 });
});

// ---------- v1.6: a video decoder the system takes back ("Decoder failure", the owner's error) ----------

/**
 * VideoDecoder on this page fails like an iPhone's when the system takes it back: `__decoderFail` decodes from now on
 * end with WebKit's own error ("Decoder failure", EncodingError) and the decoder is closed. `__decoded` counts frames.
 */
const breakableDecoder = (page: Page) => page.addInitScript(() => {
  const w = window as unknown as { __decoderFail: number; __decoded: number; __errors: string[] };
  w.__decoderFail = 0;
  w.__decoded = 0;
  // Error toasts go after a few seconds: every one shown is kept.
  w.__errors = [];
  new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => {
    if (!w.__errors.includes(el.textContent ?? '')) w.__errors.push(el.textContent ?? '');
  })).observe(document, { subtree: true, childList: true });
  const VD = window.VideoDecoder;
  if (!VD) return;
  window.VideoDecoder = class extends VD {
    private fail: (e: DOMException) => void;
    constructor(init: VideoDecoderInit) {
      super({ ...init, output: (f) => { w.__decoded++; init.output(f); } });
      this.fail = init.error;
    }
    decode(chunk: EncodedVideoChunk) {
      if (w.__decoderFail > 0 && this.state === 'configured') {
        w.__decoderFail--;
        // As WebCodecs does: the error callback with WebKit's words, then the codec is closed.
        queueMicrotask(() => { this.fail(new DOMException('Decoder failure', 'EncodingError')); try { this.close(); } catch { /* closed already */ } });
        return;
      }
      super.decode(chunk);
    }
  };
});
const decoderState = (page: Page) => page.evaluate(() => { const w = window as unknown as { __decoderFail: number; __decoded: number }; return { fail: w.__decoderFail, decoded: w.__decoded }; });

test('the video decoder fails mid-preview (iPhone "Decoder failure"): playback restarts it, no error is shown', async ({ page }) => {
  test.setTimeout(120_000);
  await breakableDecoder(page);
  await projectWith(page, 'long_1.mp4');
  await expect.poll(async () => (await decoderState(page)).decoded, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.evaluate(() => { (window as unknown as { __decoderFail: number }).__decoderFail = 1; });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => (await decoderState(page)).fail, { timeout: 20_000 }).toBe(0); // the failure happened
  const after = (await decoderState(page)).decoded;
  // Within a second the picture moves on: before v1.6 it froze until playback was 2.5 s past the last frame.
  await expect.poll(async () => (await decoderState(page)).decoded, { timeout: 1500, intervals: [100], message: 'frames decode again at once' }).toBeGreaterThan(after + 5);
  await page.waitForTimeout(2000);
  await page.getByRole('button', { name: 'Pause' }).click();
  // Before v1.6 the toast said "Decoder failure".
  expect(await page.evaluate(() => (window as unknown as { __errors: string[] }).__errors), 'error toasts').toEqual([]);
});

test('a decoder that keeps failing: one plain message, not one per frame', async ({ page }) => {
  test.setTimeout(120_000);
  await breakableDecoder(page);
  await projectWith(page, 'long_1.mp4');
  await expect.poll(async () => (await decoderState(page)).decoded, { timeout: 30_000 }).toBeGreaterThan(0);
  await page.evaluate(() => { (window as unknown as { __decoderFail: number }).__decoderFail = 1e9; });
  await page.getByRole('button', { name: 'Play' }).click();
  await expect(page.locator('.toast.error')).toContainText('The video decoder of this device stopped. Close other apps', { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.locator('.toast.error')).toHaveCount(1);
  await page.locator('.toast.error').getByRole('button', { name: 'Details' }).click(); // the browser's words, for support
  await expect(page.getByText(/MediaError: The video decoder of this device stopped.* — .*(Decoder failure|closed codec)/)).toBeVisible();
});

test('the video decoder fails mid-export: the export goes on and the file is whole', async ({ page }, info) => {
  test.setTimeout(300_000);
  await breakableDecoder(page);
  await projectWith(page, 'long_1.mp4');
  await startVideoExport(page);
  await expect(page.getByText(/\b([2-9]\d)% — keep this screen open/)).toBeVisible({ timeout: 120_000 });
  await page.evaluate(() => { (window as unknown as { __decoderFail: number }).__decoderFail = 1; });
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  expect((await decoderState(page)).fail, 'the failure happened during the export').toBe(0);
  await expect(page.locator('.error-text')).toHaveCount(0);
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  const { execFileSync } = await import('node:child_process');
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v', '-show_entries', 'stream=nb_read_frames:format=duration', '-of', 'json', file]).toString()) as { streams: { nb_read_frames: string }[]; format: { duration: string } };
  const src = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', fx('long_1.mp4')]).toString()) as { format: { duration: string } };
  expect(Math.abs(Number(probe.format.duration) - Number(src.format.duration))).toBeLessThan(0.2);
  expect(Number(probe.streams[0].nb_read_frames)).toBeGreaterThan(Number(src.format.duration) * 29);
  const y = Number(execFileSync('ffmpeg', ['-v', 'error', '-sseof', '-2', '-i', file, '-frames:v', '1', '-vf', 'scale=32:32,format=gray', '-f', 'rawvideo', '-'], { maxBuffer: 1 << 20 }).reduce((a, b) => a + b, 0)) / 1024;
  expect(y).toBeGreaterThan(20); // the picture, not the black background
});
