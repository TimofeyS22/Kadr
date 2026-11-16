// QA matrix Q-27, the camera with a teleprompter. docs/11 §3.1 (to the file) and §3.5 (edges). What is already proven:
// a take reaches the file with sound, mirrored, and frame for frame as the preview showed it (editor.spec.ts); a take
// is stored as its own bytes (qa-media-take); a crash brings it back (V-250); a recorder that gives nothing is said to
// (S-1-12). Here: a double tap on Record, a half-second take, two takes in a row, a long script, a take after a speed
// change — each one reaching the file; a refused camera; the camera at 375 px. The system Back or Esc in the middle of
// a take is SW-A-11 (another session). The camera is synthetic: a real one is for the phone (L5).
import { expect, type Page } from '@playwright/test';
import { closeTools, counterAt, errorToasts, exportAs, importFiles, mainNames, newProject, probe, selectClip, tool, watch, test } from './qa-media-kit';

/**
 * A synthetic camera: every picture carries its own number (eight stripes, white for a 1 bit, read by counterAt), plus
 * a tone. The k-th camera opened starts its numbers at 64·k, so takes from different openings tell apart.
 */
const fakeCamera = () => {
  const w = window as unknown as { __tracks: MediaStreamTrack[]; __opened: number };
  w.__tracks = []; w.__opened = 0;
  MediaDevices.prototype.getUserMedia = async function (want?: MediaStreamConstraints) {
    const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
    const g = c.getContext('2d')!;
    let n = (w.__opened++ * 64) % 256;
    const draw = () => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
      g.fillStyle = '#fff';
      for (let k = 0; k < 8; k++) if ((n >> k) & 1) g.fillRect(k * 80, 0, 80, 360);
      n = (n + 1) % 256;
    };
    draw();
    setInterval(draw, 33);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    const s = new MediaStream([...(want?.video ? c.captureStream(30).getVideoTracks() : []), ...dest.stream.getAudioTracks()]);
    w.__tracks.push(...s.getTracks());
    return s;
  };
};

let privateCheck: () => void;
test.beforeEach(async ({ page }) => {
  privateCheck = await watch(page);
  await page.addInitScript(fakeCamera);
});
test.afterEach(async ({ page }) => {
  privateCheck();
  expect(await errorToasts(page), 'error toasts').toEqual([]);
});

const start = (page: Page) => page.getByRole('button', { name: 'Start recording' });
const stop = (page: Page) => page.getByRole('button', { name: 'Stop recording' });
const released = (page: Page) => page.evaluate(() => (window as unknown as { __tracks: MediaStreamTrack[] }).__tracks.every((tr) => tr.readyState === 'ended'));
const pieces = async (page: Page) => (await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const req = open.result.transaction('kv').objectStore('kv').getAllKeys();
    req.onsuccess = () => { open.result.close(); resolve((req.result as IDBValidKey[]).map(String).filter((k) => k.startsWith('t:'))); };
    req.onerror = () => reject(req.error);
  };
}))).length;

/** Records a take of about `ms` and waits for it on the main track. */
async function take(page: Page, ms: number, clips: number) {
  await tool(page, 'Camera').click();
  await start(page).click();
  await expect(stop(page)).toBeVisible({ timeout: 10_000 }); // after 3-2-1
  await page.waitForTimeout(ms);
  await stop(page).click();
  await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(clips, { timeout: 30_000 });
  await closeTools(page);
}

