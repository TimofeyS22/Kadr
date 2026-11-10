// What an export starts with (audit V-216). The defaults were constants, 30 fps and 1080p: a 60 fps video lost every second
// frame and a 720p one was blown up, both without a word. Here nothing is picked unless the test says so, and the saved
// file is measured with ffprobe: its frames are counted, not read from the header.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const chip = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });
const pageErrors: string[] = [];

const LOSS = /The video is 60 fps: at 30 every second frame is dropped/;
const NO_60 = /This device cannot encode this size at 60 fps/;
const LARGER = /Larger than the source: the file grows, the picture does not get sharper/;

test.beforeEach(async ({ page }) => {
  pageErrors.length = 0;
  page.on('pageerror', (e) => pageErrors.push(e.message));
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    if (!localStorage.getItem('kadr.locale')) localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.iosFormatCard.v1', '1');
    // Quick export off and nothing else: no size, no frame rate. What the sheet starts with is what is tested.
    if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
});
test.afterEach(() => { expect(pageErrors, 'uncaught errors in the page').toEqual([]); });

async function openWith(page: Page, aspect: '9:16' | '16:9', files: string[]) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: aspect }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(files.map(fx));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(files.length);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
}

/** The export sheet on Video, after the encoder has said what it can do (the sizes are offered only then). */
async function openSheet(page: Page) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await chip(page, 'Video').click();
  await expect(chip(page, '720p')).toBeVisible();
}

async function saveExport(page: Page, info: TestInfo, name: string) {
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 180_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const got = await dl;
  const file = info.outputPath(name + path.extname(got.suggestedFilename()));
  await got.saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}

/** The picture of a saved file: frames really in it, its short side, frames per second of its length. */
function measure(file: string) {
  const out = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-count_frames', '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', file]).toString()) as {
    streams: { width: number; height: number; nb_read_frames: string }[]; format: { duration: string };
  };
  const s = out.streams[0];
  const frames = Number(s.nb_read_frames), duration = Number(out.format.duration);
  return { frames, side: Math.min(s.width, s.height), long: Math.max(s.width, s.height), duration, fps: frames / duration };
}

const savedPrefs = (page: Page) => page.evaluate(() => JSON.parse(localStorage.getItem('kadr.exportPrefs') ?? '{}') as { size?: number; resolution?: number });

/** The frame rates the app measured for the files of the open project, in the order of the main track. */
const storedFps = (page: Page) => page.evaluate(async () => {
  const id = /#\/p\/([\w-]+)/.exec(location.hash)![1];
  const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  const p = await new Promise<{ tracks: { kind: string; clips: { assetId: string }[] }[]; assets: Record<string, { fps?: number }> } | undefined>((res) => { const r = db.transaction('kv').objectStore('kv').get(`p:${id}`); r.onsuccess = () => res(r.result); });
  db.close();
  return p?.tracks.find((t) => t.kind === 'main')!.clips.map((c) => p.assets[c.assetId].fps ?? null) ?? [];
});

test('a 4K video starts at 1080p, and 4K is one tap away (owner, 2026-11-11)', async ({ page }) => {
  test.setTimeout(120_000);
  await openWith(page, '16:9', ['phone_4k_h264.mp4']);
  await openSheet(page);
  // On an iPhone 15 30 s of 4K60 took 48 s and 154 MB, 1080p60 22 s and 31 MB; social networks show 1080p.
  await expect(chip(page, '1080p'), 'what the sheet starts with for a 4K video').toBeChecked();
  await expect(page.getByText(LARGER)).toHaveCount(0);
  const uhd = chip(page, '4K');
  test.skip(!(await uhd.count()), 'this engine does not encode 4K: nothing more to see');
  await uhd.click();
  await expect(uhd).toBeChecked();
  await expect(page.getByText(LARGER), '4K is the video\'s own size').toHaveCount(0);
});

