// The sound of the file at its edges (QA matrix Q-31, docs/11 §3.5): «Even loudness» on silence, on clicks far above
// their loudness,
// on a sound too quiet to lift all the way; a 44.1 kHz source keeps its pitch at 48 kHz; mono reaches both ears.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
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

/** The true peak of a file's sound (ffmpeg ebur128, oversampled), dBTP. */
function truePeakOf(file: string): number {
  const out = spawnSync('ffmpeg', ['-nostats', '-i', file, '-filter_complex', 'ebur128=peak=true:framelog=quiet', '-f', 'null', '-'], { encoding: 'utf8' }).stderr;
  const m = /True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/.exec(out.slice(out.lastIndexOf('Summary:')));
  return !m || m[1].includes('inf') ? -Infinity : Number(m[1]);
}
/** Bits a second of a file's sound (ffprobe). */
const soundBps = (file: string) => Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=bit_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
/** «Even loudness» holds −1.5 dBTP; the AAC encoder may lift a peak a little: the file stays under the platforms' −1. */
const FILE_PEAK_DB = -1;
/** Clicks get their whole boost through the limiter: −15.30 LUFS; with SW-D-5 back, −16.14 (see the test). */
const CLICKS_LUFS = -15.7;

test('even loudness on clicks far above their loudness: the limiter holds the ceiling without clipping and gives its whole +12 dB — no quieter than −15.7 LUFS (Q-31, SW-D-5)', async ({ page }, info) => {
  test.setTimeout(300_000);
  // A click every 0.5 s, 80 Hz dying in ~40 ms at −0.2 dBFS, over a faint hiss: its loudness lives in its peaks, so
  // every dB the limiter takes off a peak comes off the loudness too. The peak bar comes first (lead's decision, Q-31):
  // such a sound is not squashed to reach −14. Its gain is found through the limiter (SW-D-5): measured before it, the
  // gain left the file at −15.7 LUFS with a −1 dBFS ceiling, −16.14…−16.15 with today's −1.5 dBTP (the control);
  // through it, the whole +12 dB gives −15.30. Measured to 0.01 LUFS on both engines, audio and video, at ~72 and
  // 160 kbit/s, each side spread 0.01 dB: the bar sits in the middle, 0.4 dB from both. Not peaks over loudness tell
  // the two apart: live speech under music stands 19 dB over its loudness and reaches −14, these clicks stand 15 dB
  // over theirs and do not.
  const clicks = info.outputPath('clicks.m4a');
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', "aevalsrc='0.98*exp(-25*mod(t,0.5))*sin(2*PI*80*mod(t,0.5))+0.01*(random(0)-0.5)':s=48000:d=12", '-ac', '2', '-c:a', 'aac', '-b:a', '256k', clicks]);
  const source = loudnessOf(clicks);
  await soundOnly(page, clicks);
  const audio = await exportAs(page, info, 'Audio', { loudness: true });
  const video = await exportAs(page, info, 'Video', { loudness: true });
  const on = { ...loudnessOf(audio), truePeak: truePeakOf(audio) }, onVideo = { ...loudnessOf(video), truePeak: truePeakOf(video) };
  note(info, 'loudness.json', JSON.stringify({ source, on, onVideo }));
  for (const [what, x] of [['audio', on], ['video', onVideo]] as const) {
    expect(x.lufs, `${what}: ${x.lufs} LUFS (the source ${source.lufs}): the whole boost, through the limiter`).toBeGreaterThanOrEqual(CLICKS_LUFS);
    expect(x.lufs, `${what}: not over the goal`).toBeLessThanOrEqual(-13);
    expect(x.peak, `${what}: no sample over ${FILE_PEAK_DB} dBFS`).toBeLessThanOrEqual(FILE_PEAK_DB);
    expect(x.truePeak, `${what}: the true peak under ${FILE_PEAK_DB} dBTP`).toBeLessThanOrEqual(FILE_PEAK_DB);
  }
  expect(decodeErrors(video)).toBe('');
});

test('even loudness on live speech under music (87 s): −14 ± 1 LUFS, neither a sample nor the true peak over −1 dB, and the sound not thinned (Q-31, L5)', async ({ page }, info) => {
  test.setTimeout(600_000);
  // The phone (iPhone 15, v1.9.11) made −14.4 LUFS of this file with a peak of −0.8 dBFS, sample and true: the AAC
  // encoder, at ~72 kbit/s, lifted peaks the limiter held at −1 dBFS of samples. Its peaks stand 19 dB over its loudness.
  const source = loudnessOf(`${import.meta.dirname}/../fixtures/eval_ru_live_music.mp4`);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['eval_ru_live_music.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const file = await exportAs(page, info, 'Audio', { loudness: true });
  const l = loudnessOf(file), tp = truePeakOf(file), bps = soundBps(file), bytes = fs.statSync(file).size;
  note(info, 'loudness.json', JSON.stringify({ source, ...l, truePeak: tp, bps, bytes }));
  console.log(`Q-31 live speech under music (${info.project.name}): ${l.lufs} LUFS, sample peak ${l.peak} dBFS, true peak ${tp} dBTP, ${Math.round(bps / 1000)} kbit/s, ${bytes} bytes`);
  expect(Math.abs(l.lufs + 14), `${l.lufs} LUFS`).toBeLessThan(1);
  expect(l.peak, `no sample over ${FILE_PEAK_DB} dBFS`).toBeLessThanOrEqual(FILE_PEAK_DB);
  expect(tp, `the true peak under ${FILE_PEAK_DB} dBTP`).toBeLessThanOrEqual(FILE_PEAK_DB);
  // 160 kbit/s asked at a constant rate: WebKit writes 160 (72 before, whatever was asked); Chromium takes the mode
  // and ignores it, writing by the sound: 129 here (163 for dense noise). The bar sits between 72 and 129.
  expect(bps, 'the sound is not thinned to WebKit\'s ~72 kbit/s').toBeGreaterThanOrEqual(100_000);
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
