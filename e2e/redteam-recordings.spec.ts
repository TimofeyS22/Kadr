// Red team, storage and capture (docs/13, 2026-11-14): a recording in progress must not be thrown away without a word.
// Export, captions and the reel warn on the first close and stop only on the second (audit V-225, useSheetGuard). The
// camera and the voice-over have no such guard: the camera only greys out its own close button, so the system Back
// (Safari's edge swipe, Android's Back) or Esc still close it, and the voice-over sheet closes with «Done», Esc or Back
// at any time. Either way the sheet unmounts and its cleanup discards the take (CameraSheet: `take.discard()`, ToolSheets
// VoiceoverBody: `rec.current?.cancel()`): no clip, no toast, and nothing comes back after a reload.
// These tests say what should happen and are red on v1.9.11 (1560a14).
import { expect, test, type Page } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined });
    // Every toast as it is shown: what the person was told, if anything.
    const w = window as unknown as { __seen: string[] };
    w.__seen = [];
    new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
      const text = el.textContent ?? '';
      if (text && !w.__seen.includes(text)) w.__seen.push(text);
    })).observe(document, { subtree: true, childList: true, characterData: true });
  });
});

const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });
const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);

async function newProject(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}

/** A synthetic camera with a tone, as in editor.spec.ts. */
async function fakeCamera(page: Page) {
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async function (want?: MediaStreamConstraints) {
      const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const g = c.getContext('2d')!;
      let f = 0;
      setInterval(() => {
        g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
        g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 360);
        g.fillStyle = `hsl(${(f++ * 7) % 360} 70% 50%)`; g.fillRect(0, 0, 640, 20);
      }, 33);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return new MediaStream([...(want?.video ? c.captureStream(30).getVideoTracks() : []), ...dest.stream.getAudioTracks()]);
    };
  });
}

/** A microphone: a quiet tone (the voice-over asks for sound alone). */
async function fakeMicrophone(page: Page) {
  await page.addInitScript(() => {
    MediaDevices.prototype.getUserMedia = async function () {
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      gain.gain.value = 0.2;
      const dest = ctx.createMediaStreamDestination();
      osc.connect(gain).connect(dest);
      osc.start();
      return dest.stream;
    };
  });
}

/**
 * After the close: the take is either still being recorded (the close was held back, with a warning) or it is in the
 * project. What it must not be is gone with nothing said.
 */
async function takeSurvives(page: Page, clips: string, what: string) {
  await page.waitForTimeout(4000); // a save of the take, if one was started, has time to land
  const recording = await tool(page, 'Stop recording').isVisible();
  const inProject = await page.locator(clips).count();
  const said = await toasts(page);
  const pieces = await page.evaluate(() => new Promise<number>((ok) => {
    const open = indexedDB.open('kadr');
    open.onerror = () => ok(-1);
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').getAllKeys();
      req.onsuccess = () => { ok((req.result as IDBValidKey[]).filter((k) => String(k).startsWith('t:')).length); open.result.close(); };
      req.onerror = () => ok(-1);
    };
  }));
  console.log(`${what}: still recording ${recording}, clips ${inProject}, camera pieces in storage ${pieces}, toasts ${JSON.stringify(said)}`);
  expect(recording || inProject > 0, `${what}: the recording is still running or is in the project (toasts: ${JSON.stringify(said)})`).toBe(true);
}

for (const [how, close] of [
  ['the system Back', (page: Page) => page.goBack()],
  ['Esc', (page: Page) => page.keyboard.press('Escape')],
] as const) {
  test(`a camera take in progress survives ${how}`, async ({ page }) => {
    test.setTimeout(120_000);
    await fakeCamera(page);
    await newProject(page);
    await tool(page, 'Camera').click();
    await tool(page, 'Start recording').click();
    await expect(tool(page, 'Stop recording')).toBeVisible({ timeout: 15_000 }); // after 3-2-1
    await expect(tool(page, 'Close camera'), 'the close button is held back while recording').toBeDisabled();
    await page.waitForTimeout(5000); // five seconds of take, already written to storage piece by piece
    await close(page);
    await takeSurvives(page, '.tl-row.main .clip-video', `camera, ${how}`);
    // And it does not come back as an unfinished take either: the pieces were deleted.
    await page.reload();
    await expect(page.locator('.preview-canvas')).toBeVisible();
    await page.waitForTimeout(5000);
    expect(await page.locator('.tl-row.main .clip-video').count(), `camera, ${how}: the take after a reload`).toBeGreaterThan(0);
  });
}

for (const [how, close] of [
  ['Done', (page: Page) => page.getByRole('button', { name: 'Done' }).click()],
  ['the system Back', (page: Page) => page.goBack()],
  ['Esc', (page: Page) => page.keyboard.press('Escape')],
] as const) {
  test(`a voice-over in progress survives ${how}`, async ({ page }) => {
    test.setTimeout(120_000);
    await fakeMicrophone(page);
    await newProject(page);
    const chooser = page.waitForEvent('filechooser');
    await tool(page, 'Media').click();
    await (await chooser).setFiles(`${import.meta.dirname}/../fixtures/landscape.mp4`);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    const closeTools = page.getByRole('button', { name: 'Close tools' });
    if (await closeTools.isVisible()) await closeTools.click();
    await tool(page, 'Record').click();
    await tool(page, 'Start recording').click();
    await expect(tool(page, 'Stop recording')).toBeVisible({ timeout: 15_000 });
    await page.waitForTimeout(3000); // three seconds of voice
    await close(page);
    await takeSurvives(page, '.tl-row.audio .clip', `voice-over, ${how}`);
  });
}

