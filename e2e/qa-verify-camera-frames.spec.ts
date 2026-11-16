// Verification, lane E4 (docs/21 §5), row S-1-12: where a camera take that gives 0 bytes on the Mac comes from. On
// Playwright WebKit under load about 5 takes in 45 gave the recorder nothing; on the iPhone 0 of 47. A take goes
// through three steps, each counted for every take:
//   (1) the test's fake camera paints its canvas (a setInterval of 33 ms, as `fakeCamera` in editor.spec.ts; the
//       camera opened last, as every opening starts its own);
//   (2) the product's mirror of the front camera draws a frame (requestVideoFrameCallback, src/ui/CameraSheet.tsx);
//   (3) the recorder starts, hands pieces (with their size) or fails.
// A take with no bytes where (1) or (2) is 0 is the stand starving the recorder of frames; one where both ran and
// the recorder still gave nothing is the recorder's own. The numbers go to the log and to the test's attachment.
import { expect, test, type Page } from '@playwright/test';

const TAKES = Number(process.env.E4_TAKES ?? 20);

interface Counters { paints: number; cams: number[]; mirror: number; recorders: { starts: number; t0: number; pieces: number[]; at: number[]; mime: string; errors: string[] }[] }
interface Take { n: number; paints: number; mirror: number; starts: number; pieces: number; bytes: number; at: number[]; mime: string; errors: string[]; outcome: string }

async function countingCamera(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    const w = window as unknown as { __e4: Counters; __seen: string[] };
    const c4: Counters = (w.__e4 = { paints: 0, cams: [], mirror: 0, recorders: [] });
    // Every note as it is shown (a toast lives seconds; the outcome of a take is read from these).
    w.__seen = [];
    new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
      const text = el.textContent ?? '';
      if (!w.__seen.includes(text)) w.__seen.push(text);
    })).observe(document, { subtree: true, childList: true, characterData: true });
    // (1) The fake camera of editor.spec.ts, with a count of its paints.
    MediaDevices.prototype.getUserMedia = async function (want?: MediaStreamConstraints) {
      const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
      const g = c.getContext('2d')!;
      let f = 0;
      const cam = c4.cams.push(0) - 1; // each camera opened paints on its own interval: counted apart
      setInterval(() => {
        g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
        g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 360);
        g.fillStyle = `hsl(${(f++ * 7) % 360} 70% 50%)`; g.fillRect(0, 0, 640, 20);
        c4.paints++;
        c4.cams[cam]++;
      }, 33);
      const ctx = new AudioContext();
      const osc = ctx.createOscillator();
      const dest = ctx.createMediaStreamDestination();
      osc.connect(dest);
      osc.start();
      return new MediaStream([...(want?.video ? c.captureStream(30).getVideoTracks() : []), ...dest.stream.getAudioTracks()]);
    };
    // (2) Frames the mirror draws: its callback runs once per video frame shown.
    const proto = HTMLVideoElement.prototype as HTMLVideoElement & { requestVideoFrameCallback?: (cb: VideoFrameRequestCallback) => number };
    const rvfc = proto.requestVideoFrameCallback;
    if (rvfc) proto.requestVideoFrameCallback = function (this: HTMLVideoElement, cb: VideoFrameRequestCallback) {
      return rvfc.call(this, (now, meta) => { c4.mirror++; cb(now, meta); });
    };
    // (3) What the recorder does.
    const Real = window.MediaRecorder;
    if (Real) window.MediaRecorder = class extends Real {
      constructor(stream: MediaStream, options?: MediaRecorderOptions) {
        super(stream, options);
        const r = { starts: 0, t0: 0, pieces: [] as number[], at: [] as number[], mime: '', errors: [] as string[] };
        c4.recorders.push(r);
        this.addEventListener('start', () => { r.starts++; r.t0 = performance.now(); r.mime = this.mimeType; });
        this.addEventListener('dataavailable', (e) => { r.pieces.push((e as BlobEvent).data?.size ?? -1); r.at.push(Math.round(performance.now() - r.t0)); });
        this.addEventListener('error', (e) => { r.errors.push(String((e as Event & { error?: unknown }).error ?? 'error')); });
      }
    };
  });
}

