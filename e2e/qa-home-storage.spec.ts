// The browser's storage that does not answer (D-15). A Kadr page frozen in Safari's cache with a write open held it
// for every other page (D-14, fixed); whatever holds it next, the home screen used to say "Loading…" for good, and
// "New project" did nothing at all. Now both say why within the time limit (Home.tsx, STORAGE_WAIT_MS).
import { expect, test } from '@playwright/test';

test('storage that never answers: the home screen and New project say why, nothing waits silently (D-15)', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    // Kadr's database opens and never says so, as when another page holds it.
    const open = IDBFactory.prototype.open;
    IDBFactory.prototype.open = function (this: IDBFactory, name: string, version?: number) {
      return name === 'kadr' ? ({} as IDBOpenDBRequest) : open.call(this, name, version);
    };
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  const toast = page.locator('.toast.error');
  await expect(toast, 'the list says why it does not come').toContainText('Your projects are not loading: the browser’s storage does not answer', { timeout: 20_000 });
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(toast.filter({ hasText: 'Could not create the project' }), 'New project says it failed').toContainText('the browser’s storage does not answer', { timeout: 20_000 });
  expect(new URL(page.url()).hash, 'no editor for a project that was never saved').toBe('');
  expect(errors, 'uncaught errors in the page').toEqual([]);
});
