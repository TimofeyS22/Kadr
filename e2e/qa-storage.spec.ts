// Data safety (docs/12 stage 3, G5): a full device is said before a file is written, a write cut short by a full
// disk leaves nothing behind, and an iPhone user learns how to keep projects past Safari's 7-day rule.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    const seen: string[] = ((window as unknown as { __toasts: string[] }).__toasts = []);
    new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
      if (!seen.includes(el.textContent ?? '')) seen.push(el.textContent ?? '');
    })).observe(document, { subtree: true, childList: true });
  });
});
const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toasts: string[] }).__toasts);

/** Keys in Kadr's IndexedDB store that hold media: whole files (b:) and chunks (c:). */
const mediaKeys = (page: Page) => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const req = open.result.transaction('kv').objectStore('kv').getAllKeys();
    req.onsuccess = () => resolve((req.result as string[]).filter((k) => /^[bc]:/.test(String(k))));
    req.onerror = () => reject(req.error);
  };
}));

async function newProject(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}
async function importVideo(page: Page, file: string) {
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([fx(file)]);
}

test('the device is almost full: the import says so before writing, and nothing is stored', async ({ page }) => {
  await page.addInitScript(() => { StorageManager.prototype.estimate = async () => ({ usage: 1_000_000_000, quota: 1_020_000_000 }); });
  await newProject(page);
  await importVideo(page, 'reel_ru.mp4');
  await expect.poll(() => toasts(page)).toContainEqual(expect.stringContaining('Not enough storage on this device for “reel_ru.mp4” (8 MB)'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(0);
  expect(await mediaKeys(page)).toEqual([]);
});

test('the disk fills while a file is written in chunks: the chunks already written go, and the message is about storage', async ({ page }) => {
  test.setTimeout(120_000);
  // As Safari in private mode: Blobs are refused (the chunked path), then the second 16 MB chunk does not fit.
  await page.addInitScript(() => {
    const put = IDBObjectStore.prototype.put;
    let chunks = 0;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (value instanceof Blob) throw new DOMException('Blobs are not supported here', 'DataCloneError');
      if (value instanceof ArrayBuffer && ++chunks === 2) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
      return put.call(this, value, key);
    };
  });
  await newProject(page);
  await importVideo(page, 'long_1.mp4'); // 62 MB: four chunks
  await expect.poll(() => toasts(page), { timeout: 60_000 }).toContainEqual(expect.stringContaining('Not enough storage for Kadr on this device'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(0);
  expect(await mediaKeys(page)).toEqual([]);
});

test('iPhone, not on the Home Screen: after the first project with media, Home says how to keep projects; once dismissed it stays away', async ({ page, browserName }) => {
  await newProject(page);
  await importVideo(page, 'reel_ru.mp4');
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.locator('.project-card')).toHaveCount(1);
  const tip = page.getByRole('note').filter({ hasText: 'Add Kadr to the Home Screen' });
  if (browserName !== 'webkit') { await expect(tip).toHaveCount(0); return; } // the iPhone profile is the WebKit one
  await expect(tip).toBeVisible();
  await tip.getByRole('button', { name: 'Got it' }).click();
  await expect(tip).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await expect(tip).toHaveCount(0);
});
