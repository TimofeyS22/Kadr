// Seeing failures without a server (docs/12 stage 4): every error toast offers "Details" — version, device, where
// and what kind of error — and copies them for support. Nothing leaves by itself, and no file name or text of the
// person's is in it. The same entries are kept on the device and listed in ?diag.
import { expect, test, type Page } from '@playwright/test';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

test.use({ serviceWorkers: 'block' }); // the speech worker is rewritten below

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
  });
});

async function project(page: Page, file: string) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await chooser).setFiles([fx(file)]);
}

async function copied(page: Page, browserName: string, details: ReturnType<Page['locator']>): Promise<string> {
  const text = (await details.locator('pre').textContent()) ?? '';
  if (browserName === 'chromium') { // WebKit gives no clipboard permission to grant
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
    await details.getByRole('button', { name: 'Copy for support' }).click();
    await expect(details.getByRole('button', { name: 'Copied' })).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(text);
  }
  return text;
}

test('a speech engine error: the toast has Details, they copy, name no file, and ?diag lists them', async ({ page, context, browserName }) => {
  test.setTimeout(300_000);
  // As an iPhone that cannot reserve the speech heap at all (qa-iphone-speech.spec.ts).
  await context.route(/\/assets\/asr\.worker-[\w-]+\.js$/, async (route) => {
    const res = await route.fetch();
    const shim = "{const N=WebAssembly.Memory;function M(d){if(d&&d.shared)throw new RangeError('Out of memory');return new N(d)}M.prototype=N.prototype;Object.defineProperty(WebAssembly,'Memory',{value:M,writable:true,configurable:true});}\n";
    await route.fulfill({ response: res, body: shim + (await res.text()) });
  });
  await project(page, 'speech_en.mp4');
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Close tools' }).click();
  await tool(page, 'Captions').click();
  const toast = page.locator('.toast.error').filter({ hasText: 'Not enough memory on this device for the speech model' });
  await expect(toast).toBeVisible({ timeout: 120_000 });
  await toast.getByRole('button', { name: 'Details' }).click();
  await page.waitForTimeout(7000); // opened details keep the toast past its usual 6 s
  const details = toast.locator('.error-details');
  await expect(details).toBeVisible();
  const text = await copied(page, browserName, details);
  expect(text).toMatch(/^Kadr \d+\.\d+\.\d+, \d{4}-\d\d-\d\dT/);
  expect(text).toMatch(browserName === 'webkit' ? /iPhone, iOS [\d.]+/ : /Android [\d.]+, Chrome \d+/);
  expect(text).toMatch(/captions: MediaError: Not enough memory on this device for the speech model/);
  expect(text).not.toContain('speech_en');
  await toast.getByRole('button', { name: 'Close', exact: true }).click();
  await expect(toast).toHaveCount(0);

  await page.goto('./?diag');
  await expect(page.locator('.diag-report')).toContainText(/## Error log\n\S+: Kadr [\d.]+, captions: MediaError: Not enough memory/, { timeout: 60_000 });
  await context.unrouteAll({ behavior: 'ignoreErrors' }); // ?diag starts the speech worker again: its route is not for the next test
});

test('a file that cannot be added: the toast names it, its Details do not', async ({ page, browserName }) => {
  await project(page, 'hostile_text.mp4');
  const toast = page.locator('.toast.error').filter({ hasText: 'hostile_text.mp4' });
  await expect(toast).toBeVisible();
  await toast.getByRole('button', { name: 'Details' }).click();
  const text = await copied(page, browserName, toast.locator('.error-details'));
  expect(text).toMatch(/MediaError: /);
  expect(text).not.toContain('hostile_text');
});
