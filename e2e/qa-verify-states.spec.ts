// Verifier E3 (docs/21 §5): audit rows whose fix had no test of its own. Each test is red on a build with the fix taken
// back and green on main: V-118 (a failed read left «Opening…» or «Listening to the clip…» for ever, with no way out),
// V-199 (an encoder that takes no size gave an empty list of sizes), V-251 (the model "Fast", which gets four words in
// five wrong on Russian, offered for Russian) and V-186 (the s typed into a drop-down list cut the video).
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
  });
});

async function projectWith(page: Page, files: string[]) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(files.map(fx));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(files.length, { timeout: 60_000 });
}

/** Kadr's IndexedDB store of projects and media, inside the page. */
const KV = `(async () => {
  const db = await new Promise((ok, ko) => { const r = indexedDB.open('kadr'); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  const req = (r) => new Promise((ok, ko) => { r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
  return { db, req, store: (mode) => db.transaction('kv', mode).objectStore('kv') };
})()`;
const openKv = (page: Page) => page.evaluate(`window.__kv = ${KV}`);

test('a project that cannot be read opens on a screen with a way back, not on «Opening…» for ever (audit V-118)', async ({ page }) => {
  await projectWith(page, ['landscape.mp4']);
  const id = /#\/p\/([^/?]+)/.exec(page.url())![1];
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  // The stored project is damaged: it has no tracks.
  await openKv(page);
  await page.evaluate(async (key) => {
    type Kv = { db: IDBDatabase; req: <R>(r: IDBRequest<R>) => Promise<R>; store: (m: IDBTransactionMode) => IDBObjectStore };
    const { db, req, store } = await (window as unknown as { __kv: Promise<Kv> }).__kv;
    const p = await req(store('readonly').get(key)) as { tracks: unknown };
    p.tracks = null;
    await req(store('readwrite').put(p, key));
    db.close();
  }, `p:${id}`);
  await page.goto(`./#/p/${id}`);
  await page.reload();
  await expect(page.getByRole('button', { name: 'Back to projects' }), 'a way back').toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Opening…')).toHaveCount(0);
});

test('Remove pauses on a clip whose sound cannot be read says so and closes, not «Listening to the clip…» for ever (audit V-118)', async ({ page }) => {
  test.setTimeout(180_000);
  await projectWith(page, ['landscape.mp4']);
  await page.waitForTimeout(1500); // saved with its media
  // The stored bytes of the video are damaged (same size, other bytes), and no peaks are kept for it.
  await openKv(page);
  const damaged = await page.evaluate(async () => {
    type Kv = { db: IDBDatabase; req: <R>(r: IDBRequest<R>) => Promise<R>; store: (m: IDBTransactionMode) => IDBObjectStore };
    const { db, req, store } = await (window as unknown as { __kv: Promise<Kv> }).__kv;
    const keys = await req(store('readonly').getAllKeys());
    let n = 0;
    const noise = (size: number) => { const b = new Uint8Array(size); for (let i = 0; i < size; i += 4096) crypto.getRandomValues(b.subarray(i, Math.min(size, i + 4096))); return b; };
    for (const k of keys) {
      if (typeof k !== 'string') continue;
      if (k.startsWith('w:')) { await req(store('readwrite').delete(k)); continue; }
      const v = await req(store('readonly').get(k));
      if (k.startsWith('b:') && v instanceof Blob) { await req(store('readwrite').put(new Blob([noise(v.size)], { type: v.type }), k)); n++; }
      else if (/^c:[^:]+:\d+$/.test(k) && v instanceof ArrayBuffer) { await req(store('readwrite').put(noise(v.byteLength).buffer, k)); n++; }
    }
    db.close();
    return n;
  });
  expect(damaged, 'the video was stored and is now damaged').toBeGreaterThan(0);
  await page.reload();
  const clip = page.locator('.tl-row.main .clip').first();
  await expect(clip).toBeVisible({ timeout: 30_000 });
  await expect(async () => {
    if (!(await clip.getAttribute('class'))?.includes(' sel')) await clip.click();
    await expect(clip).toHaveClass(/ sel/, { timeout: 1000 });
  }).toPass({ timeout: 10_000 });
  await page.locator('.toolbar').getByRole('button', { name: 'Remove pauses', exact: true }).click();
  await expect(page.locator('.toast').filter({ hasText: /Could not read the sound of this clip/ })).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText('Listening to the clip…')).toHaveCount(0);
});

test('an encoder that takes no size: the export says this browser cannot encode, not an empty list of sizes (audit V-199)', async ({ page }) => {
  await page.addInitScript(() => {
    VideoEncoder.isConfigSupported = async (c) => ({ supported: false, config: c });
  });
  await projectWith(page, ['landscape.mp4']);
  await page.getByRole('button', { name: 'Export' }).first().click();
  await expect(page.getByText('This browser cannot encode video. Try Chrome or Safari.')).toBeVisible({ timeout: 30_000 });
});

test('with Russian chosen as the language, the model "Fast" is not offered (audit V-251)', async ({ page }) => {
  await projectWith(page, ['landscape.mp4']);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await page.locator('.toolbar').getByRole('button', { name: 'Captions', exact: true }).click();
  const list = page.getByRole('combobox', { name: 'Language' });
  const no = page.getByRole('button', { name: 'Not now', exact: true });
  await expect(async () => {
    if (await no.isVisible()) await no.click();
    await expect(list).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  const recognition = page.getByRole('radiogroup', { name: 'Recognition' });
  await list.selectOption('');
  await expect(recognition.getByRole('radio', { name: /^Fast/ }), 'offered for an unknown language').toHaveCount(1);
  await list.selectOption('russian');
  await expect(recognition.getByRole('radio', { name: /^Russian speech/ }).first()).toBeVisible();
  await expect(recognition.getByRole('radio', { name: /^Fast/ }), 'not offered for Russian').toHaveCount(0);
});

test('the s typed into the language list picks a language and does not cut the video (audit V-186)', async ({ page }) => {
  await projectWith(page, ['counter.mp4']);
  const clips = page.locator('.tl-row.main .clip');
  await page.getByRole('button', { name: 'Close tools' }).click();
  // The playhead inside the clip, where a cut would land.
  const position = page.getByRole('slider', { name: 'Position in the video' });
  await position.fill('2');
  await expect.poll(async () => Number(await position.inputValue())).toBeGreaterThan(1);
  await page.locator('.toolbar').getByRole('button', { name: 'Captions', exact: true }).click();
  const list = page.getByRole('combobox', { name: 'Language' });
  const no = page.getByRole('button', { name: 'Not now', exact: true });
  await expect(async () => {
    if (await no.isVisible()) await no.click();
    await expect(list).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 30_000 });
  await list.focus();
  await page.keyboard.press('s');
  await page.waitForTimeout(500);
  await expect(clips, 'the clip is not cut').toHaveCount(1);
});
