// A project saved by a newer Kadr, opened by an older one (V-239: after a rollback of the site, or in a tab that has not
// updated). It used to be migrated down silently and saved back in the older format, losing what the newer one added.
import { expect, test, type Page } from '@playwright/test';

const record = (page: Page, id: string) => page.evaluate((key) => new Promise<Record<string, unknown> | undefined>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const r = open.result.transaction('kv').objectStore('kv').get(key);
    r.onsuccess = () => { open.result.close(); resolve(r.result as Record<string, unknown> | undefined); };
    r.onerror = () => reject(r.error);
  };
}), `p:${id}`);

const write = (page: Page, id: string, value: unknown) => page.evaluate(([key, v]) => new Promise<void>((resolve, reject) => {
  const open = indexedDB.open('kadr');
  open.onerror = () => reject(open.error);
  open.onsuccess = () => {
    const tx = open.result.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, key as string);
    tx.oncomplete = () => { open.result.close(); resolve(); };
    tx.onerror = () => reject(tx.error);
  };
}), [`p:${id}`, value] as const);

test('a project saved by a newer version is not opened and saved back in this older format (V-239)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => { localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1'); localStorage.setItem('kadr.locale', 'en'); });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const id = new URL(page.url()).hash.split('/').pop() || await page.evaluate(() => location.hash.replace(/^#\/?(?:p\/|project\/)?/, ''));
  await expect.poll(async () => !!(await record(page, id)), { message: 'the new project is saved' }).toBe(true);
  // The same project as a newer Kadr would have left it.
  const newer = { ...(await record(page, id))!, version: 99, futureField: { kept: true } };
  await write(page, id, newer);
  await page.reload();
  await expect(page.locator('.toast.error')).toContainText('newer version of Kadr', { timeout: 30_000 });
  await page.waitForTimeout(2000); // past an autosave
  const after = await record(page, id);
  expect(after?.version, 'the record keeps its version').toBe(99);
  expect(after?.futureField, 'and what the newer version wrote').toEqual({ kept: true });
});
