// QA matrix Q-4, backup and restore, docs/11 §3.5 (edges) and §3.8 (errors). What editor.spec.ts already proves: the
// round trip (home…), ten forged backups (hostile backups…), damaged clips (S-1-3), zip signatures in a video (V-188),
// the frame size (V-210). Here: an empty project, a 60 s 1080p video, the same backup twice, a cancelled pick, a
// double tap, a device without room and a restore that fails halfway. Persistent contexts: IndexedDB keeps Blobs as
// Safari does (the default WebKit context takes the chunk path, docs/19). There WebKit showed SW-A-4: a stored Blob
// cut out of the picked backup was kept as the whole backup, so every restored file was the zip and nothing played.
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { closeTools, counterAt, errorToasts, exportAs, fx, importFiles, meanAbsDiff, newProject, probe, rgbAt, scrubTo, selectClip, stored, time, toasts, tool, withKadr } from './qa-media-kit';

const back = (page: Page) => page.getByRole('button', { name: 'Back to projects' }).click();
const opens = (page: Page, name: string) => page.getByRole('button', { name: `Open ${name}`, exact: true });
/** The name of the project edited last (the list is newest first). */
const newest = async (page: Page) => (await page.locator('.project-open').first().getAttribute('aria-label'))!.replace(/^Open /, '');

async function saveBackup(page: Page, info: TestInfo, name: string) {
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: `Save a backup of ${name}`, exact: true }).click();
  const file = info.outputPath(`${Date.now()}-${(await dl).suggestedFilename()}`);
  await (await dl).saveAs(file);
  return file;
}

async function restore(page: Page, file: string | string[]) {
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Restore backup' }).click();
  await (await chooser).setFiles(file);
}

/** SHA-256 of every file Kadr keeps, as hex, read in the page: whole (b:) or in chunks (c:<id> and its c:<id>:<n>). */
const hashes = (page: Page) => page.evaluate(async () => {
  const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const ask = <T>(make: (s: IDBObjectStore) => IDBRequest) => new Promise<T>((ok, ko) => {
    const r = make(db.transaction('kv').objectStore('kv'));
    r.onsuccess = () => ok(r.result as T); r.onerror = () => ko(r.error);
  });
  const keys = (await ask<IDBValidKey[]>((s) => s.getAllKeys())).map(String);
  const files: (() => Promise<ArrayBuffer>)[] = [
    ...keys.filter((k) => k.startsWith('b:')).map((k) => async () => (await ask<Blob>((s) => s.get(k))).arrayBuffer()),
    ...keys.filter((k) => /^c:[^:]+$/.test(k)).map((k) => async () => {
      const meta = await ask<{ chunks: number }>((s) => s.get(k));
      const parts: ArrayBuffer[] = [];
      for (let i = 0; i < meta.chunks; i++) parts.push(await ask<ArrayBuffer>((s) => s.get(`${k}:${i}`)));
      return new Blob(parts).arrayBuffer();
    }),
  ];
  const out: string[] = [];
  for (const read of files) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', await read()));
    out.push([...d].map((x) => x.toString(16).padStart(2, '0')).join(''));
  }
  db.close();
  return out.sort();
});
const sha = (f: string) => createHash('sha256').update(fs.readFileSync(fx(f))).digest('hex');

