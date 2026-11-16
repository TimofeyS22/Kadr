// QA matrix Q-5, import: the file picker, drag and drop, Share → Kadr. docs/11 §3.1 (to the file) and §3.5 (edges).
// What editor.spec.ts already proves: two files from the picker, a dropped PNG, a shared video landing on the
// timeline, hostile files, wrong extensions, a two-file import as one undo step. Here: what was picked, dropped or
// shared reaches the exported file, frame for frame and in order; a cancelled pick, a double tap, twelve files at
// once, a file added after a speed change or while playing, and a drop that holds no file.
import { expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { closeTools, counterAt, errorToasts, exportAs, fx, importFiles, mainNames, newProject, probe, scrubTo, selectClip, time, tool, toasts, watch, test } from './qa-media-kit';

let privateCheck: () => void;
test.beforeEach(async ({ page }) => { privateCheck = await watch(page); });
test.afterEach(async ({ page }) => {
  privateCheck();
  expect(await errorToasts(page), 'error toasts').toEqual([]);
});

/** Drops `files` (fixture name → name the drop gives it) onto the editor, as a drag from Finder or Files does. */
async function drop(page: Page, files: [string, string][]) {
  const data = files.map(([f, name]) => ({ name, type: f.endsWith('.png') ? 'image/png' : 'video/mp4', b64: fs.readFileSync(fx(f)).toString('base64') }));
  await page.evaluate((list) => {
    const dt = new DataTransfer();
    for (const f of list) dt.items.add(new File([Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0))], f.name, { type: f.type }));
    const target = document.querySelector('.editor')!;
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, data);
}

test('files picked and dropped reach the exported file frame for frame, in the order they went in (QA matrix Q-5)', async ({ page }, info) => {
  test.setTimeout(300_000);
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  await importFiles(page, 'Media', ['counter.mp4', 'photo.png']); // 6 s, frame N written in binary; a 3 s photo
  await expect(main).toHaveCount(2);
  await closeTools(page);
  await scrubTo(page, 9, '0:09.0');
  await drop(page, [['counter.mp4', 'dropped.mp4']]);
  await expect(main).toHaveCount(3, { timeout: 30_000 });
  await expect.poll(() => mainNames(page)).toEqual(['counter.mp4', 'photo.png', 'dropped.mp4']);
  await closeTools(page);

  const video = await exportAs(page, info, 'Video', 'Export video');
  const pr = probe(video);
  expect(pr.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
  expect(Math.abs(Number(pr.format.duration) - 15), 'picked 6 s + 3 s, dropped 6 s').toBeLessThan(0.1);
  const rows: string[] = [];
  for (const [k, want] of [[30, 30], [150, 150], [9 * 30 + 45, 45], [14 * 30, 150]] as const) {
    const got = counterAt(video, k);
    rows.push(`frame ${k}: ${got} (expected ${want})`);
    expect.soft(got, `video frame ${k}`).toBe(want);
  }
  console.log(`picked and dropped (${info.project.name}): ${rows.join(', ')}`);
});

// Web Share Target is Android Chrome's: iOS gives web apps no place in the share sheet. The service worker's path is
// the same on both engines, so it runs on both.
test('a video shared to Kadr reaches the exported file frame for frame (QA matrix Q-5, Share → Kadr)', async ({ page }, info) => {
  test.setTimeout(240_000);
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => { await page.reload(); return page.evaluate(() => !!navigator.serviceWorker.controller); }).toBe(true);
  // What Android does on "Share → Kadr": a multipart POST navigation to the manifest's share_target action.
  await page.evaluate(() => {
    const f = Object.assign(document.createElement('form'), { method: 'POST', action: 'share-target', enctype: 'multipart/form-data' });
    f.innerHTML = '<input type="file" name="media" id="shared-media" multiple>';
    document.body.append(f);
  });
  await page.setInputFiles('#shared-media', fx('counter.mp4'));
  await page.evaluate(() => (document.querySelector('form[action="share-target"]') as HTMLFormElement).submit());
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 30_000 });
  await closeTools(page);
  const video = await exportAs(page, info, 'Video', 'Export video');
  expect(Math.abs(Number(probe(video).format.duration) - 6)).toBeLessThan(0.1);
  for (const k of [0, 45, 179]) expect.soft(counterAt(video, k), `video frame ${k}`).toBe(k);
});

