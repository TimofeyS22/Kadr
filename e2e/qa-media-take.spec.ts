// A camera take is stored as its own bytes (docs/19 ADR-М5, S-1-13). The take used to be read back from the store as
// Blobs, put together into one File and saved again as the asset's Blob, and then its pieces were deleted. On the
// iPhone that saved Blob stopped reading the moment the pieces went: the preview said the decoder stopped (S-1-13),
// a film strip stayed empty (S-1-13-1). That is the trigger, and it lives only on a phone; what a Mac can show is the
// shape that makes it impossible: no Blob of the take is ever saved, its bytes are the stored file's chunks, and the
// pieces are gone once the take is in. A persistent context keeps Blobs as Safari does (the default WebKit one keeps
// none, so an old build would take the chunk path there and prove nothing).
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const setup = () => {
  localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
  localStorage.setItem('kadr.locale', 'en');
  localStorage.setItem('kadr.hint.move', '1');
  localStorage.setItem('kadr.iosVideoTip.v3', '1');
  // A synthetic camera: a moving picture and a tone, so the test runs headless.
  MediaDevices.prototype.getUserMedia = async function (want?: MediaStreamConstraints) {
    const c = Object.assign(document.createElement('canvas'), { width: 640, height: 360 });
    const g = c.getContext('2d')!;
    let f = 0;
    setInterval(() => {
      g.fillStyle = '#000'; g.fillRect(0, 0, 640, 360);
      g.fillStyle = `hsl(${(f++ * 7) % 360} 70% 50%)`; g.fillRect(0, 0, 640, 60);
    }, 33);
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const dest = ctx.createMediaStreamDestination();
    osc.connect(dest);
    osc.start();
    return new MediaStream([...(want?.video ? c.captureStream(30).getVideoTracks() : []), ...dest.stream.getAudioTracks()]);
  };
};

/** Every key of Kadr's store with the kind of value under it. */
const store = (page: Page) => page.evaluate(() => new Promise<{ key: string; kind: string }[]>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const out: { key: string; kind: string }[] = [];
    const cursor = open.result.transaction('kv').objectStore('kv').openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) { open.result.close(); resolve(out); return; }
      const v: unknown = c.value;
      out.push({ key: String(c.key), kind: v instanceof Blob ? 'Blob' : v instanceof ArrayBuffer ? 'ArrayBuffer' : typeof v });
      c.continue();
    };
    cursor.onerror = () => reject(cursor.error);
  };
}));

test('a camera take is stored as its own bytes: no Blob of it is read back and saved again, and its pieces go once it is in (S-1-13, docs/19 ADR-М5)', async ({ playwright }, info) => {
  test.setTimeout(180_000);
  const { defaultBrowserType, ...use } = info.project.use as Record<string, unknown>;
  void defaultBrowserType;
  const type = info.project.name.includes('webkit') ? playwright.webkit : playwright.chromium;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-take-'));
  let ctx: BrowserContext | undefined;
  try {
    ctx = await type.launchPersistentContext(dir, { ...use, serviceWorkers: 'block' });
    const page = ctx.pages()[0] ?? await ctx.newPage();
    await page.addInitScript(setup);
    await page.goto('./');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible();
    expect((await store(page)).filter((k) => /^[bct]:/.test(k.key)), 'a new project stores no media').toEqual([]);

    await page.getByRole('button', { name: 'Camera', exact: true }).click();
    await page.getByRole('button', { name: 'Start recording' }).click();
    await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 }); // after 3-2-1
    await expect.poll(async () => (await store(page)).filter((k) => k.key.startsWith('t:')).length, { message: 'the take is written second by second', timeout: 20_000 }).toBeGreaterThanOrEqual(3);
    const pieces = (await store(page)).filter((k) => k.key.startsWith('t:'));
    expect(new Set(pieces.map((k) => k.kind)), 'each second is stored as bytes, never as the recorder\'s Blob (docs/19 С12)').toEqual(new Set(['ArrayBuffer']));
    await page.getByRole('button', { name: 'Stop recording' }).click();
    await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(1, { timeout: 30_000 });

    await expect.poll(async () => (await store(page)).filter((k) => k.key.startsWith('t:')).length, { message: 'the pieces go once the take is in the project', timeout: 10_000 }).toBe(0);
    const media = (await store(page)).filter((k) => /^[bc]:/.test(k.key));
    expect(media.filter((k) => k.kind === 'Blob'), 'no Blob of the take is saved').toEqual([]);
    const manifests = media.filter((k) => /^c:[^:]+$/.test(k.key));
    expect(manifests, 'the take is one stored file').toHaveLength(1);
    const id = manifests[0].key.slice(2);
    expect(media.filter((k) => k.key.startsWith(`c:${id}:`)).every((k) => k.kind === 'ArrayBuffer'), 'its chunks are bytes').toBe(true);

    // The take plays and reads after a reload, from the stored chunks.
    await page.reload();
    await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(1, { timeout: 30_000 });
    await page.locator('.play-btn').click();
    await expect(page.locator('.play-btn')).toHaveAttribute('aria-label', 'Pause');
    await expect(page.locator('.toast.error')).toHaveCount(0);
  } finally {
    await ctx?.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('every second of a take reaches storage on its own, so a crash loses at most a second (V-250)', async ({ page }) => {
  // Chromium's MP4 recorder cut its pieces at key frames only: 9 s of a take came as a 1 KB header and one more piece,
  // and a tab that died before the first frames were cut lost the take (E4, 2026-11-16).
  test.setTimeout(120_000);
  await page.addInitScript(setup);
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await page.getByRole('button', { name: 'Camera', exact: true }).click();
  await page.getByRole('button', { name: 'Start recording' }).click();
  await expect(page.getByRole('button', { name: 'Stop recording' })).toBeVisible({ timeout: 10_000 }); // after 3-2-1
  // Five pieces by ten seconds of recording: a second each, with room for a slow machine's recorder and storage (the cloud
  // runners took 6.5 s and more for five, SW-A-21). The defect gave 9 s as a header and one piece, so it never gets there.
  const started = Date.now();
  await expect.poll(async () => (await store(page)).filter((k) => k.key.startsWith('t:')).length, {
    message: 'about one piece a second: five by ten seconds of recording', timeout: 10_000, intervals: [500],
  }).toBeGreaterThanOrEqual(5);
  test.info().annotations.push({ type: 'five pieces after', description: `${((Date.now() - started) / 1000).toFixed(1)} s` });
  await page.getByRole('button', { name: 'Stop recording' }).click();
  await expect(page.locator('.tl-row.main .clip-video')).toHaveCount(1, { timeout: 30_000 });
});

