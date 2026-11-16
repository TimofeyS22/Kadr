// Verification, lane E4 (docs/21 §5), row SW-C-7: Cancel during the sound phase of a reverse. qa-media-reverse.spec.ts
// taps Cancel 1 s in and allows 5 s; on a quiet Mac the sound phase of 60 s is over by then, and with every Cancel check
// of the sound phase taken out that test stayed green on both engines. Here the page itself taps Cancel the moment the
// reverse builds its first sound buffer (the sound phase comes first), and the frame phase must never start: not one
// video frame is decoded after the tap. No threshold in seconds: a sound phase deaf to Cancel runs to its end and the
// frame phase decodes a frame before it hears it.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

interface Rev { armed: boolean; cancelAt: number; buffers: number; framesAfter: number; goneAt: number }

test('Cancel tapped as the reverse reads its first sound is heard in the sound phase: no frame is decoded after it (SW-C-7)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
    const w = window as unknown as { __rev: Rev };
    const r: Rev = (w.__rev = { armed: false, cancelAt: 0, buffers: 0, framesAfter: 0, goneAt: 0 });
    // The sound phase: every buffer of the clip's sound is an AudioBuffer made on this thread (Mediabunny's toAudioBuffer).
    const AB = window.AudioBuffer;
    window.AudioBuffer = class extends AB {
      constructor(o: AudioBufferOptions) {
        super(o);
        if (!r.armed) return;
        r.buffers++;
        if (r.cancelAt) return;
        const cancel = [...document.querySelectorAll<HTMLButtonElement>('.busy button')].find((b) => /Cancel/.test(b.textContent ?? ''));
        if (cancel) { r.cancelAt = performance.now(); cancel.click(); }
      }
    } as typeof AudioBuffer;
    // The frame phase: every frame the reverse decodes.
    const VD = window.VideoDecoder;
    if (VD) window.VideoDecoder = class extends VD {
      constructor(init: VideoDecoderInit) {
        super({ ...init, output: (f) => { if (r.cancelAt) r.framesAfter++; init.output(f); } });
      }
    };
    new MutationObserver(() => { if (r.cancelAt && !r.goneAt && !document.querySelector('.busy')) r.goneAt = performance.now(); })
      .observe(document, { subtree: true, childList: true });
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('long_1.mp4')); // 60 s of 1080p with AAC sound
  const clip = page.locator('.tl-row.main .clip');
  await expect(clip).toHaveCount(1, { timeout: 60_000 });
  await page.waitForTimeout(3000); // the film strip and the wave are made: nothing else builds sound now
  await clip.first().click();
  await page.evaluate(() => { (window as unknown as { __rev: Rev }).__rev.armed = true; });
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  const busy = page.locator('.busy');
  await expect(busy, 'a cancelled reverse ends').toHaveCount(0, { timeout: 180_000 });
  const r = await page.evaluate(() => (window as unknown as { __rev: Rev }).__rev);
  console.log(`reverse cancelled in its sound phase (${info.project.name}): ${r.buffers} sound buffers made, ${r.framesAfter} frames decoded after Cancel, overlay gone ${((r.goneAt - r.cancelAt) / 1000).toFixed(2)} s after it`);
  expect(r.cancelAt, 'Cancel was tapped during the sound phase').toBeGreaterThan(0);
  expect(r.framesAfter, 'frames decoded after Cancel: the frame phase started, Cancel was not heard while the sound was read').toBe(0);
  await expect(clip, 'the clip is as it was').toHaveCount(1);
  await expect(page.locator('.toast.error')).toHaveCount(0);
});