test('the export takes the codec that encodes the frame rate the sheet offered, not only the size (D-13)', async ({ page }, info) => {
  test.setTimeout(240_000);
  // An encoder with a ceiling of pixels a second: H.264 refuses 50 fps and more at any size, VP9 takes it. The sheet
  // offers 60 because it asks every codec at 60; the export asked without the rate, took H.264 and was refused.
  await page.addInitScript(() => {
    if (typeof VideoEncoder !== 'function') return;
    const fast = (c: VideoEncoderConfig) => c.codec.startsWith('avc1') && (c.framerate ?? 0) >= 50;
    const real = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = (c) => (fast(c) ? Promise.resolve({ supported: false, config: c }) : real(c));
    const configure = VideoEncoder.prototype.configure;
    VideoEncoder.prototype.configure = function (this: VideoEncoder, c: VideoEncoderConfig) {
      if (fast(c)) throw new DOMException('H.264 at this frame rate is not supported', 'NotSupportedError');
      return configure.call(this, c);
    };
  });
  await openWith(page, '9:16', ['fps60.mp4']);
  await openSheet(page);
  test.skip(!(await chip(page, '60').isChecked()), 'this engine has no other codec at 60 fps: the sheet does not offer it');
  const file = await saveExport(page, info, 'fps60-other-codec');
  const m = measure(file);
  console.log(`60 fps with H.264 refusing 60 (${info.project.name}): ${path.extname(file)} ${m.frames} frames = ${m.fps.toFixed(1)} fps`);
  expect(path.extname(file), 'another codec than H.264').toBe('.webm');
  expect(m.frames, '360 source frames, none dropped').toBeGreaterThanOrEqual(356);
  expect(Math.round(m.fps)).toBe(60);
});

test('a 60 fps video is exported at 60 fps and at its own size when nothing is picked', async ({ page }, info) => {
  test.setTimeout(240_000);
  await openWith(page, '9:16', ['fps60.mp4']);
  await openSheet(page);
  await expect(chip(page, '60'), 'the frame rate of the video').toBeChecked();
  await expect(chip(page, '720p'), 'the size of the video').toBeChecked();
  await expect(page.getByText(LOSS)).toHaveCount(0);
  await expect(page.getByText(LARGER)).toHaveCount(0);
  const m = measure(await saveExport(page, info, 'fps60'));
  console.log(`default export of fps60.mp4 (${info.project.name}): ${m.frames} frames in ${m.duration.toFixed(2)} s = ${m.fps.toFixed(1)} fps, ${m.side}x${m.long}`);
  expect(m.frames, '360 source frames, none dropped').toBeGreaterThanOrEqual(356);
  expect(m.frames).toBeLessThanOrEqual(364);
  expect(Math.round(m.fps)).toBe(60);
  expect([m.side, m.long], '720x1280 in, 720x1280 out').toEqual([720, 1280]);
  expect((await savedPrefs(page)).size, 'a size nobody picked is not remembered as a choice').toBeUndefined();
});

test('a 30 fps 720p video stays 30 fps and 720p: nothing is inflated', async ({ page }, info) => {
  test.setTimeout(240_000);
  await openWith(page, '16:9', ['landscape.mp4']);
  await openSheet(page);
  await expect(chip(page, '30')).toBeChecked();
  await expect(chip(page, '720p'), 'not blown up to 1080p').toBeChecked();
  await expect(page.getByText(LARGER)).toHaveCount(0);
  await expect(page.getByText(/frame is dropped|frames are dropped/)).toHaveCount(0);
  const m = measure(await saveExport(page, info, 'landscape'));
  console.log(`default export of landscape.mp4 (${info.project.name}): ${m.frames} frames in ${m.duration.toFixed(2)} s = ${m.fps.toFixed(1)} fps, ${m.long}x${m.side}`);
  expect(m.frames).toBeGreaterThanOrEqual(178);
  expect(m.frames).toBeLessThanOrEqual(182);
  expect(Math.round(m.fps)).toBe(30);
  expect([m.long, m.side]).toEqual([1280, 720]);
});

