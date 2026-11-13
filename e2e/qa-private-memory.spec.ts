// A private tab does not hold a whole video in memory (audit V-253). There IndexedDB refuses Blobs and the file is kept
// as 16 MB chunks; reading it used to put every chunk into one Blob that stayed for as long as the project was open, so
// a long take lived in memory twice over and took the tab down. Playwright's default WebKit context refuses Blobs the
// same way. The page is watched for the largest Blob it builds out of buffers and for how many chunks it holds at once,
// while it reads the file as an editing session does: thumbnails, playback, a far seek and an export.
import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const FILE = 'phone_1080_h264.mp4'; // 64 MB: four chunks
const CHUNK = 16 * 1024 * 1024;

type Watch = { __bufferBlobMax: number; __kadrPerf: { marks: Record<string, number>; last: { t: number; exact: boolean }; chunks?: { peak: number; loads: number } } };

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.iosFormatCard.v1', '1'); // the iPhone's "Videos in seconds" card would take the Media tap (D-10)
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
    // The largest Blob or File made out of buffers: bytes that are in the page's memory, not a file on disk.
    const w = window as unknown as { __bufferBlobMax: number; Blob: typeof Blob; File: typeof File };
    w.__bufferBlobMax = 0;
    const watch = <T extends typeof Blob>(Native: T): T => new Proxy(Native, {
      construct(target, args: unknown[], newTarget) {
        const parts = Array.isArray(args[0]) ? args[0] as unknown[] : [];
        const bytes = parts.reduce<number>((n, p) => n + (p instanceof ArrayBuffer || ArrayBuffer.isView(p) ? p.byteLength : 0), 0);
        w.__bufferBlobMax = Math.max(w.__bufferBlobMax, bytes);
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
    w.Blob = watch(Blob);
    w.File = watch(File);
  });
});

/** What Kadr's IndexedDB holds for media: whole files under b:, chunks (and their one record per file) under c:. */
const stored = (page: Page) => page.evaluate(() => new Promise<{ blobs: number; chunks: number }>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const all = open.result.transaction('kv').objectStore('kv').getAllKeys();
    all.onsuccess = () => {
      const keys = (all.result as string[]).map(String);
      open.result.close();
      resolve({ blobs: keys.filter((k) => k.startsWith('b:')).length, chunks: keys.filter((k) => /^c:[^:]+:\d+$/.test(k)).length });
    };
    all.onerror = () => reject(all.error);
  };
}));

const watched = (page: Page) => page.evaluate(() => {
  const w = window as unknown as Watch;
  return { blob: w.__bufferBlobMax, marks: Object.keys(w.__kadrPerf.marks), last: w.__kadrPerf.last, chunks: w.__kadrPerf.chunks };
});

test('a video kept in chunks is read a chunk at a time: thumbnails, playback, a seek and an export', async ({ page, browserName }, info) => {
  test.skip(browserName !== 'webkit', 'only Playwright WebKit\'s default context refuses Blobs');
  test.skip(!fs.existsSync(fx(FILE)), 'needs npm run fixtures');
  test.setTimeout(420_000);
  const size = fs.statSync(fx(FILE)).size;
  const pieces = Math.ceil(size / CHUNK);
  expect(pieces, 'the file is longer than the two chunks that may be held').toBeGreaterThan(2);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx(FILE));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 120_000 });
  expect(await stored(page), 'the chunk path, as in a private tab').toEqual({ blobs: 0, chunks: pieces });

  // The thumbnails take keyframes from the start of the stored file to its end.
  await expect.poll(async () => (await watched(page)).marks.filter((k) => k.startsWith('thumbs:')).length, { message: 'the thumbnails are made', timeout: 120_000 }).toBe(1);
  await expect(page.locator('.tl-row.main .clip canvas, .tl-row.main .clip img').first()).toBeVisible();

  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.getByRole('button', { name: 'Play' }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: 'Pause' }).click();
  expect((await watched(page)).last.t, 'the picture moved while playing').toBeGreaterThan(0.5);

  // A seek into the last chunks of the file, to the exact frame.
  await page.locator('.tl-scroll').evaluate((el) => { el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.85; });
  await expect.poll(async () => { const { last } = await watched(page); return last.exact ? last.t : 0; }, { message: 'the frame after the seek' }).toBeGreaterThan(20);

  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 300_000 });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const out = info.outputPath('private.mp4');
  await (await dl).saveAs(out);

  const probe = (file: string) => JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type:format=duration', '-of', 'json', file]).toString()) as { streams: { codec_type: string }[]; format: { duration: string } };
  const made = probe(out), source = probe(fx(FILE));
  expect(made.streams.map((s) => s.codec_type).sort(), 'picture and sound').toEqual(['audio', 'video']);
  expect(Math.abs(Number(made.format.duration) - Number(source.format.duration)), `the whole video: ${made.format.duration} s of ${source.format.duration}`).toBeLessThan(0.2);

  const seen = await watched(page);
  console.log(`private memory (${info.project.name}): file ${(size / 2 ** 20).toFixed(1)} MB in ${pieces} chunks; largest Blob built from buffers ${(seen.blob / 2 ** 20).toFixed(1)} MB; chunks held at once ${seen.chunks?.peak ?? 'not counted'}, chunk reads ${seen.chunks?.loads ?? 'not counted'}; export ${(fs.statSync(out).size / 2 ** 20).toFixed(1)} MB`);
  // The export itself is a file of a few MB put together in memory here; the source is 64 MB.
  expect(seen.blob, 'no Blob as large as the stored video is put together in memory').toBeLessThanOrEqual(2 * CHUNK + 2 * 2 ** 20);
  expect(seen.chunks?.peak, 'chunks of stored media held at once').toBeLessThanOrEqual(2);
  expect(seen.chunks?.loads, 'the file was read through the chunks').toBeGreaterThanOrEqual(pieces);
  expect(errors).toEqual([]);
});