test('import edges: a cancelled pick, a double tap, twelve files at once in order and as one undo step, a file after a speed change and while playing, a drop with no file (QA matrix Q-5)', async ({ page }, info) => {
  test.setTimeout(300_000);
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);

  // A cancelled pick: nothing added, nothing said, nothing left busy.
  let chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([]);
  await page.waitForTimeout(1000);
  await expect(main).toHaveCount(0);
  await expect(page.locator('.busy')).toHaveCount(0);
  expect(await toasts(page)).toEqual([]);

  // A double tap on Media: one picker answered, the other closed — one file in, once.
  const choosers: Promise<unknown>[] = [];
  page.on('filechooser', (c) => { choosers.push(c.setFiles(choosers.length ? [] : [fx('photo.png')])); });
  await tool(page, 'Media').dblclick();
  await expect(main).toHaveCount(1, { timeout: 30_000 });
  await Promise.all(choosers);
  page.removeAllListeners('filechooser');
  await page.waitForTimeout(1000);
  await expect(main).toHaveCount(1);
  console.log(`double tap on Media (${info.project.name}): ${choosers.length} picker(s)`);
  await closeTools(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(0);

  // Twelve files in one pick: all in, in the order picked, and one Undo takes them all away.
  const twelve = Array.from({ length: 12 }, (_, i) => (i % 2 ? 'person.jpg' : 'photo.png'));
  await importFiles(page, 'Media', twelve);
  await expect(main).toHaveCount(12, { timeout: 120_000 });
  await expect.poll(() => mainNames(page)).toEqual(twelve);
  await closeTools(page);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(0);
  await page.getByRole('button', { name: 'Redo' }).click();
  await expect(main).toHaveCount(12);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect(main).toHaveCount(0);

  // After a speed change: the counter at 2× lasts 3 s; a file added at its end goes after it.
  await importFiles(page, 'Media', ['counter.mp4']);
  await expect(main).toHaveCount(1);
  await selectClip(main.first());
  await tool(page, 'Speed').click();
  await page.getByRole('radio', { name: '2×' }).click();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.busy')).toHaveCount(0, { timeout: 60_000 });
  await closeTools(page);
  await scrubTo(page, 3, '0:03.0');
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(main).toHaveCount(2, { timeout: 30_000 });
  await expect.poll(() => mainNames(page)).toEqual(['counter.mp4', 'landscape.mp4']);
  await closeTools(page);

  // While playing: the file goes in, playback can be stopped, nothing breaks.
  await scrubTo(page, 0, '0:00.0');
  await page.getByRole('button', { name: 'Play' }).click();
  await expect.poll(async () => parseFloat((await time(page))!.split(':')[1]), { timeout: 15_000 }).toBeGreaterThan(0.3);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(main).toHaveCount(3, { timeout: 30_000 });
  await closeTools(page);
  const pause = page.getByRole('button', { name: 'Pause', exact: true });
  if (await pause.isVisible()) await pause.click();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();

  // A drag that carries text, not a file: nothing happens.
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.setData('text/plain', 'not a file');
    const target = document.querySelector('.editor')!;
    for (const type of ['dragenter', 'dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(1000);
  await expect(main).toHaveCount(3);
  await expect(page.locator('.busy')).toHaveCount(0);

  // All of it reaches the file: 3 s of the counter at 2×, 6 s of landscape and the 3 s photo (at the clip boundary
  // nearest the playhead when it went in) — 12 s.
  const video = await exportAs(page, info, 'Video', 'Export video');
  expect(Math.abs(Number(probe(video).format.duration) - 12)).toBeLessThan(0.1);
  console.log(`import edges (${info.project.name}): main track ${(await mainNames(page)).join(', ')}`);
});

// A file's name is the sender's: any name is possible, markup too (docs/11 §3.15).
test('file names that are markup are shown as the text they are: a photo goes in under its name, a refused file is named, nothing of either runs (QA matrix Q-5, §3.8, §3.15)', async ({ page }, info) => {
  const main = page.locator('.tl-row.main .clip');
  await newProject(page);
  const photoName = '<img src=x onerror="window.__xss=1">.png';
  const junkName = '<b onmouseover="window.__xss=2">clip</b>.mp4';
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([
    { name: photoName, mimeType: 'image/png', buffer: fs.readFileSync(fx('photo.png')) },
    { name: junkName, mimeType: 'video/mp4', buffer: Buffer.from('not a video at all, only words') },
  ]);
  await expect(main).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => errorToasts(page), { message: 'the refused file is named' }).toContainEqual(expect.stringContaining(junkName));
  await expect.poll(() => mainNames(page)).toEqual([photoName]);
  await closeTools(page);
  const made = await page.evaluate(() => ({
    xss: (window as unknown as { __xss?: number }).__xss,
    img: document.querySelectorAll('img[src="x"]').length,
    bold: [...document.querySelectorAll('b[onmouseover]')].length,
  }));
  console.log(`markup names (${info.project.name}): errors ${JSON.stringify(await errorToasts(page))}; ${JSON.stringify(made)}`);
  expect(made, 'no element was made of a name and nothing ran').toEqual({ xss: undefined, img: 0, bold: 0 });
  await page.evaluate(() => { (window as unknown as { __toastErrors: string[] }).__toastErrors.length = 0; }); // the refusal above is expected
});