// The voice-over is the camera's sibling of audit V-250: VoiceRecorder keeps every 250 ms piece in `chunks`, in memory,
// until Stop. The camera writes its pieces to storage and brings a take back after a crash; a voice-over is gone.
test('a voice-over cut short by a crash comes back, as a camera take does (V-250 for the microphone)', async ({ page }, info) => {
  test.setTimeout(120_000);
  test.skip(info.project.name === 'iphone-webkit', "this context's WebKit storage refuses Blobs (as in V-250's own test)");
  await fakeMicrophone(page);
  await newProject(page);
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(`${import.meta.dirname}/../fixtures/landscape.mp4`);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const closeTools = page.getByRole('button', { name: 'Close tools' });
  if (await closeTools.isVisible()) await closeTools.click();
  await tool(page, 'Record').click();
  await tool(page, 'Start recording').click();
  await expect(tool(page, 'Stop recording')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(5000); // five seconds of voice
  await page.reload(); // no Stop: what a crash does to the page
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 30_000 });
  await page.waitForTimeout(5000);
  const keys = await page.evaluate(() => new Promise<string[]>((ok, ko) => {
    const open = indexedDB.open('kadr');
    open.onerror = () => ko(open.error);
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').getAllKeys();
      req.onsuccess = () => { ok((req.result as IDBValidKey[]).map(String)); open.result.close(); };
    };
  }));
  console.log(`voice-over after a crash: audio clips ${await page.locator('.tl-row.audio .clip').count()}, stored keys ${keys.map((k) => k.split(':')[0]).join(',')}`);
  expect(await page.locator('.tl-row.audio .clip').count(), 'the voice-over recorded before the crash').toBeGreaterThan(0);
});

// Two tabs, one project (Chromium: this WebKit context refuses Blobs). The tab that opens the project takes every take it
// finds in storage for a crash's leftover (Editor: unfinishedTakes) and deletes its pieces, including the take the other
// tab is recording right now. The recording tab then stops on a file that has lost its start.
test('opening the project in a second tab does not take the take the first tab is recording', async ({ page, context }, info) => {
  test.setTimeout(180_000);
  test.skip(info.project.name === 'iphone-webkit', "this context's WebKit storage refuses Blobs");
  await fakeCamera(page);
  await newProject(page);
  const url = page.url();
  await tool(page, 'Camera').click();
  await tool(page, 'Start recording').click();
  await expect(tool(page, 'Stop recording')).toBeVisible({ timeout: 15_000 });
  await page.waitForTimeout(4000);
  const other = await context.newPage();
  await other.goto(url);
  await expect(other.locator('.preview-canvas')).toBeVisible();
  await other.waitForTimeout(6000);
  const stolen = await other.locator('.tl-row.main .clip-video').count();
  await other.close();
  await page.bringToFront();
  await page.waitForTimeout(2000);
  // The second tab's save makes this one show its "changed in another tab" notice: Stop is pressed through it.
  await tool(page, 'Stop recording').dispatchEvent('click');
  await page.waitForTimeout(8000);
  const kept = await page.locator('.tl-row.main .clip-video').count();
  const said = await toasts(page);
  console.log(`two tabs: the second tab took ${stolen} clip(s); the recording tab has ${kept} clip(s); toasts ${JSON.stringify(said)}`);
  expect(stolen, 'the second tab leaves a take in progress alone').toBe(0);
  expect(kept, 'the recording tab gets its whole take').toBe(1);
});

// A finished export waits in the origin-private file system until the person saves it. If the tab is reloaded before
// that (on an iPhone: Safari takes the page back while the person looks at another app, a common moment right after
// a long export), the file is still on the disk, but nothing offers it any more: the editor opens as if no export was
// made, and the next export or project deletion removes the file. The person exports again, for minutes.
test('a finished export that was not saved yet is offered again after the tab is reloaded', async ({ page }) => {
  test.setTimeout(240_000);
  await newProject(page);
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles(`${import.meta.dirname}/../fixtures/landscape.mp4`);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 180_000 });
  const onDisk = () => page.evaluate(async () => {
    const names: string[] = [];
    try { for await (const name of (await navigator.storage.getDirectory() as unknown as { keys(): AsyncIterable<string> }).keys()) names.push(name); } catch { /* no OPFS */ }
    return names;
  });
  const before = await onDisk();
  await page.reload(); // what iOS does to a Safari tab in the background
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await page.waitForTimeout(5000);
  const after = await onDisk();
  const offered = await page.getByRole('button', { name: 'Save / Share' }).isVisible();
  console.log(`unsaved export: on disk before ${JSON.stringify(before)}, after reload ${JSON.stringify(after)}, offered ${offered}, toasts ${JSON.stringify(await toasts(page))}`);
  expect(offered, 'the finished file is offered to save after the reload').toBe(true);
});