test('quick export follows the same rule: one tap gives 60 fps at the size of the video', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: true })));
  await openWith(page, '9:16', ['fps60.mp4']);
  const dl = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Export' }).first().click();
  // Android and desktop download by themselves; iPhone gets one Save button.
  if (info.project.name === 'iphone-webkit') await page.getByRole('button', { name: 'Save', exact: true }).click({ timeout: 180_000 });
  const got = await dl;
  const file = info.outputPath('quick' + path.extname(got.suggestedFilename()));
  await got.saveAs(file);
  const m = measure(file);
  console.log(`quick export of fps60.mp4 (${info.project.name}): ${m.frames} frames = ${m.fps.toFixed(1)} fps, ${m.side}x${m.long}`);
  expect(m.frames).toBeGreaterThanOrEqual(356);
  expect(m.frames).toBeLessThanOrEqual(364);
  expect([m.side, m.long]).toEqual([720, 1280]);
});

test('lowering 60 to 30 says what is lost, a larger size says it gains nothing, and the file then has 30 fps', async ({ page }, info) => {
  test.setTimeout(240_000);
  await openWith(page, '9:16', ['fps60.mp4']);
  await openSheet(page);
  await expect(chip(page, '60')).toBeChecked();
  await chip(page, '1080p').click();
  await expect(page.getByText(LARGER)).toBeVisible();
  await chip(page, '720p').click();
  await expect(page.getByText(LARGER)).toHaveCount(0);
  await chip(page, '30').click();
  await expect(page.getByText(LOSS)).toBeVisible();
  await expect(page.getByText(NO_60), 'the encoder was not the reason').toHaveCount(0);
  await chip(page, '60').click();
  await expect(page.getByText(LOSS)).toHaveCount(0);
  await chip(page, '30').click();
  const m = measure(await saveExport(page, info, 'lowered'));
  console.log(`fps60.mp4 exported at 30 by choice (${info.project.name}): ${m.frames} frames = ${m.fps.toFixed(1)} fps, ${m.side}x${m.long}`);
  expect(m.frames).toBeGreaterThanOrEqual(178);
  expect(m.frames).toBeLessThanOrEqual(182);
  expect([m.side, m.long]).toEqual([720, 1280]);
  // 1080p was tapped and then the video's own size again: that is no wish for another size.
  expect((await savedPrefs(page)).size).toBeUndefined();
  // The frame rate is this export's choice, not a setting: the next one starts from the video again.
  await openSheet(page);
  await expect(chip(page, '60')).toBeChecked();
});

test('an encoder that refuses 60 fps: the export stays at 30 and the sheet says why', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.addInitScript(() => {
    const real = VideoEncoder.isConfigSupported.bind(VideoEncoder);
    VideoEncoder.isConfigSupported = async (c) => ((c.framerate ?? 0) >= 50 ? { supported: false, config: c } : real(c));
  });
  await openWith(page, '9:16', ['fps60.mp4']);
  await openSheet(page);
  await expect(chip(page, '30'), 'the encoder was asked, not assumed').toBeChecked();
  await expect(chip(page, '720p')).toBeChecked();
  await expect(page.getByText(LOSS), 'the loss is said').toBeVisible();
  await expect(page.getByText(NO_60), 'and the reason').toBeVisible();
  const m = measure(await saveExport(page, info, 'no60'));
  console.log(`fps60.mp4 with an encoder that refuses 60 (${info.project.name}): ${m.frames} frames = ${m.fps.toFixed(1)} fps`);
  expect(m.frames).toBeGreaterThanOrEqual(178);
  expect(m.frames).toBeLessThanOrEqual(182);
});

test('a size picked by hand is used and remembered, but does not inflate the next export by itself', async ({ page }, info) => {
  test.setTimeout(240_000);
  await openWith(page, '16:9', ['landscape.mp4']);
  await openSheet(page);
  await expect(chip(page, '720p')).toBeChecked();
  await chip(page, '1080p').click();
  await expect(page.getByText(LARGER)).toBeVisible();
  const m = measure(await saveExport(page, info, 'picked'));
  expect([m.long, m.side], 'the choice made in the sheet is the file').toEqual([1920, 1080]);
  expect((await savedPrefs(page)).size).toBe(1080);
  await openSheet(page);
  await expect(chip(page, '720p'), 'the remembered 1080p does not blow up a 720p video').toBeChecked();
  await expect(page.getByText(LARGER)).toHaveCount(0);
});