test('backup edges: an empty project and a 60 s 1080p video come back whole; the same backup twice gives two projects with their own media; a cancelled pick and a double tap change nothing (QA matrix Q-4)', async ({ playwright }, info) => {
  test.setTimeout(600_000);
  await withKadr(playwright, info, async (page) => {
    // A big project: a 60 s 1080p video (60 MB) and a photo. Made first: with two projects listed, the home screen's
    // "New project" is under the second one's buttons (SW-A-3, lane U), and this test is about backups.
    await newProject(page);
    await importFiles(page, 'Media', ['long_1.mp4', 'photo.png']);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(2, { timeout: 120_000 });
    await page.waitForTimeout(1500); // autosave
    await back(page);
    const name = await newest(page);
    expect(name).toBe('Project 1');
    const big = await saveBackup(page, info, name);
    expect(fs.statSync(big).size, 'the video and the photo are in the backup').toBeGreaterThan(fs.statSync(fx('long_1.mp4')).size + fs.statSync(fx('photo.png')).size);
    execFileSync('unzip', ['-tq', big]); // a whole zip

    // An empty project: its backup restores as an empty project, not as an error.
    await newProject(page);
    await back(page);
    await expect(opens(page, 'Project 2')).toBeVisible();
    const empty = await saveBackup(page, info, 'Project 2');
    await restore(page, empty);
    await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('.tl-row .clip')).toHaveCount(0);
    await back(page);
    await expect(opens(page, 'Project 2 (restored)')).toBeVisible();

    // A cancelled pick: no busy line left behind, no project, nothing said.
    const listed = await page.locator('.project-open').count();
    await restore(page, []);
    await expect(page.getByRole('button', { name: 'Restore backup' })).toBeVisible();
    await page.waitForTimeout(1000);
    expect(await page.locator('.project-open').count()).toBe(listed);

    // Restored twice: two projects, each with its own copy of every file, byte for byte.
    await restore(page, big);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(2, { timeout: 120_000 });
    await back(page);
    await restore(page, big);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(2, { timeout: 120_000 });
    await back(page);
    await expect(opens(page, `${name} (restored)`)).toHaveCount(2);
    const want = [sha('long_1.mp4'), sha('photo.png')];
    expect(await hashes(page), 'three copies of each file: the project and its two restores').toEqual([...want, ...want, ...want].sort());

    // One restore deleted: the other keeps its media, plays at 0:45 and its frame is drawn.
    await page.getByRole('button', { name: `Delete ${name} (restored)`, exact: true }).first().click();
    await page.getByRole('dialog', { name: /^Delete “/ }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(opens(page, `${name} (restored)`)).toHaveCount(1);
    expect(await hashes(page)).toEqual([...want, ...want].sort());
    await opens(page, `${name} (restored)`).click();
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(2, { timeout: 60_000 });
    const drawn = () => page.evaluate(() => (window as unknown as { __kadrPerf: { drawn: number; last: { t: number; exact: boolean } } }).__kadrPerf);
    await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = 45 * 60; });
    await expect.poll(() => time(page)).toBe('0:45.0');
    await expect.poll(async () => { const p = await drawn(); return p.last.exact && Math.abs(p.last.t - 45) < 0.1; }, { message: 'the exact frame at 0:45', timeout: 60_000 }).toBe(true);
    await back(page);

    // A double tap on the backup button: no error, and every file that comes is a whole backup of the project.
    const files: string[] = [];
    page.on('download', (d) => { const f = info.outputPath(`double-${files.length}-${d.suggestedFilename()}`); files.push(f); void d.saveAs(f); });
    await page.getByRole('button', { name: `Save a backup of ${name}`, exact: true }).dblclick();
    await expect.poll(() => files.length, { timeout: 120_000 }).toBeGreaterThan(0);
    await expect(page.getByRole('button', { name: 'Restore backup' })).toBeVisible({ timeout: 120_000 });
    await page.waitForTimeout(3000);
    for (const f of files) {
      await expect.poll(() => fs.existsSync(f) && fs.statSync(f).size, { timeout: 60_000 }).toBe(fs.statSync(big).size);
      execFileSync('unzip', ['-tq', f]);
    }
    console.log(`double tap on backup (${info.project.name}): ${files.length} file(s)`);
    expect(await errorToasts(page), 'no error is shown').toEqual([]);
  });
});

