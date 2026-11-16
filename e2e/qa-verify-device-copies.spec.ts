// Verification, lane E4 (docs/21 §5): what a deleted thing leaves on the device, checked where the product does it.
// The tests that closed these rows held a helper (V-126: `withUsedAssets`) or one kind of file (V-189: the export);
// a revert of the call itself, or of the other kind, passed them.
//   V-126 — a video deleted from the project leaves the device the next time the project opens;
//   V-189 — deleting a project removes its backup from the device, on WebKit too (a persistent context, as Safari
//           keeps files; the older test, on the export, runs on Chromium only).
import { expect, test, type BrowserContext, type Page, type PlaywrightWorkerArgs, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

const SETUP = () => {
  localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
  localStorage.setItem('kadr.locale', 'en');
  localStorage.setItem('kadr.hint.move', '1');
  localStorage.setItem('kadr.iosVideoTip.v3', '1');
  localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
};
test.beforeEach(async ({ page }) => { await page.addInitScript(SETUP); });

async function newProjectWith(page: Page, files: string[]) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(files.map(fx));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(files.length, { timeout: 60_000 });
}

/** The media files Kadr's IndexedDB keeps: a whole file is `b:<id>`, a file in chunks has its record at `c:<id>`. */
const storedMedia = (page: Page) => page.evaluate(() => new Promise<string[]>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const all = open.result.transaction('kv').objectStore('kv').getAllKeys();
    all.onsuccess = () => {
      open.result.close();
      resolve((all.result as string[]).map(String).filter((k) => /^(b|c):[^:]+$/.test(k)).map((k) => k.slice(2)).sort());
    };
    all.onerror = () => reject(all.error);
  };
}));

const diskFiles = (page: Page) => page.evaluate(async () => {
  const out: string[] = [];
  try {
    const root = await navigator.storage.getDirectory();
    for await (const n of (root as unknown as { keys(): AsyncIterable<string> }).keys()) out.push(n);
  } catch { /* no file system here */ }
  return out;
});

test('a video deleted from the project leaves the device the next time the project opens (audit V-126)', async ({ page }) => {
  test.setTimeout(180_000);
  await newProjectWith(page, ['landscape.mp4', 'portrait.mp4']);
  await expect.poll(() => storedMedia(page), { message: 'both videos are stored' }).toHaveLength(2);
  await page.getByRole('textbox', { name: 'Project name' }).fill('Twin');
  const clips = page.locator('.tl-row.main .clip');
  await clips.last().click();
  await page.keyboard.press('Delete');
  await expect(clips).toHaveCount(1);
  await page.waitForTimeout(1500); // the autosave
  // While the project is open the video stays: Undo can still bring its clip back.
  expect(await storedMedia(page)).toHaveLength(2);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await page.getByRole('button', { name: 'Open Twin', exact: true }).click();
  await expect(clips).toHaveCount(1, { timeout: 30_000 });
  await expect.poll(() => storedMedia(page), { message: 'the deleted video is gone from the device', timeout: 15_000 }).toHaveLength(1);
});

/**
 * A persistent context keeps files as Safari does: Playwright WebKit's default one has no writable file system, so the
 * export and the backup stay in memory there and the older V-189 test skips WebKit.
 */
async function persistent(playwright: PlaywrightWorkerArgs['playwright'], info: TestInfo, body: (page: Page) => Promise<void>) {
  const { defaultBrowserType, ...use } = info.project.use as Record<string, unknown>;
  void defaultBrowserType;
  const type = info.project.name.includes('webkit') ? playwright.webkit : playwright.chromium;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-e4-'));
  let ctx: BrowserContext | undefined;
  try {
    ctx = await type.launchPersistentContext(dir, { ...use, serviceWorkers: 'block' });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.addInitScript(SETUP);
    await body(page);
  } finally {
    await ctx?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('deleting a project removes its backup from the device, as the dialog says (audit V-189)', async ({ playwright }, info) => {
  test.setTimeout(240_000);
  await persistent(playwright, info, async (page) => {
    page.on('dialog', (d) => void d.accept());
    await newProjectWith(page, ['landscape.mp4']);
    await page.getByRole('textbox', { name: 'Project name' }).fill('Secret');
    await page.getByRole('button', { name: 'Export' }).first().click();
    await page.getByRole('radio', { name: 'Small file' }).click();
    await page.getByRole('button', { name: 'Export video' }).click();
    await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 180_000 });
    const exported = (await diskFiles(page)).filter((n) => n.startsWith('export-'));
    // The export's own file leaves when its sheet closes (ExportSheet.tsx); the backup is made on the home screen and
    // only the delete removes it.
    await page.getByRole('button', { name: 'Export again' }).click();
    await page.getByRole('button', { name: 'Back to projects' }).click();
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save a backup of Secret' }).click();
    await dl;
    const kept = await diskFiles(page);
    console.log(`files on the device (${info.project.name}): at Ready ${exported.join(', ') || 'none'}; before the delete ${kept.join(', ') || 'none'}`);
    test.skip(!kept.some((n) => n.startsWith('backup-')), 'this engine packs the backup in memory even here: there is no file on the device to remove');
    await page.getByRole('button', { name: 'Delete Secret' }).click();
    await page.getByRole('dialog', { name: /^Delete “/ }).getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Open Secret', exact: true })).toHaveCount(0, { timeout: 10_000 });
    await expect.poll(async () => (await diskFiles(page)).filter((n) => n.startsWith('backup-') || n.startsWith('export-')), { message: 'the backup left the device', timeout: 10_000 }).toEqual([]);
  });
});