test('a remembered size: the one every earlier version stored is not a choice; a smaller one picked by hand is kept', async ({ page }) => {
  // Before V-216 every export stored `resolution`, picked or not: 1080 there must not hold a 720p video up, nor a larger one down.
  await page.addInitScript(() => localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false, resolution: 1080 })));
  await openWith(page, '9:16', ['fps60.mp4']);
  await openSheet(page);
  await expect(chip(page, '720p')).toBeChecked();
  await page.getByRole('button', { name: 'Done' }).click();

  await page.addInitScript(() => localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false, size: 720 })));
  await openWith(page, '16:9', ['phone_1080_h264.mp4']);
  await openSheet(page);
  await expect(chip(page, '720p'), 'smaller files were asked for').toBeChecked();
  await expect(page.getByText(LARGER)).toHaveCount(0);
});

test('a 1080p video starts at 1080p', async ({ page }) => {
  await openWith(page, '16:9', ['phone_1080_h264.mp4']);
  await openSheet(page);
  await expect(chip(page, '1080p')).toBeChecked();
  await expect(chip(page, '30')).toBeChecked();
});

test('a variable frame rate file counts as the rate most of its frames follow each other at', async ({ page }) => {
  // vfr.mp4: 2 s at 30 fps, 2 s at 15, 2 s at 60. 120 of its 209 frames are about 1/60 s apart (the encoder's time base
  // moves them a little: the median is 57); the average, 35, describes no part of it.
  await openWith(page, '16:9', ['vfr.mp4', 'landscape.mp4']);
  await expect.poll(async () => (await storedFps(page)).length, { message: 'the project is stored' }).toBe(2);
  const [vfr, plain] = await storedFps(page);
  console.log(`measured frame rates: vfr.mp4 ${vfr}, landscape.mp4 ${plain}`);
  expect(plain).toBe(30);
  expect(vfr, 'the rate of most frames, not the average of 35').toBeGreaterThan(50);
  expect(vfr).toBeLessThanOrEqual(60);
  await openSheet(page);
  await expect(chip(page, '60'), 'one fast video among the pieces is enough: none of them loses frames').toBeChecked();
  await chip(page, '30').click();
  await expect(page.getByText(new RegExp(`The video is ${Math.round(vfr!)} fps: at 30 (every second frame is|some of its frames are) dropped`))).toBeVisible();
});

for (const locale of ['en', 'ru'] as const) {
  test(`at 375 px (${locale}) both notes fit: nothing scrolls sideways`, async ({ page }, info) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await page.addInitScript((l) => localStorage.setItem('kadr.locale', l), locale);
    const ru = locale === 'ru';
    await page.goto('./');
    await page.getByRole('button', { name: ru ? 'Новый проект' : 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible();
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: ru ? 'Медиа' : 'Media', exact: true }).click();
    await (await chooser).setFiles(fx('fps60.mp4'));
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await page.getByRole('button', { name: ru ? 'Экспорт' : 'Export' }).first().click();
    await chip(page, ru ? 'Видео' : 'Video').click();
    await chip(page, '1080p').click();
    await chip(page, '30').click();
    const notes = [page.getByText(ru ? /каждый второй кадр/ : LOSS), page.getByText(ru ? /Больше исходника/ : LARGER)];
    for (const n of notes) {
      await n.scrollIntoViewIfNeeded();
      await expect(n).toBeVisible();
      const box = (await n.boundingBox())!;
      expect(box.x, 'inside the screen on the left').toBeGreaterThanOrEqual(0);
      expect(box.x + box.width, 'inside the screen on the right').toBeLessThanOrEqual(375);
      expect(await n.evaluate((e) => e.scrollWidth <= e.clientWidth), 'no word is cut').toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'the page does not scroll sideways').toBe(true);
    expect(await page.locator('.sheet-body').evaluate((e) => e.scrollWidth <= e.clientWidth), 'the sheet does not scroll sideways').toBe(true);
    await page.screenshot({ path: info.outputPath(`notes-${locale}.png`) });
  });
}
