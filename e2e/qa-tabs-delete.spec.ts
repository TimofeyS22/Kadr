// A project deleted in one tab is not written back by the tab that has it open (search S-1-1). Before, that tab kept
// saying "saved", its next edit put the project back in storage without its media, it came back to the list, and its
// export failed: the delete the person confirmed was undone without a word.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1');
  });
});

/** The keys of Kadr's store, read straight from IndexedDB (the app's own view is what is being tested). */
const storedKeys = (page: Page) => page.evaluate(() => new Promise<string[]>((ok, ko) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => ko(open.error);
  open.onsuccess = () => {
    const req = open.result.transaction('kv').objectStore('kv').getAllKeys();
    req.onsuccess = () => { ok((req.result as IDBValidKey[]).map(String)); open.result.close(); };
    req.onerror = () => ko(req.error);
  };
}));

async function projectWithClip(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles([fx('landscape.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const id = decodeURIComponent(new URL(page.url()).hash.replace(/^#\/p\//, ''));
  await expect.poll(async () => (await storedKeys(page)).filter((k) => k.startsWith('b:') || k.startsWith('c:')).length, 'the media is stored').toBeGreaterThan(0);
  await expect.poll(async () => (await storedKeys(page)).includes(`p:${id}`), 'the project is stored').toBe(true);
  return id;
}

const gone = (page: Page) => page.getByRole('alertdialog', { name: 'This project was deleted' });

test('deleted on the home screen of another tab: the open tab says so and never writes it back (S-1-1)', async ({ page, context }) => {
  test.setTimeout(120_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const id = await projectWithClip(page);
  const home = await context.newPage();
  home.on('pageerror', (e) => errors.push(e.message));
  await home.goto('./');
  await home.getByRole('button', { name: /^Delete / }).click();
  await home.getByRole('dialog', { name: /^Delete “/ }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect(home.getByRole('button', { name: /^Open / })).toHaveCount(0);

  await expect(gone(page), 'the tab that has it open is told').toBeVisible({ timeout: 10_000 });
  await expect(gone(page).getByRole('button', { name: 'Back to projects' }), 'the way out takes the focus').toBeFocused();
  await expect(page.locator('.ck-editor-saved'), 'the header no longer says "saved"').toHaveAttribute('data-state', 'failed');
  // An edit that slips through (a shortcut, a gesture under the notice) and the page going away write nothing.
  await page.keyboard.press('s');
  await page.evaluate(() => { document.dispatchEvent(new Event('visibilitychange')); window.dispatchEvent(new PageTransitionEvent('pagehide')); });
  await page.waitForTimeout(3000); // past SAVE_MAX_WAIT_MS (2.5 s): any save would have landed
  expect((await storedKeys(page)).filter((k) => k === `p:${id}`), 'the project stays deleted').toEqual([]);
  await gone(page).getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await expect(page.getByRole('button', { name: /^Open / }), 'not back in the list').toHaveCount(0);
  await home.reload();
  await expect(home.getByRole('button', { name: 'New project' })).toBeVisible();
  await expect(home.getByRole('button', { name: /^Open / }), 'not back in the list of the tab that deleted it').toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('kadr.journal')), 'no journal left to bring it back').toBeNull();
  expect(errors, 'uncaught errors').toEqual([]);
});

test('deleted with no word to this tab (a tab of an older version): the next save is refused and said (S-1-1)', async ({ page, context }) => {
  test.setTimeout(120_000);
  const id = await projectWithClip(page);
  // Another tab removes the project from storage and tells no one, as a tab of an earlier version does.
  const other = await context.newPage();
  await other.goto('./robots.txt'); // the same origin, without the app
  await other.evaluate((key) => new Promise<void>((ok, ko) => {
    const open = indexedDB.open('kadr');
    open.onerror = () => ko(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').delete(key);
      tx.oncomplete = () => { open.result.close(); ok(); };
      tx.onerror = () => ko(tx.error);
    };
  }), `p:${id}`);
  await other.close();
  await expect(gone(page)).toHaveCount(0); // nothing told this tab yet
  await page.getByRole('textbox', { name: 'Project name' }).fill('After the delete');
  await expect(gone(page), 'the refused save is said').toBeVisible({ timeout: 10_000 });
  await page.waitForTimeout(3000);
  expect((await storedKeys(page)).filter((k) => k === `p:${id}`), 'the project stays deleted').toEqual([]);
  await gone(page).getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.getByRole('button', { name: /^Open / }), 'not in the list').toHaveCount(0);
});
