// Where a real browser keeps a video (audit V-183). Playwright's default WebKit context is private-like: it refuses Blobs
// in IndexedDB, so the suite only ever ran the 16 MB chunk fallback, and the branch Safari really takes went untested.
// A persistent context stores Blobs as Safari does. The file has to survive a reload and a browser restart byte for byte
// in size and still export. Whether iOS keeps it for days is a phone question (G5, docs/16 N4).
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const FILE = 'landscape.mp4';

const setup = () => {
  localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
  localStorage.setItem('kadr.locale', 'en');
  localStorage.setItem('kadr.hint.move', '1');
  localStorage.setItem('kadr.iosVideoTip.v3', '1');
  localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
  Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
};

/** What Kadr's IndexedDB holds for media: whole files under b: with their sizes, and chunks under c:. */
const stored = (page: Page) => page.evaluate(() => new Promise<{ blobs: number[]; chunks: number }>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const os = open.result.transaction('kv').objectStore('kv');
    const all = os.getAllKeys();
    all.onsuccess = () => {
      const keys = all.result as string[];
      const whole = keys.filter((k) => String(k).startsWith('b:'));
      const out = { blobs: [] as number[], chunks: keys.filter((k) => String(k).startsWith('c:')).length };
      if (!whole.length) { open.result.close(); resolve(out); return; }
      whole.forEach((k) => { const r = os.get(k); r.onsuccess = () => {
        out.blobs.push(r.result instanceof Blob ? r.result.size : -1);
        if (out.blobs.length === whole.length) { open.result.close(); resolve(out); }
      }; });
    };
    all.onerror = () => reject(all.error);
  };
}));

async function addVideo(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx(FILE));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await expect.poll(async () => { const s = await stored(page); return s.blobs.length + s.chunks; }, { message: 'the file reaches storage' }).toBeGreaterThan(0);
  await page.waitForTimeout(1000); // autosave
}

test('Safari\'s own storage path: the video is kept as a file, survives a reload and a browser restart, and still exports', async ({ playwright }, info) => {
  test.setTimeout(300_000);
  const { defaultBrowserType, ...use } = info.project.use as Record<string, unknown>;
  void defaultBrowserType;
  const type = info.project.name.includes('webkit') ? playwright.webkit : playwright.chromium;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-safari-storage-'));
  const size = fs.statSync(fx(FILE)).size;
  const open = async () => {
    const ctx: BrowserContext = await type.launchPersistentContext(dir, { ...use, serviceWorkers: 'block', acceptDownloads: true });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.addInitScript(setup);
    return { ctx, page };
  };
  try {
    let { ctx, page } = await open();
    await addVideo(page);
    expect(await stored(page), 'one whole Blob, no chunks').toEqual({ blobs: [size], chunks: 0 });

    await page.reload();
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    expect((await stored(page)).blobs).toEqual([size]);

    await ctx.close();
    ({ ctx, page } = await open());
    await page.goto('./');
    await page.getByRole('button', { name: /^Open / }).first().click();
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
    expect((await stored(page)).blobs, 'after the browser was closed').toEqual([size]);

    await page.getByRole('button', { name: 'Export' }).first().click();
    await page.getByRole('radio', { name: 'Video', exact: true }).click();
    await page.getByRole('radio', { name: 'Small file' }).click();
    await page.getByRole('button', { name: 'Export video' }).click();
    await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
    const dl = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Save / Share' }).click();
    const out = info.outputPath('after-restart.mp4');
    await (await dl).saveAs(out);
    const j = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', out]).toString()) as { streams: { codec_type: string }[]; format: { duration: string } };
    expect(j.streams.map((s) => s.codec_type).sort()).toEqual(['audio', 'video']);
    expect(Math.abs(Number(j.format.duration) - 6)).toBeLessThan(0.15);
    await ctx.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the control: a private-like context takes the chunk path, so the check above tells the two apart', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'only Playwright WebKit\'s default context refuses Blobs');
  await page.addInitScript(setup);
  await addVideo(page);
  const s = await stored(page);
  expect(s.blobs).toEqual([]);
  expect(s.chunks).toBeGreaterThan(0);
});
