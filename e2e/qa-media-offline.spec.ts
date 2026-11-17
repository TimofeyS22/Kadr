// docs/11 §3.13 for the media rows of the QA matrix (Q-4 backup, Q-5 import, Q-6 phone codecs, Q-9 scrubbing,
// Q-27 camera): after the first visit, with the network gone, a file goes in, the playhead finds its frame, a camera
// take is recorded, the video exports and a backup goes out and comes back. "works offline after the first visit"
// (editor.spec.ts) proves a photo export of a project made online; this is the whole media path made offline.
// The network is taken away through a local proxy on both engines (e2e/network.ts); Chromium is also told it is
// offline (WebKit's emulation would block the page's own Blobs, which a phone without a network does not do).
import { expect } from '@playwright/test';
import { switchableNetwork } from './network';
import { closeTools, counterAt, errorToasts, exportAs, importFiles, previewShot, probe, watch, test } from './qa-media-kit';

test('with no network after the first visit: an import, a scrub, a camera take, a video export and a backup round trip (QA matrix Q-4, Q-5, Q-6, Q-9, Q-27, §3.13)', async ({ page, context, baseURL, browserName }, info) => {
  test.setTimeout(420_000);
  const privateCheck = await watch(page);
  await page.addInitScript(() => {
    // A synthetic camera: a picture that changes and a tone.
    MediaDevices.prototype.getUserMedia = async function (want?: MediaStreamConstraints) {
      const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const g = c.getContext('2d')!;
      let f = 0;
      setInterval(() => { g.fillStyle = `hsl(${(f++ * 7) % 360} 70% 50%)`; g.fillRect(0, 0, 640, 360); }, 33);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return new MediaStream([...(want?.video ? c.captureStream(30).getVideoTracks() : []), ...dest.stream.getAudioTracks()]);
    };
  });
  const net = await switchableNetwork(baseURL!);
  try {
    await page.goto(net.url);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); // controlled by the service worker
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    net.off();
    if (browserName === 'chromium') await context.setOffline(true);
    await page.reload();

    const main = page.locator('.tl-row.main .clip');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    // Import: a video, a photo and an iPhone 16+ video (a 4-channel track before the stereo one).
    await importFiles(page, 'Media', ['counter.mp4', 'photo.png', 'iphone_spatial.mov']);
    await expect(main).toHaveCount(3, { timeout: 60_000 });
    await closeTools(page);
    // Scrub: the exact frame 75 of the counter.
    await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 75.5 * 2; });
    expect(counterAt(await previewShot(page, info, 'offline-scrub')), 'the frame under the playhead').toBe(75);
    // A camera take at the end.
    await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = el.scrollWidth; });
    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 });
    await page.waitForTimeout(1500);
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(main).toHaveCount(4, { timeout: 30_000 });
    await closeTools(page);
    // The video: all four, with sound, the counter's frames where they belong.
    const total = await main.evaluateAll((els) => els.reduce((s, e) => s + e.getBoundingClientRect().width / 60, 0));
    const video = await exportAs(page, info, 'Video', 'Export video');
    const pr = probe(video);
    expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(Math.abs(Number(pr.format.duration) - total)).toBeLessThan(0.15);
    expect(counterAt(video, 75)).toBe(75);
    // A backup goes out and comes back as a project with the same clips.
    await page.waitForTimeout(1500); // autosave
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const name = (await page.locator('.project-open').first().getAttribute('aria-label'))!.replace(/^Open /, '');
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: `Save a backup of ${name}`, exact: true }).click();
    const backup = info.outputPath('offline.kadr');
    await (await dl).saveAs(backup);
    const chooser = page.waitForEvent('filechooser');
    await page.getByRole('button', { name: 'Restore backup' }).click();
    await (await chooser).setFiles(backup);
    await expect(main).toHaveCount(4, { timeout: 60_000 });
    expect(await errorToasts(page), 'error toasts').toEqual([]);
    privateCheck();
  } finally {
    await context.setOffline(false);
    await net.close();
  }
});