test('a restored project exports the same video as the project it was saved from; the restore is no step to undo, an edit after it is one (QA matrix Q-4, §3.1–3.3)', async ({ playwright }, info) => {
  test.setTimeout(420_000);
  await withKadr(playwright, info, async (page) => {
    const main = page.locator('.tl-row.main .clip');
    const undo = page.getByRole('button', { name: 'Undo' });
    await newProject(page);
    await importFiles(page, 'Media', ['counter.mp4', 'photo.png']); // 6 s, frame N written in binary; a 3 s photo
    await expect(main).toHaveCount(2, { timeout: 60_000 });
    await closeTools(page);
    const original = await exportAs(page, info, 'Video', 'Export video');
    await page.waitForTimeout(1500); // autosave
    await back(page);
    const file = await saveBackup(page, info, 'Project 1');
    await restore(page, file);
    await expect(main).toHaveCount(2, { timeout: 60_000 });
    await expect(undo, 'a restored project starts with nothing to undo').toBeDisabled();
    const restored = await exportAs(page, info, 'Video', 'Export video');
    const [a, b] = [probe(original), probe(restored)];
    const rows = [`duration ${a.format.duration} → ${b.format.duration}`];
    expect(b.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(Math.abs(Number(b.format.duration) - Number(a.format.duration)), 'as long as the original').toBeLessThan(0.05);
    for (const k of [0, 45, 179]) {
      const [was, is] = [counterAt(original, k), counterAt(restored, k)];
      rows.push(`frame ${k}: ${was} → ${is}`);
      expect.soft(is, `video frame ${k}`).toBe(k);
      expect.soft(was, `the original's frame ${k}`).toBe(k);
    }
    const photoDiff = meanAbsDiff(rgbAt(original, 225), rgbAt(restored, 225));
    rows.push(`the photo at 7.5 s: mean difference ${photoDiff.toFixed(2)}`);
    expect.soft(photoDiff, 'the photo, as it was').toBeLessThan(1);
    console.log(`restored export (${info.project.name}): ${rows.join('; ')}`);
    // An edit after the restore is one step, and undoing it leaves the restored project as it came.
    await scrubTo(page, 3, '0:03.0');
    await selectClip(main.first());
    await tool(page, 'Split').click();
    await expect(main).toHaveCount(3);
    await closeTools(page);
    await undo.click();
    await expect(main).toHaveCount(2);
    await expect(undo).toBeDisabled();
    expect(await errorToasts(page), 'no error is shown').toEqual([]);
  });
});

test('a restore without room says so before writing, and one that fails halfway takes its files back: the device keeps what it had (QA matrix Q-4)', async ({ playwright }, info) => {
  test.setTimeout(300_000);
  await withKadr(playwright, info, async (page) => {
    await newProject(page);
    await importFiles(page, 'Media', ['landscape.mp4', 'photo.png']);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(2, { timeout: 60_000 });
    await page.waitForTimeout(1500); // autosave
    await back(page);
    const file = await saveBackup(page, info, 'Project 1');
    const before = await stored(page);
    expect(before.length).toBeGreaterThan(0);

    // The device is almost full: said before a byte is written, nothing stored, no project.
    await page.evaluate(() => { StorageManager.prototype.estimate = async () => ({ usage: 1_000_000_000, quota: 1_010_000_000 }); });
    await restore(page, file);
    await expect.poll(() => errorToasts(page)).toContainEqual(expect.stringMatching(/Could not restore: Not enough storage on this device for “Project 1”/));
    await expect(page.getByRole('button', { name: 'Restore backup' })).toBeVisible();
    expect(await stored(page), 'nothing was written').toEqual(before);
    await expect(page.locator('.project-open')).toHaveCount(1);

    // Room is said to be there, but the disk fills on the second file: the first one written goes again.
    await page.evaluate(() => {
      StorageManager.prototype.estimate = async () => ({ usage: 0, quota: 10e9 });
      const put = IDBObjectStore.prototype.put;
      let files = 0;
      IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
        if (typeof key === 'string' && /^[bc]:[^:]+$/.test(key) && ++files === 2) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
        return put.call(this, value, key);
      };
    });
    await restore(page, file);
    await expect.poll(() => errorToasts(page)).toContainEqual(expect.stringMatching(/Could not restore:/));
    await expect(page.getByRole('button', { name: 'Restore backup' })).toBeVisible();
    await expect.poll(() => stored(page), { message: 'the file written before the disk filled is gone again' }).toEqual(before);
    await expect(page.locator('.project-open')).toHaveCount(1);
    const said = [...await errorToasts(page), ...await toasts(page)].join('\n');
    expect(said, 'the person is told it is about storage').toMatch(/storage|space|quota/i);
  });
});

// The owner's iPhone, 2026-11-23: in the Kadr on the Home Screen the projects made in Safari were not there — that app
// keeps its own storage — and moving them took one backup per project. Safari's note on the Home Screen now saves a
// copy of every project in one file, and «Restore backup» brings all of them back (SW-A-22). Two persistent profiles
// stand for Safari and the Home Screen app.
test('every project goes from Safari to the Home Screen app in one file: saved from the note, restored as all of them (SW-A-22)', async ({ playwright }, info) => {
  test.skip(!info.project.name.includes('webkit'), 'the note is Safari on the iPhone’s');
  test.setTimeout(300_000);
  let file = '';
  await withKadr(playwright, info, async (page) => {
    await newProject(page);
    await importFiles(page, 'Media', ['landscape.mp4']);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Project name' }).fill('Sea');
    await page.waitForTimeout(1500); // autosave
    await back(page);
    await newProject(page);
    await importFiles(page, 'Media', ['photo.png']);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await page.getByRole('textbox', { name: 'Project name' }).fill('Photo');
    await page.waitForTimeout(1500);
    await back(page);
    await expect(page.locator('.project-open')).toHaveCount(2);
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save a copy of every project' }).click();
    file = info.outputPath(`all-${(await dl).suggestedFilename()}`);
    await (await dl).saveAs(file);
    execFileSync('unzip', ['-tq', file]);
    const names = execFileSync('unzip', ['-Z1', file]).toString().trim().split('\n').sort();
    expect(names.filter((n) => n.endsWith('project.json'))).toEqual(['projects/0/project.json', 'projects/1/project.json']);
  });
  await withKadr(playwright, info, async (page) => {
    await page.goto('./');
    await expect(page.locator('.project-open')).toHaveCount(0); // a storage of its own, as the Home Screen app's
    await restore(page, file);
    await expect(page.locator('.project-open')).toHaveCount(2, { timeout: 60_000 });
    for (const name of ['Sea (restored)', 'Photo (restored)']) await expect(opens(page, name)).toBeVisible();
    expect(await toasts(page)).toContain('Projects restored: 2');
    await opens(page, 'Sea (restored)').click();
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    await expect(page.locator('.preview-canvas')).toBeVisible();
    expect(await errorToasts(page)).toEqual([]);
  });
});
