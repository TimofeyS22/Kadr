// Where H.264 High stalls on a device, the person still gets the file (audit V-259). Some phones take a High-profile
// configuration and then give nothing back, while their Constrained Baseline encoder works: the export ended with
// "The video encoder of this device stopped responding", and a lower resolution stalled the same way. Now the export
// starts again by itself, once, with Constrained Baseline at the same size and frame rate.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const pageErrors: string[] = [];

/** `waited`: seconds from the last frame a broken encoder took to the moment the export closed it. */
type Encoder = { codec: string; broken: boolean; fed: number; out: number; waited: number; state: string };
type Probe = { streams: { codec_type: string; codec_name: string; profile?: string; width?: number; height?: number; r_frame_rate?: string }[]; format: { duration: string } };

test.use({ serviceWorkers: 'block' });

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
    // Every percent the export showed, in order: a fresh start is a percent lower than the one before it.
    const seen: number[] = ((window as unknown as { __percents: number[] }).__percents = []);
    new MutationObserver(() => {
      const m = /(\d+)% — keep this screen open/.exec(document.querySelector('.export-progress p')?.textContent ?? '');
      if (m && seen.at(-1) !== Number(m[1])) seen.push(Number(m[1]));
    }).observe(document, { subtree: true, childList: true, characterData: true });
  });
});
test.afterEach(() => { expect(pageErrors, 'uncaught errors in the page').toEqual([]); });

/**
 * Breaks video encoders the two ways a phone's hardware encoder fails. `stall`: it takes its configuration, its queue
 * fills, no chunk ever reaches the output callback and a flush never ends. `refuse`: it answers the configuration
 * with an error and closes, as WebCodecs does when the hardware says no. `profiles`: `all` breaks every encoder;
 * `high` only those configured with H.264 High or Main (avc1.64…, avc1.4d…), Baseline (avc1.42…) stays the browser's own.
 */
async function breakEncoders(page: Page, how: 'stall' | 'refuse', profiles: 'high' | 'all') {
  await page.addInitScript(({ refuse, all }) => {
    type Rec = { codec: string; broken: boolean; fed: number; out: number; waited: number };
    const w = window as unknown as { VideoEncoder: typeof VideoEncoder; __encoders: { rec: Rec; encoder: VideoEncoder }[] };
    w.__encoders = [];
    const Real = w.VideoEncoder;
    w.VideoEncoder = class extends Real {
      private readonly rec: Rec;
      private readonly fail: (e: DOMException) => void;
      private lastFed = 0;
      constructor(init: VideoEncoderInit) {
        const rec: Rec = { codec: '', broken: false, fed: 0, out: 0, waited: 0 };
        super({ ...init, output: (chunk, meta) => { rec.out++; init.output(chunk, meta); } });
        this.rec = rec;
        this.fail = init.error;
        w.__encoders.push({ rec, encoder: this });
      }
      override configure(config: VideoEncoderConfig) {
        this.rec.codec = config.codec;
        this.rec.broken = all || /^avc1\.(64|4d)/i.test(config.codec);
        if (!this.rec.broken || !refuse) return super.configure(config);
        queueMicrotask(() => { super.close(); this.fail(new DOMException('Encoder initialization failed', 'NotSupportedError')); });
      }
      override encode(frame: VideoFrame, options?: VideoEncoderEncodeOptions) {
        if (!this.rec.broken) return super.encode(frame, options);
        this.rec.fed++; // taken and never encoded
        this.lastFed = performance.now();
      }
      override close() {
        if (this.lastFed && !this.rec.waited) this.rec.waited = (performance.now() - this.lastFed) / 1000;
        super.close();
      }
      override get encodeQueueSize() { return this.rec.broken && !refuse ? this.rec.fed : super.encodeQueueSize; }
      override flush() { return this.rec.broken && !refuse ? new Promise<void>(() => undefined) : super.flush(); }
    };
  }, { refuse: how === 'refuse', all: profiles === 'all' });
}
const encoders = (page: Page) => page.evaluate(() => (window as unknown as { __encoders: { rec: Omit<Encoder, 'state'>; encoder: VideoEncoder }[] }).__encoders
  .map((e): Encoder => ({ ...e.rec, state: e.encoder.state })));
const stallWait = (used: Encoder[]) => used.filter((e) => e.broken).map((e) => `${e.waited.toFixed(1)} s`).join(' and ');
const percents = (page: Page) => page.evaluate(() => (window as unknown as { __percents: number[] }).__percents);

async function startExport(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]); // 6 s, picture and a tone
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click(); // 720p30
  await page.getByRole('button', { name: 'Export video' }).click();
}
async function saved(page: Page, info: TestInfo, name: string) {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath(name);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}

