// The sound of the file and of a processed sound reaches the encoder in whole codec frames (SW-A-14, the cause of V-159).
// WebKit's encoder stamps the packets of each piece of sound from the piece's own start: the export handed it 2 s windows
// (93.75 AAC frames) and processed sounds 10 s ones, so at every seam one packet said 896 or 1920 samples instead of
// 1024 and the stamps drifted off the sound — the 30 s file's sound swung 13 ms against its picture from pair to pair.
// The cause is checked in the files (every packet but the last one frame long), the effect at all 8 flash+beep pairs.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { audits, exportAs, importFiles, newProject, note, selectClip, sheet, storedProject, tool } from './qa-platform-kit';

audits();

const AAC_FRAME = 1024;
/** One video frame at 30 fps, ms: the bound for sound against picture. */
const FRAME_MS = 33;

/** Audio packets of an AAC file, but the last, that are not one whole frame. */
function brokenPackets(file: string): string[] {
  const probe = (entries: string) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', entries, '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
  expect(probe('stream=codec_name'), 'the sound is AAC').toBe('aac');
  const rate = Number(probe('stream=sample_rate'));
  const packets = probe('packet=pts,duration').split('\n').map((l) => l.split(',').map(Number));
  return packets.slice(0, -1).filter(([, d]) => d !== AAC_FRAME).map(([pts, d]) => `${(pts / rate).toFixed(3)} s: ${d}`);
}

/** Sound minus picture, ms, at each flash+beep pair of fixtures/avsync_long.mp4 (white frame and beep at 1, 5, … 29 s). */
function offsets(file: string): number[] {
  const v = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;
  const frames = [...v.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*YAVG=([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])] as const);
  const flashes = frames.filter(([, y], i) => y > 128 && (i === 0 || frames[i - 1][1] <= 128)).map(([t]) => t);
  const a = spawnSync('ffmpeg', ['-hide_banner', '-i', file, '-af', 'silencedetect=noise=-40dB:d=0.1', '-vn', '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 64 << 20 }).stderr;
  const beeps = [...a.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  return flashes.map((f) => { const b = beeps.find((t) => t > f - 0.2); return b === undefined || b > f + 1 ? Infinity : Math.round((b - f) * 1000); });
}

/** The bytes of a stored asset (whole, or in the chunks WebKit's test context keeps them in), saved to `file`. */
async function storedFile(page: Page, assetId: string, file: string) {
  const b64 = await page.evaluate(async (id) => {
    const db = await new Promise<IDBDatabase>((res, rej) => { const r = indexedDB.open('kadr'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const get = (k: string) => new Promise<unknown>((res) => { const r = db.transaction('kv').objectStore('kv').get(k); r.onsuccess = () => res(r.result); });
    let bytes: Uint8Array;
    const whole = await get(`b:${id}`);
    if (whole instanceof Blob) bytes = new Uint8Array(await whole.arrayBuffer());
    else {
      const meta = await get(`c:${id}`) as { chunks: number };
      const parts: Uint8Array[] = [];
      for (let i = 0; i < meta.chunks; i++) parts.push(new Uint8Array(await get(`c:${id}:${i}`) as ArrayBuffer));
      bytes = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
      let o = 0;
      for (const p of parts) { bytes.set(p, o); o += p.length; }
    }
    db.close();
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, assetId);
  fs.writeFileSync(file, Buffer.from(b64, 'base64'));
}

test('a 30 s export: every packet of its sound is one AAC frame, and the sound stays on the picture at every pair (SW-A-14)', async ({ page }, info) => {
  test.setTimeout(400_000);
  await newProject(page);
  await importFiles(page, 'Media', ['avsync_long.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const rows: string[] = [];
  for (const loudness of [false, true]) { // without and through the limiter (it holds samples back and lets them out later)
    const file = await exportAs(page, info, 'Video', { loudness });
    const broken = brokenPackets(file);
    const off = offsets(file);
    rows.push(`even loudness ${loudness ? 'on' : 'off'}: ${broken.length} packets off a whole frame; sound minus picture ${off.join(' ')} ms`);
    expect(broken, `packets of the export's sound that are not one frame (loudness ${loudness})`).toEqual([]);
    expect(off.length, 'all 8 pairs found').toBe(8);
    for (const o of off) expect(Math.abs(o), `sound vs picture: ${off.join(' ')} ms`).toBeLessThanOrEqual(FRAME_MS);
    fs.rmSync(file);
  }
  note(info, 'packets.txt', rows.join('\n'));
  console.log(`SW-A-14 export (${info.project.name}):\n${rows.join('\n')}`);
});

test('a processed sound (a voice effect over 30 s) is kept in whole AAC frames, and the export keeps it on the picture (SW-A-14)', async ({ page }, info) => {
  test.setTimeout(400_000);
  await newProject(page);
  await importFiles(page, 'Media', ['avsync_long.mp4']);
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toHaveCount(1);
  await selectClip(page, clip);
  await tool(page, 'Voice').click();
  await sheet(page).getByRole('radio', { name: 'Echo', exact: true }).click(); // the dry sound passes untouched
  await expect(sheet(page).getByRole('radio', { name: 'Echo', exact: true })).toHaveAttribute('aria-checked', 'true', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  type P = { tracks: { kind: string; clips: { audioAssetId?: string }[] }[] };
  await expect.poll(async () => !!(await storedProject<P>(page)).tracks.find((t) => t.kind === 'main')!.clips[0].audioAssetId, { timeout: 20_000 }).toBe(true);
  const derived = (await storedProject<P>(page)).tracks.find((t) => t.kind === 'main')!.clips[0].audioAssetId!;
  const kept = info.outputPath('processed.m4a');
  await storedFile(page, derived, kept);
  const keptBroken = brokenPackets(kept);
  const file = await exportAs(page, info, 'Video', { loudness: false });
  const off = offsets(file);
  note(info, 'packets.txt', `processed sound: ${keptBroken.length} packets off a whole frame (${keptBroken.slice(0, 6).join('; ')})\nexport: sound minus picture ${off.join(' ')} ms`);
  console.log(`SW-A-14 processed (${info.project.name}): ${keptBroken.length} packets off a whole frame; export ${off.join(' ')} ms`);
  expect(keptBroken, 'packets of the processed sound that are not one frame').toEqual([]);
  expect(off.length, 'all 8 pairs found').toBe(8);
  for (const o of off) expect(Math.abs(o), `sound vs picture: ${off.join(' ')} ms`).toBeLessThanOrEqual(FRAME_MS);
});
