// A reversed clip keeps its sound on its picture from its start to its end (V-159, sweep lane A, docs/21).
// The older check (`editor.spec.ts`, «a reversed clip keeps its sound…») allows 45 ms: on WebKit it measured 2 and 38 ms
// and gave the same numbers with its fix undone. Here the bound is one frame at 30 fps (docs/16 §0), and the reversed
// file Kadr keeps is checked for the cause: WebKit's encoder stamps the packets of each piece of sound from the piece's
// own start, so pieces that are not whole AAC frames leave packets whose stamps are off the sound, and the export, which
// starts decoding a stretch at a stamp, moves the sound off the picture.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { audited, fx, importFiles, mainClips, newProject, selectClip, tool } from './qa-video-kit';

audited();

/** ±1 frame at 30 fps, ms (docs/16 §0). */
const FRAME_MS = 1000 / 30;
/** Samples in an AAC frame. */
const AAC_FRAME = 1024;

type Sync = { offsets: number[]; flashes: number[] };

/** Sound minus picture, ms, at each white frame of the file; a white frame with no beep near it counts as far off. */
function measure(file: string): Sync {
  const v = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;
  const frames = [...v.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*YAVG=([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const flashes = frames.filter(([, y], i) => y > 128 && (i === 0 || frames[i - 1][1] <= 128)).map(([t]) => t);
  const a = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.1', '-vn', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;
  const beeps = [...a.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  // The beep of a white frame is the first sound from 200 ms before it on.
  const offsets = flashes.map((f) => {
    const b = beeps.find((t) => t > f - 0.2);
    return b === undefined || b > f + 1 ? Infinity : Math.round((b - f) * 1000);
  });
  return { offsets, flashes };
}

/** Each pair more than a frame apart, in words: empty means in sync from the first pair to the last. */
function outOfSync(s: Sync, pairs: number): string[] {
  const out: string[] = [];
  if (s.flashes.length !== pairs) out.push(`${s.flashes.length} white frames, ${pairs} expected`);
  s.offsets.forEach((o, i) => {
    if (!(Math.abs(o) <= FRAME_MS)) out.push(`pair ${i + 1} at ${s.flashes[i].toFixed(2)} s: sound ${o} ms off the picture`);
  });
  return out;
}

/** Audio packets of an AAC file, but the last, that are not one whole frame (their stamps are off the sound). */
function brokenPackets(file: string): string[] {
  const probe = (entries: string) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', entries, '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
  expect(probe('stream=codec_name'), 'the reversed sound is AAC').toBe('aac');
  const packets = probe('packet=pts,duration').split('\n').map((l) => l.split(',').map(Number));
  return packets.slice(0, -1).filter(([, d]) => d !== AAC_FRAME).map(([pts, d]) => `${(pts / 48000).toFixed(3)} s: ${d}`);
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

/** Imports `file`, reverses it and returns the reversed file as Kadr stored it on the device. */
async function reversed(page: Page, info: TestInfo, file: string): Promise<string> {
  await newProject(page);
  await importFiles(page, 'Media', [file]);
  await expect(mainClips(page)).toHaveCount(1);
  await selectClip(page, mainClips(page).first());
  await tool(page, 'Reverse').click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 240_000 });
  // The project is saved a moment later: read it once its clip is the reversed one.
  const read = () => page.evaluate(async () => {
    const id = /#\/p\/([\w-]+)/.exec(location.hash)![1];
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = <T,>(k: string) => new Promise<T>((res, rej) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result as T); r.onerror = () => rej(r.error); });
    try {
      const p = await get<{ tracks: { kind: string; clips: { assetId: string; reversedFrom?: unknown }[] }[] } | undefined>(`p:${id}`);
      const clip = p?.tracks.find((t) => t.kind === 'main')?.clips[0];
      if (!clip?.reversedFrom) return null;
      // A Blob where the browser stores one, else the file's chunks (WebKit's test context, a private Safari tab).
      let bytes: Uint8Array;
      const blob = await get<Blob | undefined>(`b:${clip.assetId}`);
      if (blob) bytes = new Uint8Array(await blob.arrayBuffer());
      else {
        const meta = await get<{ size: number; chunks: number }>(`c:${clip.assetId}`);
        bytes = new Uint8Array(meta.size);
        for (let i = 0, at = 0; i < meta.chunks; i++) {
          const c = new Uint8Array(await get<ArrayBuffer>(`c:${clip.assetId}:${i}`));
          bytes.set(c, at);
          at += c.length;
        }
      }
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    } finally {
      db.close();
    }
  });
  let b64: string | null = null;
  await expect.poll(async () => (b64 = await read()), { timeout: 30_000 }).not.toBeNull();
  const to = info.outputPath('reversed.mp4');
  fs.writeFileSync(to, Buffer.from(b64!, 'base64'));
  return to;
}

test('a reversed 4 s clip keeps its sound within a frame of its picture (V-159)', async ({ page }, info) => {
  test.setTimeout(300_000);
  test.skip(!fs.existsSync(fx('avsync.mp4')), 'needs npm run fixtures');
  const kept = await reversed(page, info, 'avsync.mp4'); // white frame and beep together at 1.0 s and 2.5 s
  const s = measure(await exportVideo(page, info));
  const broken = brokenPackets(kept);
  console.log(`reversed 4 s (${info.project.name}): white frames at ${s.flashes.map((t) => t.toFixed(3)).join(' ')} s; sound minus picture ${s.offsets.join(' ')} ms; ${broken.length} packets of the kept file off a whole frame`);
  expect(outOfSync(s, 2)).toEqual([]);
  expect(broken, 'packets of the reversed sound that are not one AAC frame').toEqual([]);
});

test('a reversed 30 s clip keeps its sound within a frame of its picture at the start, middle and end (V-159)', async ({ page }, info) => {
  test.setTimeout(600_000);
  test.skip(!fs.existsSync(fx('avsync_long.mp4')), 'needs npm run fixtures');
  const kept = await reversed(page, info, 'avsync_long.mp4'); // white frame and beep together every 4 s from 1 s to 29 s
  const s = measure(await exportVideo(page, info));
  const broken = brokenPackets(kept);
  console.log(`reversed 30 s (${info.project.name}): white frames at ${s.flashes.map((t) => t.toFixed(3)).join(' ')} s; sound minus picture ${s.offsets.join(' ')} ms; ${broken.length} packets of the kept file off a whole frame`);
  expect(outOfSync(s, 8)).toEqual([]);
  expect(broken, 'packets of the reversed sound that are not one AAC frame').toEqual([]);
});
