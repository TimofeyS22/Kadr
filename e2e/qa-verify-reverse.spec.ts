// Verifier E1 (docs/21 §5), row SW-C-7: Cancel is heard while a reverse gathers its sound. The lane's test cancels a
// 60 s reverse after 1 s and wants the overlay gone in 5 s, which needs a slow sound phase to fail: with the fix taken
// out it stayed green at load 16 (WebKit 0.8 s, control 2026-11-16) and was red only at load ~30. Here the gathering is
// made slow on purpose, as on a slow phone: each packet the audio decoder takes costs 5 ms more (about 13 s for the
// 2585 packets of the clip), and the test counts the packets decoded after Cancel. A gathering that does not look at
// Cancel decodes all the rest of them.
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const decoded = (page: Page) => page.evaluate(() => (window as unknown as { __decoded: number }).__decoded);

test('Cancel while a reverse gathers its sound stops the gathering, whatever the load (SW-C-7)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
    const w = window as unknown as { __decoded: number };
    w.__decoded = 0;
    if (typeof AudioDecoder === 'undefined') return;
    const decode = AudioDecoder.prototype.decode;
    AudioDecoder.prototype.decode = function (chunk: EncodedAudioChunk) {
      w.__decoded++;
      const t = performance.now(); while (performance.now() - t < 5); // a slow phone's decoder
      return decode.call(this, chunk);
    };
  });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('long_1.mp4')); // 60 s of 1080p with 2585 packets of AAC
  const clip = page.locator('.tl-row.main .clip');
  await expect(clip).toHaveCount(1, { timeout: 60_000 });
  // The wave of the clip is decoded too: wait until nothing decodes, so every packet counted later is the reverse's.
  let last = -1;
  await expect.poll(async () => { const n = await decoded(page); const still = n === last; last = n; return still; }, { timeout: 120_000, intervals: [2_000] }).toBe(true);
  const before = await decoded(page);
  await clip.first().click();
  await page.getByRole('button', { name: 'Reverse', exact: true }).click();
  const busy = page.locator('.busy');
  await expect(busy).toBeVisible();
  // Into the gathering: some packets decoded, most of them to come.
  await expect.poll(async () => (await decoded(page)) - before, { message: 'the reverse decodes the sound (no AudioDecoder here?)', timeout: 60_000, intervals: [50] }).toBeGreaterThanOrEqual(200);
  const atCancel = (await decoded(page)) - before, at = Date.now();
  expect(atCancel, 'Cancel comes while most of the sound is still to gather').toBeLessThan(1500);
  await busy.getByRole('button', { name: 'Cancel' }).click();
  await expect(busy, 'a cancelled reverse ends').toHaveCount(0, { timeout: 120_000 });
  const took = (Date.now() - at) / 1000, after = (await decoded(page)) - before - atCancel;
  console.log(`reverse cancelled while gathering (${info.project.name}): ${atCancel} packets before Cancel, ${after} after; overlay left ${took.toFixed(1)} s after Cancel`);
  expect(after, 'the packets after Cancel are not decoded (2585 in all)').toBeLessThan(400);
  expect(took, 'Cancel is heard within 3 s (the L5 threshold of Q-10)').toBeLessThan(3);
  await expect(clip, 'the clip is as it was').toHaveCount(1);
});
