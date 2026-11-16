// While a finger scrubs, each step shows the keyframe before its time at once, and the exact frame follows (audit V-173).
// Since V-248 the keyframes of a scrub come from one decoder kept from step to step: Mediabunny's getSample made and
// closed a decoder for every step, 20–60 ms of each on WebKit. Checked here in the browser, with the real
// decoder: the picture of every keyframe step is read the moment it is drawn (counter.mp4 shows its frame number in
// binary), and the decoders the page makes are counted. Both engines.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const FPS = 30;
/** Back and forth inside the 6 s clip, each step at least 0.6 s from the last: always a keyframe first. */
const STEPS = [3.1, 1.2, 4.9, 0.7, 2.5, 5.6, 1.9, 4.2, 3.3];

test('V-248: every scrub step shows the keyframe before its time at once, from one decoder kept between steps', async ({ page }) => {
  test.setTimeout(180_000);
  // Frame numbers of the keyframes, from the file itself.
  const keys = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v:0', '-skip_frame', 'nokey', '-show_entries', 'frame=pts_time', '-of', 'csv=p=0', fx('counter.mp4')])
    .toString().trim().split('\n').map((s) => Math.round(Number(s) * FPS));
  expect(keys.length, 'counter.mp4 has several keyframes').toBeGreaterThan(5);

  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.locale', 'en');
    // Every VideoDecoder this page makes is counted (thumbnail workers have their own).
    const w = window as unknown as { VideoDecoder?: typeof VideoDecoder; __decoders: { made: number } };
    const counts = (w.__decoders = { made: 0 });
    const Base = w.VideoDecoder;
    if (Base) w.VideoDecoder = class extends Base { constructor(init: VideoDecoderInit) { super(init); counts.made++; } };
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '16:9' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('counter.mp4'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { __kadrPerf: { marks: Record<string, number> } }).__kadrPerf.marks).some((k) => k.startsWith('thumbs:'))), { timeout: 60_000 }).toBe(true);

  // A keyframe drawn while scrubbing is read in the same task it is drawn in (the WebGL canvas keeps nothing after it).
  await page.evaluate(() => {
    type Last = { t: number; at: number; exact: boolean };
    const w = window as unknown as { __kadrPerf: { last: Last }; __decoders: { made: number }; __keyShots: { t: number; frame: number; made: number }[] };
    const P = w.__kadrPerf;
    const shots: { t: number; frame: number; made: number }[] = (w.__keyShots = []);
    const read = document.createElement('canvas').getContext('2d', { willReadFrequently: true })!;
    let last = P.last;
    Object.defineProperty(P, 'last', {
      configurable: true,
      get: () => last,
      set: (v: Last) => {
        last = v;
        if (v.exact) return;
        const c = document.querySelector<HTMLCanvasElement>('.preview-canvas')!;
        read.canvas.width = c.width; read.canvas.height = c.height;
        read.drawImage(c, 0, 0);
        // counter.mp4: eight columns, the c-th bright when bit c of the frame number is set.
        let frame = 0;
        for (let b = 0; b < 8; b++) if (read.getImageData(Math.floor(((b + 0.5) * c.width) / 8), Math.floor(c.height / 2), 1, 1).data[0] > 128) frame |= 1 << b;
        shots.push({ t: v.t, frame, made: w.__decoders.made });
      },
    });
  });

  // One step: from the scroll to the exact frame; the decoders made before its keyframe was drawn, and that keyframe.
  const step = (x: number) => page.evaluate(async (x) => {
    const w = window as unknown as { __kadrPerf: { last: { t: number; at: number; exact: boolean } }; __decoders: { made: number }; __keyShots: { t: number; frame: number; made: number }[] };
    const P = w.__kadrPerf;
    const el = document.querySelector('.tl-scroll')!;
    const before = w.__decoders.made, shots = w.__keyShots.length;
    const t0 = performance.now();
    el.scrollLeft = x;
    while (performance.now() - t0 < 30_000) {
      await new Promise((r) => setTimeout(r, 5));
      if (P.last.at > t0 && P.last.exact) break;
    }
    const key = w.__keyShots.slice(shots).find((s) => Math.abs(s.t - P.last.t) < 1e-3);
    return { t: P.last.t, exact: P.last.exact, key: key && { frame: key.frame, made: key.made - before } };
  }, x);

  const calibrate = await step(30); // the timeline's pixels a second
  const zoom = 30 / calibrate.t;
  for (const [i, s] of STEPS.entries()) {
    const r = await step(Math.round(s * zoom));
    expect(Math.abs(r.t - s), `step ${i + 1} went to ${s} s`).toBeLessThan(0.1);
    expect(r.exact, `step ${i + 1}: the exact frame follows`).toBe(true);
    expect(r.key, `step ${i + 1}: a keyframe was drawn first`).toBeTruthy();
    const want = keys.filter((k) => k <= r.t * FPS + 1e-3).at(-1);
    expect(r.key!.frame, `step ${i + 1} at ${r.t.toFixed(3)} s: the keyframe before it, frame ${want}`).toBe(want);
    if (i > 0) expect(r.key!.made, `step ${i + 1}: decoders made before its keyframe was drawn`).toBe(0);
  }
});
