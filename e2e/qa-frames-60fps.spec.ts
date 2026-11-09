// Decoded frames on phone footage (audit V-241). A phone records 60 fps and the export runs at 30, so every other decoded
// frame is skipped and has to be released on the spot. The older check uses 30 fps files, where that branch barely runs.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  });
});

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'canShare', { value: undefined })); // headless WebKit has no share sheet
});

/** Counts VideoFrames made on the page (constructed, decoded, cloned) and closed: `made - closed` are still open. */
async function countFrames(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as { __frames: { made: number; closed: number; decoded: number } };
    w.__frames = { made: 0, closed: 0, decoded: 0 };
    const VF = window.VideoFrame;
    if (!VF) return;
    const closed = new WeakSet<VideoFrame>();
    const { close, clone } = VF.prototype;
    VF.prototype.close = function (this: VideoFrame) { if (!closed.has(this)) { closed.add(this); w.__frames.closed++; } close.call(this); };
    VF.prototype.clone = function (this: VideoFrame) { w.__frames.made++; return clone.call(this); };
    // A wrapper with the same prototype: `instanceof VideoFrame` stays true for frames the decoder makes.
    const Counted = function (...a: ConstructorParameters<typeof VideoFrame>) { w.__frames.made++; return new VF(...a); } as unknown as typeof VideoFrame;
    Counted.prototype = VF.prototype;
    window.VideoFrame = Counted;
    const VD = window.VideoDecoder;
    if (VD) window.VideoDecoder = class extends VD {
      constructor(init: VideoDecoderInit) { super({ ...init, output: (f) => { w.__frames.made++; w.__frames.decoded++; init.output(f); } }); }
    };
  });
  return () => page.evaluate(() => (window as unknown as { __frames: { made: number; closed: number; decoded: number } }).__frames);
}

async function exportVideo(page: Page, info: TestInfo) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 180_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  await (await dl).saveAs(info.outputPath('out.mp4'));
  await page.getByRole('button', { name: 'Done' }).click();
}

test('a 60 fps file exported at 30 fps: the skipped frames are released, nothing grows from one export to the next', async ({ page }, info) => {
  test.setTimeout(360_000);
  test.skip(!fs.existsSync(fx('fps60.mp4')), 'needs npm run fixtures');
  const frames = await countFrames(page);
  // Mediabunny closes what the garbage collector finds and says so: on Chromium that hides a leak from the counts above.
  const collected: string[] = [];
  page.on('console', (m) => { if (/garbage collected without first being closed/.test(m.text())) collected.push(m.text()); });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('fps60.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Pause' }).click();
  await exportVideo(page, info);
  await page.waitForTimeout(2000);
  const one = await frames();
  await exportVideo(page, info);
  await page.waitForTimeout(2000);
  const two = await frames();
  console.log(`60 fps VideoFrames (${info.project.name}): after export 1 made ${one.made}, open ${one.made - one.closed}; after export 2 made ${two.made}, decoded ${two.decoded - one.decoded} in it, open ${two.made - two.closed}`);
  // 360 source frames in 6 s at 60 fps, 180 of them are drawn: fewer decoded would mean the skipping branch did not run.
  expect(two.decoded - one.decoded, 'the second export decodes the frames it skips').toBeGreaterThan(330);
  expect(two.made - two.closed, 'frames still open').toBeLessThanOrEqual(24);
  expect((two.made - two.closed) - (one.made - one.closed), 'open frames grow with each export').toBeLessThanOrEqual(1);
  expect(collected, 'samples left to the garbage collector').toEqual([]);
});
