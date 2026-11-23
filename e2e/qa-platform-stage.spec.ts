// V-234, V-249: the release candidate at /Kadr/next/ shares the live site's origin. Built with VITE_STAGE=next it keeps
// its own names in the browser's storage (src/lib/stage.ts), its own service worker, and noindex; the live site's
// worker leaves its pages and files alone. Run against a site of both builds, as GitHub Pages serves them:
//   E2E_URL=http://127.0.0.1:<port>/Kadr/   (the live build at /Kadr/, the candidate in its next/ folder)
import { expect, test, type Page } from '@playwright/test';
import { audits, fx } from './qa-platform-kit';

audits();

// The kit's own settings (tips seen, the iPhone's format card, English) are written under the live site's keys; the
// candidate reads its own («next:», src/lib/stageStorage.ts), so they are copied there once, not over what it set.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    for (const k of Object.keys(localStorage)) if (k.startsWith('kadr.') && localStorage.getItem(`next:${k}`) === null) localStorage.setItem(`next:${k}`, localStorage.getItem(k)!);
  });
});

const live = () => process.env.E2E_URL ?? 'http://localhost:4191/Kadr/';
const next = () => new URL('next/', live()).href;
const mark = (page: Page) => page.locator('.home-foot .ck-home-stage');

/** A project with a photo, made on the build at `url`; `n` projects are listed then. */
async function projectAt(page: Page, url: string, n: number) {
  await page.goto(url);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('photo.png'));
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.locator('.project-card')).toHaveCount(n);
}

/** The live site with its service worker in control. */
async function liveUnderItsWorker(page: Page) {
  await page.goto(live());
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null)).toMatch(/\/Kadr\/sw\.js$/);
}

test('the live site\'s worker leaves the candidate alone: a page under /next/ is the candidate\'s build, and none of its files goes into the live caches (V-234)', async ({ page }) => {
  test.setTimeout(120_000);
  await liveUnderItsWorker(page);
  await page.goto(next());
  await expect(mark(page), 'the candidate\'s Home, not the live shell the worker keeps').toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).map((r) => new URL(r.scope).pathname).sort()))
    .toEqual(['/Kadr/', '/Kadr/next/']);
  const inLive = await page.evaluate(async () => {
    const out: string[] = [];
    for (const name of await caches.keys()) {
      if (name.startsWith('next:') || name.endsWith('/Kadr/next/')) continue; // the candidate's own
      for (const r of await (await caches.open(name)).keys()) if (new URL(r.url).pathname.startsWith('/Kadr/next/')) out.push(`${name}: ${r.url}`);
    }
    return out;
  });
  expect(inLive, 'files of the candidate in the live site\'s caches').toEqual([]);
});

test('a project made on the candidate is not on the live site, nor the other way; nor a setting (V-234)', async ({ page }) => {
  test.setTimeout(180_000);
  await projectAt(page, live(), 1);
  await page.goto(next());
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await page.waitForTimeout(1000);
  await expect(page.locator('.project-card'), 'the live site\'s project is not on the candidate').toHaveCount(0);
  await projectAt(page, next(), 1);
  await page.goto(live());
  await expect(page.locator('.project-card'), 'the candidate\'s is not on the live site').toHaveCount(1);
  // A setting: the candidate's language is its own.
  await page.goto(next());
  await page.getByRole('radio', { name: 'RU' }).click();
  await expect(page.getByRole('button', { name: 'Новый проект' })).toBeVisible();
  await page.goto(live());
  await expect(page.getByRole('button', { name: 'New project' }), 'the live site keeps its own language').toBeVisible();
  const names = await page.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name).sort() : null));
  if (names) expect(names).toEqual(expect.arrayContaining(['kadr', 'next:kadr']));
});

test('the candidate\'s mark and noindex are on the candidate only, on its task pages too (V-234)', async ({ page, request }) => {
  await page.goto(live());
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await expect(mark(page)).toHaveCount(0);
  expect(await page.locator('meta[name="robots"]').count()).toBe(0);
  await page.goto(next());
  await expect(mark(page)).toHaveText(/^ · next · \w{7}$/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex');
  const sitemap = await request.get(new URL('sitemap.xml', live()).href);
  const task = /<loc>[^<]*\/Kadr\/((?:ru|en)\/[^<]+)<\/loc>/.exec(await sitemap.text())?.[1];
  expect(task, 'a task page of the live site').toBeTruthy();
  expect(await (await request.get(new URL(task!, live()).href)).text()).not.toContain('name="robots"');
  expect(await (await request.get(new URL(task!, next()).href)).text()).toContain('<meta name="robots" content="noindex" />');
  // A file that is not there comes as the app's page on a static host with a fallback: no sitemap is what matters.
  expect(await (await request.get(new URL('sitemap.xml', next()).href)).text(), 'no sitemap of its own').not.toContain('<urlset');
});
