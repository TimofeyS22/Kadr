// A stored file's Blob that stops reading while the preview holds it (S-1-13, docs/19 §10). On the iPhone a camera
// take's Blob died once the take's pieces were deleted: the preview said the decoder stopped, though a fresh read of
// the same record worked. Here the page's Blobs of that file are made to fail as WebKit's did ("NotFoundError: The
// object can not be found here."); the record in IndexedDB stays readable, as it did on the phone. The preview has to
// go on to a frame it has not read yet, without a word. A persistent context stores Blobs as Safari does: the default
// WebKit context keeps chunks, and would never hold a Blob at all.
import { expect, test, type BrowserContext, type Page, type PlaywrightWorkerArgs, type TestInfo } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
/** 60 s of 1080p at 8 Mbit/s: far larger than Mediabunny's 8 MB cache, so a frame near the end needs bytes not read yet. */
const FILE = 'long_1.mp4';
const PX_PER_S = 60;

const setup = () => {
  localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
  localStorage.setItem('kadr.locale', 'en');
  localStorage.setItem('kadr.hint.move', '1');
  localStorage.setItem('kadr.iosVideoTip.v3', '1');
  Object.defineProperty(navigator, 'canShare', { value: undefined });
  const seen: string[] = ((window as unknown as { __toastErrors: string[] }).__toastErrors = []);
  new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => {
    if (!seen.includes(el.textContent ?? '')) seen.push(el.textContent ?? '');
  })).observe(document, { subtree: true, childList: true });
};

/**
 * Lets the test kill the page's Blobs of one size: their reads then fail as WebKit's did (S-1-13). The page's Blobs are
 * the ones read from IndexedDB and the ones read in slices (followed back to the Blob they were cut from). Blobs the
 * page gets afterwards, from a fresh read of the store, live. `__killOnThumbs(size)` kills them the moment a film strip
 * of a file that size starts, as a take's pieces went right after its import.
 */
const killer = () => {
  const dead = new WeakSet<Blob>();
  const root = new WeakMap<Blob, Blob>();
  const tracked = new WeakSet<Blob>();
  const seen: WeakRef<Blob>[] = [];
  const base = (b: Blob) => root.get(b) ?? b;
  const track = (b: Blob) => { if (!tracked.has(b)) { tracked.add(b); seen.push(new WeakRef(b)); } };
  const gone = () => new DOMException('The object can not be found here.', 'NotFoundError');
  const slice = Blob.prototype.slice;
  Blob.prototype.slice = function (this: Blob, ...args: Parameters<Blob['slice']>) {
    const part = slice.apply(this, args);
    const b = base(this);
    root.set(part, b);
    track(b);
    return part;
  };
  // As on the iPhone, a fresh read of the record may give a Blob that is dead too, for a while (up to 2.6 s there).
  let deadFor = { size: 0, until: 0 };
  const result = Object.getOwnPropertyDescriptor(IDBRequest.prototype, 'result')!;
  Object.defineProperty(IDBRequest.prototype, 'result', {
    ...result,
    get(this: IDBRequest) {
      const r: unknown = result.get!.call(this);
      if (r instanceof Blob) { track(r); if (r.size === deadFor.size && performance.now() < deadFor.until) dead.add(r); }
      return r;
    },
  });
  const arrayBuffer = Blob.prototype.arrayBuffer;
  Blob.prototype.arrayBuffer = function (this: Blob) { return dead.has(base(this)) ? Promise.reject(gone()) : arrayBuffer.call(this); };
  const stream = Blob.prototype.stream;
  Blob.prototype.stream = function (this: Blob) {
    return dead.has(base(this)) ? new ReadableStream({ start: (c) => c.error(gone()) }) : stream.call(this);
  } as Blob['stream'];
  const kill = (size: number) => {
    let n = 0;
    for (const w of seen) { const b = w.deref(); if (b && b.size === size) { dead.add(b); n++; } }
    return n;
  };
  const w = window as unknown as { __killBlobs: (size: number, ms?: number) => number; __killOnThumbs: (size: number) => void; __killedOnThumbs: number };
  w.__killBlobs = (size, ms = 0) => { deadFor = { size, until: performance.now() + ms }; return kill(size); };
  let armed = 0;
  w.__killedOnThumbs = 0;
  w.__killOnThumbs = (size) => { armed = size; };
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (this: Worker, message: unknown, ...rest: unknown[]) {
    const job = (message as { job?: { size?: number } } | null)?.job;
    if (armed && job?.size === armed) { w.__killedOnThumbs += kill(armed); armed = 0; }
    return (post as (...a: unknown[]) => void).call(this, message, ...rest);
  } as Worker['postMessage'];
};

/** How many files Kadr's store keeps whole, as Blobs under b:. */
const stored = (page: Page) => page.evaluate(() => new Promise<number>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const all = open.result.transaction('kv').objectStore('kv').getAllKeys();
    all.onsuccess = () => {
      const keys = (all.result as IDBValidKey[]).map(String);
      open.result.close();
      resolve(keys.filter((k) => k.startsWith('b:')).length);
    };
    all.onerror = () => reject(all.error);
  };
}));

const perf = (page: Page) => page.evaluate(() => {
  const p = (window as unknown as { __kadrPerf: { drawn: number; last: { t: number; exact: boolean }; marks: Record<string, number>; leases?: { renewed: number; failed: number } } }).__kadrPerf;
  return { drawn: p.drawn, last: p.last, thumbs: Object.keys(p.marks).some((k) => k.startsWith('thumbs:')), leases: p.leases };
});

const toasts = (page: Page) => page.evaluate(() => (window as unknown as { __toastErrors: string[] }).__toastErrors);

