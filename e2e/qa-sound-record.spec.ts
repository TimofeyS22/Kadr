// Sound effects and the voice-over at their edges (QA matrix Q-24, docs/11 §3.1, §3.5): every one of the twelve effects
// reaches the file at the playhead, as long as it is; a take stopped at once leaves no broken clip.
import { expect, test, type Page } from '@playwright/test';
import { SFX } from '../src/engine/sfx';
import { audits, exportAs, importFiles, note, rmsDb, samples, storedProject, toastErrors, tool } from './qa-platform-kit';
import type { Project } from '../src/core/types';

audits();

/** A microphone that hears a steady 330 Hz tone (the test's voice). */
const fakeMicrophone = (page: Page) => page.addInitScript(() => {
  MediaDevices.prototype.getUserMedia = async function () {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    osc.frequency.value = 330;
    const gain = ctx.createGain();
    gain.gain.value = 0.3;
    const dest = ctx.createMediaStreamDestination();
    osc.connect(gain).connect(dest);
    osc.start();
    return dest.stream;
  };
});

async function silentVideo(page: Page, copies: number) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', Array(copies).fill('silent.mp4')); // 4 s each, no sound
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(copies);
  await page.getByRole('button', { name: 'Close tools' }).click();
}

test('every sound effect is in the file at the playhead, as long as it is, and not a moment before (Q-24)', async ({ page }, info) => {
  test.setTimeout(400_000);
  await silentVideo(page, 6); // 24 s of picture, no sound of its own
  const GAP = 1.75;
  for (const [i, s] of SFX.entries()) {
    const at = 0.5 + i * GAP;
    await page.locator('.tl-scroll').evaluate((el, x) => { el.scrollLeft = x; }, at * 60);
    await tool(page, 'Sounds').click();
    await page.getByRole('button', { name: `Add ${s.name} at the playhead` }).click();
    await expect(page.locator('.tl-row.audio .clip')).toHaveCount(i + 1, { timeout: 30_000 });
    const close = page.getByRole('button', { name: 'Close tools' });
    if (await close.isVisible()) await close.click();
  }
  const audioClips = async () => (await storedProject<Project>(page)).tracks.flatMap((t) => t.clips).filter((c) => c.kind === 'audio').sort((a, b) => a.start - b.start);
  await expect.poll(async () => (await audioClips()).length, { timeout: 20_000 }).toBe(SFX.length); // saved
  const placed = await audioClips();
  const x = samples(await exportAs(page, info, 'Audio', { loudness: false }));
  const rows: string[] = [];
  const fails: string[] = [];
  SFX.forEach((s, i) => {
    const c = placed[i];
    const before = rmsDb(x, c.start - 0.15, c.start - 0.005);
    const during = rmsDb(x, c.start, c.start + Math.min(s.duration, c.duration));
    rows.push(`${s.name} at ${c.start.toFixed(3)} s (${c.duration.toFixed(2)} of ${s.duration} s): before ${before.toFixed(1)} dB, during ${during.toFixed(1)} dB`);
    if (Math.abs(c.start - (0.5 + i * GAP)) > 0.02) fails.push(`${s.name} placed at ${c.start}`);
    if (Math.abs(c.duration - s.duration) > 0.01) fails.push(`${s.name} is ${c.duration} s long, not ${s.duration}`);
    if (during < -40) fails.push(`${s.name} is not heard: ${during.toFixed(1)} dB`);
    if (before > -60) fails.push(`${s.name} starts early: ${before.toFixed(1)} dB before it`);
  });
  note(info, 'sfx.txt', rows.join('\n'));
  expect(fails, rows.join('\n')).toEqual([]);
});

test('a voice-over stopped at once leaves a whole short clip or none, and says an empty take is empty — not a sound the browser cannot decode (Q-24, SW-D-8)', async ({ page }) => {
  test.setTimeout(240_000);
  await fakeMicrophone(page);
  await silentVideo(page, 1);
  await tool(page, 'Record').click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await page.getByRole('button', { name: 'Stop recording' }).click({ timeout: 10_000 });
  const audio = page.locator('.tl-row.audio .clip');
  await page.waitForTimeout(3000); // the take is saved, or not
  const quick = await audio.count();
  expect(quick, 'at most one clip from the quick take').toBeLessThanOrEqual(1);
  // No sound came in before the stop (Chromium's recorder gives none that soon): it is said, and nothing is added.
  const said = await toastErrors(page);
  expect(said.every((m) => m.startsWith('Could not save the recording: The recording is empty')), `messages: ${said.join(' | ')}`).toBe(true);
  if (!quick) expect(said.length, 'an empty take is said').toBe(1);
  if (quick) {
    const p = await storedProject<Project>(page);
    const c = p.tracks.flatMap((t) => t.clips).find((x) => x.kind === 'audio')!;
    expect(c.duration, 'a clip of the quick take has a length').toBeGreaterThan(0);
    expect(p.assets[c.assetId]?.hasAudio, 'and its sound').toBe(true);
  }
  // A take recorded right after an empty one: SW-D-9 (in Chromium it came out empty too) — its own row, not checked here.
});
