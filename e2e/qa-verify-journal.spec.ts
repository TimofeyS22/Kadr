// Verifier E1 (docs/21 §5), audit V-120: the rule the fix added is that a journal made on an older stored revision is
// not replayed over a project saved after it. The original e2e no longer reaches that rule: since S-1-2 every edit is
// journaled and every save clears the journal, so with the rule taken out it stays green (control, 2026-11-14). Here a
// journal of an older revision is left in place by hand, the way a save that failed in the background left it.
import { expect, test, type Page } from '@playwright/test';

async function newProject(page: Page) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.locale', 'en'); localStorage.setItem('kadr.hint.move', '1');
  });
});

test('a journal made on an older revision is not replayed over a project saved after it (audit V-120)', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await newProject(page);
  const title = page.getByRole('textbox', { name: 'Project name' });
  await title.fill('E1');
  // Within the save's debounce the edit is only in the journal: this is what a failed background save leaves behind.
  const stale = await page.evaluate(() => localStorage.getItem('kadr.journal'));
  expect(stale, 'the edit is journaled before it is saved').toContain('"E1"');
  const base = (JSON.parse(stale!) as { base?: number }).base;
  expect(typeof base, 'the journal says which stored revision it was made on').toBe('number');
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kadr.journal')), { timeout: 10_000 }).toBeNull();
  await title.fill('E2'); // a later edit, saved normally on a newer revision
  await expect.poll(() => page.evaluate(() => localStorage.getItem('kadr.journal')), { timeout: 10_000 }).toBeNull();
  await page.getByRole('button', { name: 'Back to projects' }).click();
  // Leaving saves the project with its thumbnail first and only then goes Home. On a slow machine a reload before that
  // reopened the project itself, with no «Open E2» to press (SW-E3-6, runs 44389966235, 44409049405, 44421930683).
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await page.evaluate((j) => localStorage.setItem('kadr.journal', j), stale!);
  // The journal is read when a page opens the project from storage: the next visit, after the page that left it died.
  await page.reload();
  await page.getByRole('button', { name: 'Open E2', exact: true }).click();
  await expect(title).toHaveValue('E2'); // with the rule gone, the stale journal of E1 comes back over E2
  await page.waitForTimeout(500);
  await expect(title).toHaveValue('E2');
  expect(errors).toEqual([]);
});
