// The sound of the file at its edges (QA matrix Q-31, docs/11 §3.5): «Even loudness» on silence, on clicks far above
// their loudness,
// on a sound too quiet to lift all the way; a 44.1 kHz source keeps its pitch at 48 kHz; mono reaches both ears.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { audits, decodeErrors, exportAs, importFiles, loudnessOf, note, probe, samples, selectClip, setValue, stereo, rmsDb, toneHz, tool } from './qa-platform-kit';

audits();

async function soundOnly(page: Page, file: string) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Audio', [file]);
  const clip = page.locator('.tl-row.audio .clip').first();
  await expect(clip).toHaveCount(1);
  return clip;
}
async function volume(page: Page, clip: ReturnType<Page['locator']>, v: number) {
  await selectClip(page, clip);
  await tool(page, 'Volume').click();
  await setValue(page, 'Volume', v);
  await page.getByRole('button', { name: 'Done' }).click();
}

test('even loudness on clicks far above their loudness: −14 ± 1 LUFS as the file comes out of the limiter, no sample above −1 dBFS (Q-31, SW-D-5)', async ({ page }, info) => {
  test.setTimeout(300_000);
  // A click every 0.5 s, 80 Hz dying in ~40 ms at −0.2 dBFS, over a faint hiss: −15.9 LUFS with peaks 15.7 dB above it.
  // Measured before the limiter, the gain was +1.9 dB and the limiter took it back: −15.7 LUFS in the file.
  const clicks = info.outputPath('clicks.m4a');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.98*exp(-25*mod(t,0.5))*sin(2*PI*80*mod(t,0.5))+0.01*(random(0)-0.5)':s=48000:d=12", '-ac', '2', '-c:a', 'aac', '-b:a', '256k', clicks]);
  const source = loudnessOf(clicks);
  await soundOnly(page, clicks);
  const on = loudnessOf(await exportAs(page, info, 'Audio', { loudness: true }));
  const video = await exportAs(page, info, 'Video', { loudness: true });
  const onVideo = loudnessOf(video);
  note(info, 'loudness.json', JSON.stringify({ source, on, onVideo }));
  expect(Math.abs(on.lufs + 14), `audio: ${on.lufs} LUFS (the source ${source.lufs})`).toBeLessThan(1);
  expect(on.peak, 'audio: the limiter holds −1 dBFS').toBeLessThanOrEqual(-0.9);
  expect(Math.abs(onVideo.lufs + 14), `video: ${onVideo.lufs} LUFS`).toBeLessThan(1);
  expect(onVideo.peak, 'video: the limiter holds −1 dBFS').toBeLessThanOrEqual(-0.9);
  expect(decodeErrors(video)).toBe('');
});

test('even loudness on a sound too quiet to reach −14: lifted by 12 dB at most, the noise floor is not pushed up further (Q-31)', async ({ page }, info) => {
  test.setTimeout(300_000);
  const clip = await soundOnly(page, 'music.m4a'); // −22 LUFS
  await volume(page, clip, 0.1); // −20 dB: −42 LUFS
  const off = loudnessOf(await exportAs(page, info, 'Audio', { loudness: false }));
  const on = loudnessOf(await exportAs(page, info, 'Audio', { loudness: true }));
  note(info, 'loudness.json', JSON.stringify({ off, on }));
  expect(off.lufs, `as set: ${off.lufs} LUFS`).toBeLessThan(-38);
  expect(Math.abs(on.lufs - off.lufs - 12), `lifted ${(on.lufs - off.lufs).toFixed(1)} dB`).toBeLessThan(1);
});

test('even loudness on silence: a whole silent sound track, no error, nothing made up (Q-31)', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['silent.mp4']); // 4 s, no sound
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const file = await exportAs(page, info, 'Video', { loudness: true });
  const got = probe(file);
  expect(decodeErrors(file)).toBe('');
  expect(Math.abs(got.duration - 4)).toBeLessThan(0.1);
  expect(got.audio?.codec, 'a sound track, silent').toBe('aac');
  const x = samples(file);
  expect(x.every(Number.isFinite), 'no NaN in the sound').toBe(true);
  expect(rmsDb(x, 0, 4)).toBeLessThan(-80);
});

test('a 44.1 kHz tone keeps its pitch in the 48 kHz file, and a mono recording is heard in both ears (Q-31)', async ({ page }, info) => {
  test.setTimeout(300_000);
  await soundOnly(page, 'music.m4a'); // 220 Hz at 44.1 kHz
  const tone = samples(await exportAs(page, info, 'Audio', { loudness: false }));
  const hz = toneHz(tone, 1, 9);
  expect(Math.abs(hz - 220) / 220, `${hz.toFixed(2)} Hz`).toBeLessThan(0.005);
  // Mono at 44.1 kHz, in a video.
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['mono44.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const [l, r] = stereo(await exportAs(page, info, 'Video', { loudness: false }));
  const [dl, dr] = [rmsDb(l, 0.5, 3.5), rmsDb(r, 0.5, 3.5)];
  note(info, 'channels.txt', `L ${dl.toFixed(1)} dB, R ${dr.toFixed(1)} dB, tone ${hz.toFixed(2)} Hz`);
  expect(dl, 'left has the sound').toBeGreaterThan(-40);
  expect(Math.abs(dl - dr), `L ${dl.toFixed(1)} vs R ${dr.toFixed(1)} dB`).toBeLessThan(1);
});
