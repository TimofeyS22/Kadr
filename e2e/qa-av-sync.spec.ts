// Sound against picture over a whole file (audit V-110). The older checks look at two beeps in the first 3 s, so sound
// that drifts slowly or ends early passed. Here every pair of fixtures/avsync_long.mp4 is measured, the two streams must
// end together, and the same analysis has to catch those defects when they are planted in a real export.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const FILE = 'avsync_long.mp4';
const PAIRS = 8; // white frame and beep at 1, 5, … 29 s

/** |sound − picture| at any pair, ms: the bound the short test already holds to. */
const MAX_OFFSET_MS = 20;
/** How far the offset may move between the first and the second half of the file, ms. */
const MAX_DRIFT_MS = 15;
/** How much sooner or later one stream may end, s: less than two AAC frames plus one video frame. */
const MAX_END_GAP_S = 0.08;

type Sync = { offsets: number[]; flashes: number; beeps: number; videoEnd: number; audioEnd: number };

/** Where a stream's last packet ends, s: the container's own duration fields can be rounded or missing. */
function streamEnd(file: string, stream: 'v' | 'a') {
  const out = execFileSync('ffprobe', ['-v', 'error', '-select_streams', stream, '-show_entries', 'packet=pts_time,duration_time', '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 64 << 20 });
  return Math.max(...out.trim().split('\n').map((l) => l.split(',').map(Number)).map(([pts, dur]) => pts + (dur || 0)));
}

function measure(file: string): Sync {
  const v = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;
  const frames = [...v.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*YAVG=([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const flashes = frames.filter(([, y], i) => y > 128 && (i === 0 || frames[i - 1][1] <= 128)).map(([t]) => t);
  const a = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.1', '-vn', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;
  const beeps = [...a.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  // The beep of a flash is the first sound from 200 ms before it on: a pair with no beep near it counts as far off.
  const offsets = flashes.map((f) => {
    const b = beeps.find((t) => t > f - 0.2);
    return b === undefined || b > f + 1 ? Infinity : Math.round((b - f) * 1000);
  });
  return { offsets, flashes: flashes.length, beeps: beeps.length, videoEnd: streamEnd(file, 'v'), audioEnd: streamEnd(file, 'a') };
}

/** Everything wrong with a measured file, in words; empty means in sync from the first pair to the last. */
function problems(s: Sync): string[] {
  const out: string[] = [];
  if (s.flashes !== PAIRS) out.push(`${s.flashes} white frames, ${PAIRS} expected`);
  const finite = s.offsets.filter(Number.isFinite);
  if (finite.length !== PAIRS) out.push(`${PAIRS - finite.length} white frames without a beep`);
  const worst = Math.max(0, ...finite.map(Math.abs));
  if (worst > MAX_OFFSET_MS) out.push(`offset ${worst} ms`);
  // Halves, not the two ends: AAC frames make single pairs alternate (−2, 11, −2, 11 ms on WebKit).
  const mean = (l: number[]) => l.reduce((x, y) => x + y, 0) / l.length;
  const middle = Math.floor(finite.length / 2);
  const drift = finite.length > 1 ? Math.round(mean(finite.slice(middle)) - mean(finite.slice(0, middle))) : 0;
  if (Math.abs(drift) > MAX_DRIFT_MS) out.push(`drift ${drift} ms from the first half to the second`);
  const gap = s.audioEnd - s.videoEnd;
  if (Math.abs(gap) > MAX_END_GAP_S) out.push(`sound ends ${gap.toFixed(3)} s after the picture`);
  return out;
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
});

async function openFixture(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx(FILE));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
}

/** Loudness levelling off: on near-silence it would lift the codec noise into "beeps". */
async function exportVideo(page: Page, info: TestInfo) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('switch', { name: /Even loudness/ }).uncheck();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 240_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath((await dl).suggestedFilename());
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  return file;
}

test('sound stays on the picture to the last second of a 30 s file; the check sees drift and short sound', async ({ page }, info) => {
  test.setTimeout(420_000);
  test.skip(!fs.existsSync(fx(FILE)), 'needs npm run fixtures');
  await openFixture(page);
  const file = await exportVideo(page, info);
  const real = measure(file);
  console.log(`whole-file sync (${info.project.name}): offsets ${real.offsets.join(' ')} ms; picture ends ${real.videoEnd.toFixed(3)} s, sound ${real.audioEnd.toFixed(3)} s`);
  expect(problems(real)).toEqual([]);

  // The controls: the same real file with each defect planted. If the analysis goes blind, these go red.
  const planted = (name: string, ...args: string[]) => {
    const to = info.outputPath(`${name}${path.extname(file)}`);
    execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', file, '-c:v', 'copy', ...args, to]);
    return problems(measure(to));
  };
  expect(planted('drift', '-af', 'atempo=1.004').join('; '), 'sound 0.4% fast').toMatch(/drift|offset/);
  expect(planted('short', '-af', 'atrim=end=27').join('; '), 'sound 10% short').toMatch(/sound ends|without a beep/);
});