/** The export ends with a whole Baseline file and no error, after High failed once where High is the default. */
async function endsWithBaselineFile(page: Page, info: TestInfo, how: 'stall' | 'refuse') {
  await breakEncoders(page, how, 'high');
  await startExport(page);
  // A stall is waited out (20 s in the exporter) before the fresh start.
  await expect(page.locator('.export-progress').getByText(/Ready: .* MB|Export failed/)).toBeVisible({ timeout: 120_000 });
  const used = await encoders(page);
  const shown = await percents(page);
  console.log(`encoder fallback, ${how} (${info.project.name}): ${used.map((e) => `${e.codec} ${e.broken ? `broken, took ${e.fed} frames` : `${e.out} packets`}`).join('; ')}; percents ${shown.join(' ')}`);
  await expect(page.locator('.error-text, .toast.error'), 'no error shown').toHaveCount(0);
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible();

  const file = await saved(page, info, `${how}.mp4`);
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,r_frame_rate:format=duration', '-of', 'json', file]).toString()) as Probe;
  expect(probe.streams.map((s) => s.codec_type).sort(), 'picture and sound').toEqual(['audio', 'video']);
  expect(Math.abs(Number(probe.format.duration) - 6), 'the whole 6 s').toBeLessThan(0.15);
  const v = probe.streams.find((s) => s.codec_type === 'video');
  // The same size and frame rate as asked for; only the profile gave way.
  expect(v, 'the video stream').toMatchObject({ codec_name: 'h264', width: 1280, height: 720, r_frame_rate: '30/1' });
  expect(v?.profile, 'the H.264 profile of the file').toMatch(/Baseline/);
  // The middle of the file has the picture (testsrc), not an empty frame.
  const y = execFileSync('ffmpeg', ['-v', 'error', '-ss', '3', '-i', file, '-frames:v', '1', '-vf', 'scale=32:32,format=gray', '-f', 'rawvideo', '-']);
  expect(y.reduce((s, x) => s + x, 0) / y.length, 'the picture at 3 s').toBeGreaterThan(40);

  const last = used.at(-1);
  expect(last?.codec, 'the file came from a Baseline encoder').toMatch(/^avc1\.42/i);
  expect(last?.out, 'which gave its packets').toBeGreaterThan(150);
  expect(used.filter((e) => e.state !== 'closed'), 'no encoder is left open').toEqual([]);
  if (info.project.name === 'android-chromium') {
    // Chromium starts with High: it really failed, once, and the percent went back to the start, once.
    expect(used.map((e) => e.broken), 'High failed, then Baseline').toEqual([true, false]);
    expect(used[0].codec).toMatch(/^avc1\.64/i);
    expect(used[0].fed, 'frames the broken encoder took').toBeGreaterThan(0);
    const drops = shown.flatMap((p, i) => (i > 0 && p < shown[i - 1] ? [p] : []));
    expect(drops, 'the progress started again from the beginning').toEqual([0]);
  } else {
    // WebKit: Mediabunny asks for Constrained Baseline from the first frame there (its workaround for an encoder that
    // stalls with High, WebKit PR 74602), so nothing fails and nothing starts again.
    expect(used.map((e) => e.broken), 'Baseline from the start').toEqual([false]);
  }
}

test('H.264 High gives nothing back: the export starts again with Baseline by itself and the file is whole', async ({ page }, info) => {
  test.setTimeout(180_000);
  await endsWithBaselineFile(page, info, 'stall');
});

test('H.264 High is refused when the encoder is configured: the export starts again with Baseline and the file is whole', async ({ page }, info) => {
  test.setTimeout(180_000);
  await endsWithBaselineFile(page, info, 'refuse');
});

test('every H.264 profile stalls: the export ends with the plain message in bounded time, and nothing is left hanging', async ({ page }, info) => {
  test.setTimeout(180_000);
  await breakEncoders(page, 'stall', 'all');
  await startExport(page);
  const started = Date.now();
  // Two stalls of 20 s (High, then Baseline) and the fresh start between them; one stall where Baseline is the default.
  await expect(page.locator('.error-text', { hasText: /video encoder of this device stopped responding/ })).toBeVisible({ timeout: 90_000 });
  const took = (Date.now() - started) / 1000;
  const used = await encoders(page);
  console.log(`every profile stuck (${info.project.name}): ended in ${took.toFixed(1)} s; ${used.map((e) => `${e.codec} took ${e.fed} frames`).join('; ')}; given up after ${stallWait(used)}`);
  await expect(page.getByText(/Ready: .* MB/)).toHaveCount(0);
  expect(used.every((e) => e.broken && e.fed > 0), 'every encoder really stalled').toBe(true);
  // The bound, by its cause: each encoder is given up 20 s after its last frame (the check runs once a second), so the
  // wait is one or two of those however busy the machine is; the time from the click is in the line above.
  for (const e of used) {
    expect(e.waited, `${e.codec}: seconds of silence before it was given up`).toBeGreaterThan(15);
    expect(e.waited, `${e.codec}: seconds of silence before it was given up`).toBeLessThan(30);
  }
  // Baseline is tried once and no more: High then Baseline in Chromium, Baseline alone in WebKit.
  expect(used.map((e) => e.codec.slice(0, 7).toLowerCase())).toEqual(info.project.name === 'android-chromium' ? ['avc1.64', 'avc1.42'] : ['avc1.42']);
  // The stuck encoders are closed, not left holding their frames and the hardware (CLAUDE.md: resources released).
  await expect.poll(async () => (await encoders(page)).filter((e) => e.state !== 'closed').length).toBe(0);
  // The sheet is usable: the person can go back and try again.
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Export video' })).toBeEnabled();
});
