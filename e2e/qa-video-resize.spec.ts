// V-232 on the iPhone (L5, v1.9.11, 2 of 2): a VP9 video whose frame size changes inside the file (640×360, then 360×360)
// is fitted in the preview, but its export stopped with «the video decoder of this device stopped». Mac decoders take a
// size change in one session; the iPhone's fails there. Here the page's decoders do as the iPhone's: a frame of another
// size than the session's first fails the decoder (EncodingError, as WebKit's «Decoder failure»). The export must still
// make the whole file, the new size fitted: Kadr's retry started from the same keyframe and crossed the change again.
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { audited, closeTools, exportVideo, importFiles, mainClips, newProject, probe } from './qa-video-kit';

audited();

test('a size change inside a VP9 file that fails the decoder still exports whole, the new size fitted (V-232)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    const w = window as unknown as { __strict: { failures: number } };
    const r = (w.__strict = { failures: 0 });
    const VD = window.VideoDecoder;
    window.VideoDecoder = class extends VD {
      constructor(init: VideoDecoderInit) {
        let size = '';
        super({
          output: (f) => {
            const s = `${f.codedWidth}x${f.codedHeight}`;
            if (size && s !== size) {
              f.close();
              r.failures++;
              queueMicrotask(() => { try { this.close(); } catch { /* closed */ } init.error(new DOMException('Decoder failure', 'EncodingError')); });
              return;
            }
            size = s;
            init.output(f);
          },
          error: (e) => init.error(e),
        });
      }
    };
  });
  await newProject(page, '16:9');
  await importFiles(page, 'Media', ['resize.webm']); // 640×360 red for 2 s, then 360×360 green for 2 s
  await expect(mainClips(page)).toHaveCount(1, { timeout: 30_000 });
  await closeTools(page);
  const file = await exportVideo(page, info); // the audit (afterEach) fails on an error toast: «Export failed…» is one
  const p = probe(file);
  const v = p.streams.find((s) => s.codec_type === 'video')!;
  const failures = await page.evaluate(() => (window as unknown as { __strict: { failures: number } }).__strict.failures);
  const at = (t: number, x: number) => {
    const rgb = execFileSync('ffmpeg', ['-v', 'error', '-ss', String(t), '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 64 * 1024 * 1024 });
    const i = 3 * (Math.floor(v.height! / 2) * v.width! + Math.floor(x * v.width!));
    return [...rgb.subarray(i, i + 3)];
  };
  const red = at(1, 0.5), green = at(3, 0.5), edge = at(3, 0.04);
  console.log(`size change, strict decoder (${info.project.name}): ${failures} decoder failures; ${v.width}×${v.height}, ${Number(p.format.duration).toFixed(2)} s; 1 s centre ${red}, 3 s centre ${green}, 3 s edge ${edge}`);
  expect(failures, 'the decoder did fail at the size change: the test went down the iPhone\'s path').toBeGreaterThan(0);
  expect(Math.abs(Number(p.format.duration) - 4)).toBeLessThan(0.1);
  expect(red[0], 'the first size: red').toBeGreaterThan(150);
  expect(green[1], 'after the change: the square frame in the middle').toBeGreaterThan(150);
  expect(edge[1], 'and not stretched to the edge of the wide frame').toBeLessThan(100);
});
