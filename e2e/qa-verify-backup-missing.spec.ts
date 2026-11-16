// Sweep lane E2 (docs/21 §5): V-236 — a backup is not announced as whole when media are missing from it.
// The unit test (src/engine/backup.test.ts) counts the missing file; this one checks that the person is told, on the
// screen where the backup is made, before the copy is needed. Red on a build where the count or the message is gone.
import { expect, test } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

// As the editor suite starts: tips seen, the iPhone format card seen, English, and the export sheet instead of the one-tap export.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1');
    if (!localStorage.getItem('kadr.exportPrefs')) localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  });
});

test('a backup with a media file missing from the device says so when it is saved (V-236)', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
  await page.getByRole('textbox', { name: 'Project name' }).fill('Holes');
  await page.waitForTimeout(1500); // on disk
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: 'Open Holes', exact: true })).toBeVisible();

  // The media file leaves the device (evicted, a failed write); the project still refers to it.
  const removed = await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
    const keys = await new Promise<IDBValidKey[]>((ok) => { const r = db.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => ok(r.result); });
    const media = keys.filter((k) => typeof k === 'string' && (k.startsWith('b:') || k.startsWith('c:')));
    await new Promise((ok) => { const tx = db.transaction('kv', 'readwrite'); for (const k of media) tx.objectStore('kv').delete(k); tx.oncomplete = ok; });
    db.close();
    return media.length;
  });
  expect(removed, 'the video was stored in IndexedDB').toBeGreaterThan(0);

  await page.getByRole('button', { name: 'Save a backup of Holes' }).click();
  // The word comes before the copy is handed to the share sheet or the downloads (WebKit here offers the share sheet).
  await expect(page.getByText(/1 media files of this project are missing from this device/)).toBeVisible({ timeout: 15_000 });
});