/** A persistent context (Blobs in IndexedDB, as Safari keeps them) with the killer in its page; closed and removed after. */
async function withKadr(playwright: PlaywrightWorkerArgs['playwright'], info: TestInfo, body: (page: Page) => Promise<void>) {
  const { defaultBrowserType, ...use } = info.project.use as Record<string, unknown>;
  void defaultBrowserType;
  const type = info.project.name.includes('webkit') ? playwright.webkit : playwright.chromium;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-lease-'));
  let ctx: BrowserContext | undefined;
  try {
    ctx = await type.launchPersistentContext(dir, { ...use, serviceWorkers: 'block' });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.addInitScript(setup);
    await page.addInitScript(killer);
    await body(page);
  } finally {
    await ctx?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function addLongVideo(page: Page, beforeImport?: () => Promise<void>) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await beforeImport?.();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx(FILE));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 60_000 });
}

test('a Blob that stops reading under the preview is opened again: the next frame comes and nothing is said (S-1-13)', async ({ playwright }, info) => {
  test.setTimeout(240_000);
  const size = fs.statSync(fx(FILE)).size;
  await withKadr(playwright, info, async (page) => {
    await addLongVideo(page);
    // The file is stored as one Blob (the path Safari takes), the first frame is drawn, and the film strip, which
    // reads the file in its own worker, is done: what dies next is the preview's Blob.
    await expect.poll(() => stored(page), { message: 'the file is kept as a Blob' }).toBe(1);
    await expect.poll(async () => (await perf(page)).drawn, { message: 'the first frame' }).toBeGreaterThan(0);
    await expect.poll(async () => (await perf(page)).thumbs, { message: 'the film strip is made', timeout: 60_000 }).toBe(true);

    const killed = await page.evaluate((s) => (window as unknown as { __killBlobs: (n: number) => number }).__killBlobs(s), size);
    expect(killed, 'the Blob the preview reads from').toBeGreaterThan(0);

    // A frame far from anything read so far: its bytes are not in Mediabunny's cache.
    const before = (await perf(page)).drawn;
    await page.locator('.tl-scroll').evaluate((el, px) => { el.scrollLeft = px; }, 45 * PX_PER_S);
    // Soft: where the frame does not come (the build without the door), the test still says what the person was told.
    const soft = expect.configure({ soft: true });
    await soft.poll(async () => { const p = await perf(page); return p.drawn > before && p.last.exact && Math.abs(p.last.t - 45) < 0.1; }, {
      message: 'the exact frame at 0:45 after the Blob died', timeout: 30_000,
    }).toBe(true);
    // And it plays on from there, picture and sound.
    await page.getByRole('button', { name: 'Play' }).click();
    await soft.poll(async () => (await perf(page)).last.t, { message: 'playing on from 0:45', timeout: 15_000 }).toBeGreaterThan(46);
    await page.getByRole('button', { name: 'Pause', exact: true }).click({ timeout: 5000 }).catch(() => undefined);

    expect(await toasts(page), 'no error is shown').toEqual([]);
    const { leases } = await perf(page);
    expect(leases, 'the dead Blob was replaced, and counted').toMatchObject({ failed: 0 });
    expect(leases!.renewed).toBeGreaterThan(0);
  });
});

test('a stored file that stays unreadable for over a second after its Blob dies still plays on, without a word (S-1-13 on the iPhone)', async ({ playwright }, info) => {
  test.setTimeout(240_000);
  const size = fs.statSync(fx(FILE)).size;
  await withKadr(playwright, info, async (page) => {
    await addLongVideo(page);
    await expect.poll(async () => (await perf(page)).thumbs, { message: 'the film strip is made', timeout: 60_000 }).toBe(true);
    // On the iPhone a take's record read again after up to 2.6 s; v1.9.6 gave up after 0.3 s.
    expect(await page.evaluate((s) => (window as unknown as { __killBlobs: (n: number, ms: number) => number }).__killBlobs(s, 1500), size)).toBeGreaterThan(0);
    const before = (await perf(page)).drawn;
    await page.locator('.tl-scroll').evaluate((el, px) => { el.scrollLeft = px; }, 45 * PX_PER_S);
    await expect.configure({ soft: true }).poll(async () => { const p = await perf(page); return p.drawn > before && p.last.exact && Math.abs(p.last.t - 45) < 0.1; }, {
      message: 'the exact frame at 0:45 once the file reads again', timeout: 30_000,
    }).toBe(true);
    expect(await toasts(page), 'no error is shown').toEqual([]);
    const { leases } = await perf(page);
    expect(leases, 'the dead Blob was replaced once the file read again').toMatchObject({ failed: 0 });
    expect(leases!.renewed).toBeGreaterThan(0);
  });
});

test('the film strip of a file whose Blob dies as the strip starts still comes: the worker reads through the same door (S-1-13, docs/19 H8)', async ({ playwright }, info) => {
  test.setTimeout(240_000);
  const size = fs.statSync(fx(FILE)).size;
  await withKadr(playwright, info, async (page) => {
    await addLongVideo(page, () => page.evaluate((s) => (window as unknown as { __killOnThumbs: (n: number) => void }).__killOnThumbs(s), size));
    expect(await page.evaluate(() => (window as unknown as { __killedOnThumbs: number }).__killedOnThumbs), 'the Blobs read so far die as the strip starts').toBeGreaterThan(0);
    await expect.configure({ soft: true }).poll(async () => (await perf(page)).thumbs, { message: 'the film strip is made', timeout: 60_000 }).toBe(true);
    expect(await toasts(page), 'no error is shown').toEqual([]);
    const { leases } = await perf(page);
    expect(leases, 'the dead Blobs were replaced, and counted').toMatchObject({ failed: 0 });
    expect(leases!.renewed).toBeGreaterThan(0);
  });
});