const counters = (page: Page) => page.evaluate(() => {
  const w = window as unknown as { __e4: Counters; __seen: string[] };
  return { paints: w.__e4.cams.at(-1) ?? 0, mirror: w.__e4.mirror, recorders: w.__e4.recorders.map((r) => ({ ...r, pieces: [...r.pieces], at: [...r.at], errors: [...r.errors] })), seen: [...w.__seen] };
});

test('camera takes: what reaches the recorder, take by take (S-1-12)', async ({ page }, info) => {
  test.setTimeout(TAKES * 45_000 + 60_000);
  await countingCamera(page);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const clips = page.locator('.tl-row.main .clip-video');
  const takes: Take[] = [];
  for (let n = 1; n <= TAKES; n++) {
    const start = page.getByRole('button', { name: 'Start recording' });
    if (!(await start.isVisible())) {
      // After a take is in, its clip's tools are open: the Camera is among the main tools.
      const camera = page.getByRole('button', { name: 'Camera', exact: true });
      for (let i = 0; i < 3 && !(await camera.isVisible()); i++) {
        const close = page.getByRole('button', { name: 'Close tools' });
        if (await close.isVisible()) await close.click(); else await page.keyboard.press('Escape');
        await page.waitForTimeout(300);
      }
      await camera.click();
    }
    await expect(start).toBeEnabled({ timeout: 20_000 });
    const had = await clips.count();
    await start.click();
    const stop = page.getByRole('button', { name: 'Stop recording' });
    await expect(stop).toBeVisible({ timeout: 15_000 }); // after 3-2-1: the recorder has started
    const before = await counters(page);
    await page.waitForTimeout(3000);
    const mid = await counters(page);
    if (await stop.isVisible()) await stop.click().catch(() => undefined);
    // The take lands on the timeline, or the net says it is empty or did not start.
    const ended = async () => (await clips.count()) > had || /did not start|came out empty|Could not add|Unsupported/.test((await counters(page)).seen.slice(before.seen.length).join(' | '));
    const settled = await expect.poll(ended, { timeout: 30_000 }).toBe(true).then(() => true, () => false);
    await page.waitForTimeout(500);
    const after = await counters(page);
    const r = after.recorders.at(-1)!;
    const said = after.seen.slice(before.seen.length).join(' | ');
    takes.push({
      n, paints: mid.paints - before.paints, mirror: mid.mirror - before.mirror, starts: r.starts, pieces: r.pieces.filter((s) => s > 0).length,
      bytes: r.pieces.reduce((s, x) => s + Math.max(0, x), 0), at: r.at, mime: r.mime, errors: r.errors,
      outcome: (await clips.count()) > had ? 'clip' : /did not start/.test(said) ? 'did not start' : /came out empty/.test(said) ? 'empty'
        : settled ? `other: ${said}` : `nothing in 30 s: no clip, no word${said ? ` (said: ${said})` : ''}`,
    });
    if (!settled) break; // the camera is in a state the next take cannot start from cleanly
  }
  const lines = takes.map((t) => `take ${t.n}: paints ${t.paints}, mirror frames ${t.mirror}, recorder starts ${t.starts}, pieces ${t.pieces} at ${t.at.join('/')} ms (${t.mime}), ${(t.bytes / 1024).toFixed(0)} KB${t.errors.length ? `, errors ${t.errors.join(';')}` : ''} → ${t.outcome}`);
  const empty = takes.filter((t) => t.bytes === 0);
  const summary = `${info.project.name}: ${takes.length} takes, ${empty.length} with 0 bytes`
    + (empty.length ? ` — of them ${empty.filter((t) => t.paints === 0).length} with no fake-camera paint, ${empty.filter((t) => t.mirror === 0).length} with no mirror frame, ${empty.filter((t) => t.paints > 0 && t.mirror > 0).length} with both running` : '');
  console.log(`camera takes (S-1-12)\n${lines.join('\n')}\n${summary}`);
  await info.attach('takes.json', { body: JSON.stringify(takes, null, 1), contentType: 'application/json' });
  // The net holds whatever the cause: no take ends as "an unsupported format".
  expect(takes.filter((t) => t.outcome !== 'clip' && t.outcome !== 'empty' && t.outcome !== 'did not start').map((t) => `take ${t.n}: ${t.outcome}`), 'every take ends as a clip or in words').toEqual([]);
});