test('camera edges: a double tap on Record is a countdown called off; a half-second take, two takes in a row and a take after a speed change all reach the file, in order; a long script scrolls (QA matrix Q-27)', async ({ page }, info) => {
  test.setTimeout(420_000);
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);

  // A double tap on Record: the second tap is on the same spot, which now calls the countdown off.
  await tool(page, 'Camera').click();
  await start(page).dblclick();
  await expect(start(page)).toBeVisible();
  await page.waitForTimeout(4500);
  await expect(stop(page), 'no take started').toHaveCount(0);
  // A long script (2 000 words) that starts with markup: shown as the text it is (docs/11 §3.15), and it scrolls.
  const markup = '<img src=x onerror="window.__xss=1"><b>bold</b>';
  await page.getByRole('button', { name: 'Edit script' }).click();
  await page.getByRole('textbox', { name: 'Script' }).fill([markup, ...Array.from({ length: 400 }, (_, i) => `Line ${i}: one two three four.`)].join('\n'));
  await page.getByRole('button', { name: 'Edit script' }).click();
  await start(page).click();
  await expect(stop(page)).toBeVisible({ timeout: 10_000 });
  await expect(page.getByLabel('Teleprompter')).toContainText('Line 0:');
  await expect(page.getByLabel('Teleprompter')).toContainText(markup);
  expect(await page.getByLabel('Teleprompter').locator('img, b').count(), 'no markup of the script became elements').toBe(0);
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss), 'no script of the text ran').toBeUndefined();
  await page.waitForTimeout(500);
  await stop(page).click(); // a take of half a second
  await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(1, { timeout: 30_000 });
  expect(await released(page), 'the camera is let go').toBe(true);
  await closeTools(page);

  // Two more takes in a row, the playhead at the end each time: each lands after the one before.
  const toEnd = async () => { await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = el.scrollWidth; }); await page.waitForTimeout(500); };
  await toEnd();
  await take(page, 1500, 2);
  await toEnd();
  await take(page, 2500, 3);
  const names = await mainNames(page);
  const lengths = await main.evaluateAll((els) => els.map((e) => e.getBoundingClientRect().width / 60));
  console.log(`takes (${info.project.name}): ${names.join(', ')}; ${lengths.map((l) => l.toFixed(2)).join(' s, ')} s`);
  expect(lengths[0], 'the half-second take').toBeGreaterThan(0.2);
  expect(lengths[0]).toBeLessThan(lengths[1]);
  expect(lengths[1], 'the takes in the order they were made').toBeLessThan(lengths[2]);

  // After a speed change on a clip: the next take lands where the playhead is, after it.
  await importFiles(page, 'Media', ['counter.mp4']);
  await expect(main).toHaveCount(4, { timeout: 30_000 });
  const counter = (await mainNames(page)).indexOf('counter.mp4');
  await selectClip(main.nth(counter));
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
  await closeTools(page);
  await toEnd();
  await take(page, 1500, 5); // counter.mp4 is a video clip too
  expect(await pieces(page), 'no piece of any take is left behind').toBe(0);

  // Everything reaches the file, with sound, as long as the timeline; each take's frames move.
  const total = await main.evaluateAll((els) => els.reduce((s, e) => s + e.getBoundingClientRect().width / 60, 0));
  const video = await exportAs(page, info, 'Video', 'Export video');
  const pr = probe(video);
  expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Math.abs(Number(pr.format.duration) - total), 'the file is as long as the timeline').toBeLessThan(0.15);
  const starts = await main.evaluateAll((els) => els.map((e) => (e as HTMLElement).offsetLeft - (els[0] as HTMLElement).offsetLeft).map((x) => x / 60));
  const second = counterAt(video, Math.round((starts[2] + 0.5) * 30)), later = counterAt(video, Math.round((starts[2] + 1.5) * 30));
  console.log(`third take in the file (${info.project.name}): ${second} then ${later}`);
  expect(later, 'the take moves on in the file').not.toBe(second);
});

test('a camera refused, missing or busy is said in Kadr\'s words; Close works and nothing is recorded (QA matrix Q-27, §3.8)', async ({ page }) => {
  await newProject(page);
  for (const [name, said] of [
    ['NotAllowedError', 'Camera access was denied. Allow it in the browser settings and try again.'],
    ['NotFoundError', 'No camera was found on this device'],
    ['NotReadableError', 'The camera is busy in another app'],
  ] as const) {
    await page.evaluate((n) => { MediaDevices.prototype.getUserMedia = () => Promise.reject(new DOMException('refused by the test', n)); }, name);
    await tool(page, 'Camera').click();
    await expect(page.getByRole('alert'), name).toHaveText(said);
    await expect(start(page)).toBeDisabled();
    await page.getByRole('button', { name: 'Close camera' }).click();
    await expect(page.getByRole('dialog', { name: 'Camera' })).toHaveCount(0);
  }
  await expect(page.locator('.tl-row .clip')).toHaveCount(0);
  expect(await pieces(page), 'no take was begun').toBe(0);
});

test('the camera at 375 px: no sideways scroll, every control named and at least 44 px, with the script editor open too (QA matrix Q-27, §3.9–3.10)', async ({ page }, info) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await newProject(page);
  await tool(page, 'Camera').click();
  await expect(start(page)).toBeEnabled({ timeout: 10_000 });
  const audit = () => page.evaluate(() => {
    const cam = document.querySelector('.camera')!;
    const controls = [...cam.querySelectorAll('button, input, textarea, [role="slider"], [role="switch"]')].filter((e) => (e as HTMLElement).offsetParent !== null);
    const name = (e: Element) => e.getAttribute('aria-label') || (e as HTMLElement).innerText.trim() || (e.id && document.querySelector(`label[for="${e.id}"]`)?.textContent) || e.closest('label')?.textContent || '';
    return {
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      nameless: controls.filter((e) => !name(e).trim()).map((e) => e.outerHTML.slice(0, 80)),
      small: controls.filter((e) => e.tagName === 'BUTTON').map((e) => { const r = e.getBoundingClientRect(); return { n: name(e).trim().slice(0, 30), w: Math.round(r.width), h: Math.round(r.height) }; }).filter((b) => b.w < 44 || b.h < 44),
      outside: controls.map((e) => e.getBoundingClientRect()).filter((r) => r.left < -1 || r.right > innerWidth + 1).length,
    };
  });
  const ready = await audit();
  await page.getByRole('button', { name: 'Edit script' }).click();
  await page.getByRole('textbox', { name: 'Script' }).fill('Привет! Это длинная русская строка суфлёра, чтобы проверить перенос: достопримечательности.');
  const editing = await audit();
  console.log(`camera at 375 px (${info.project.name}): ready ${JSON.stringify(ready)}; script open ${JSON.stringify(editing)}`);
  for (const [where, a] of [['ready', ready], ['script open', editing]] as const) {
    expect(a.sideways, `${where}: no sideways scroll`).toBeLessThanOrEqual(0);
    expect(a.outside, `${where}: no control off the screen`).toBe(0);
    expect(a.nameless, `${where}: every control has a name`).toEqual([]);
    expect(a.small, `${where}: touch targets of at least 44 px`).toEqual([]);
  }
});
