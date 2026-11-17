// A finished export the person has not saved yet survives a reload of the tab (SW-A-15, red team docs/13, lane A's
// redteam-export-reload): on an iPhone Safari takes the page back while the person looks at another app, as often as not
// right after a long export. The file was known only to the export sheet in memory, and the editor opened as if nothing
// had been made. Saved, or let go, it is not offered again and nothing of it stays on the device. Chromium streams the
// file to the origin-private file system; WebKit's test context cannot write there, so its file goes to the media store.
import { expect, test, type Page } from '@playwright/test';
import { audits, importFiles, newProject, note, probe } from './qa-platform-kit';

audits();

const ready = (page: Page) => page.getByText(/Ready: .* MB/);
const offered = (page: Page) => page.getByRole('button', { name: 'Save / Share' });

/** Where a finished file is kept: export files on disk, the note naming it, a copy in the media store. */
const kept = (page: Page) => page.evaluate(async () => {
  const disk: string[] = [];
  try {
    for await (const n of (await navigator.storage.getDirectory() as unknown as { keys(): AsyncIterable<string> }).keys()) if (n.startsWith('export-')) disk.push(n);
  } catch { /* no file system here */ }
  const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const keys = await new Promise<IDBValidKey[]>((ok) => { const r = db.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => ok(r.result); });
  db.close();
  return { disk, note: localStorage.getItem('kadr.keptExport'), stored: keys.filter((k) => typeof k === 'string' && k.includes(':kept-export')).length };
});
const NOTHING = { disk: [], note: null, stored: 0 };

/** A 6 s video exported small; returns what the sheet said of it, once the file is kept for a reload. */
async function exported(page: Page) {
  await newProject(page);
  await importFiles(page, 'Media', ['landscape.mp4']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(ready(page)).toBeVisible({ timeout: 180_000 });
  // The reload comes once the file is kept (a build that keeps nothing goes on after the wait and fails where a person would).
  await expect.poll(async () => !!(await kept(page)).note, { timeout: 30_000 }).toBe(true).catch(() => undefined);
  return (await ready(page).textContent())!;
}

test('a finished export not saved yet is offered again after a reload — the same file, saved from there — and then not again (SW-A-15)', async ({ page }, info) => {
  test.setTimeout(300_000);
  const said = await exported(page);
  const where = await kept(page);
  await page.reload(); // what iOS does to a Safari tab in the background
  await expect(offered(page), 'the finished file is offered after the reload').toBeVisible({ timeout: 30_000 });
  await expect(ready(page), 'the same file').toHaveText(said);
  const dl = page.waitForEvent('download');
  await offered(page).click();
  const d = await dl;
  const file = info.outputPath(d.suggestedFilename());
  await d.saveAs(file);
  const p = probe(file);
  note(info, 'kept.txt', `${said}\nkept: ${JSON.stringify(where)}\nsaved after the reload: ${d.suggestedFilename()}, ${p.duration} s, ${p.video?.codec} ${p.video?.width}x${p.video?.height}, sound ${p.audio?.codec}`);
  expect(d.suggestedFilename()).toMatch(/\.mp4$/);
  expect(p.video?.codec, 'a whole video').toBe('h264');
  expect(p.audio, 'with its sound').toBeTruthy();
  expect(Math.abs(p.duration - 6), 'as long as the timeline').toBeLessThan(0.1);
  // Saved: Done closes the sheet at once, and the file is offered no more.
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByRole('dialog', { name: 'Export' }), 'a saved file is not offered again').toHaveCount(0);
  expect(await kept(page), 'nothing of it stays').toEqual(NOTHING);
});

test('a finished export let go without saving is not offered after a reload, and nothing of it stays (SW-A-15)', async ({ page }) => {
  test.setTimeout(300_000);
  await exported(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'not saved yet' }), 'the first tap warns').toBeVisible();
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.getByRole('dialog', { name: 'Export' })).toHaveCount(0);
  await expect.poll(() => kept(page), { timeout: 10_000 }).toEqual(NOTHING);
  await page.reload();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByRole('dialog', { name: 'Export' }), 'a file let go is not offered').toHaveCount(0);
});

test('«Done» on a file not saved, then the way home and back into the project: not offered, nothing of it stays (SW-A-15, G-3)', async ({ page }) => {
  test.setTimeout(300_000);
  await exported(page);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('.toast').filter({ hasText: 'not saved yet' }), 'it warns: the person has answered').toBeVisible();
  await page.goto('./'); // home by the address: the sheet never closes, its own clean-up never runs
  await page.getByRole('button', { name: /^Open / }).first().click();
  await expect(page.locator('.preview-canvas')).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await expect(page.getByRole('dialog', { name: 'Export' }), 'a file the person said «Done» to is not offered').toHaveCount(0);
  await expect.poll(() => kept(page), { timeout: 10_000 }).toEqual(NOTHING);
});
