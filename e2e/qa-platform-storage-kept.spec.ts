// V-223 (P0): a project on the iPhone may be gone after 7 days without a visit. Safari deletes a site's script-written
// storage after seven days of Safari use without interaction with the site (WebKit, «Full Third-Party Cookie Blocking
// and More», 2020); a web app on the Home Screen has its own counter of days of its own use. Kadr asks the browser to
// keep the projects for good (navigator.storage.persist) once a page, when there is a project, and says the risk in
// Safari while the data is not kept. The browser's answer is stubbed here to see each case; the probe at the end
// records what the engines really answer.
import { expect, test, type Page } from '@playwright/test';
import { audits, importFiles, newProject, note } from './qa-platform-kit';

audits();

/**
 * The storage manager's answers, counting the times Kadr asks. On the prototype: WebKit's page reads the methods there,
 * whatever is set on the instance.
 */
async function stubStorage(page: Page, o: { kept: boolean; answer: boolean | 'throw' }) {
  await page.addInitScript((o) => {
    const w = window as unknown as { __persistAsked: number };
    w.__persistAsked = 0;
    let kept = o.kept;
    Object.defineProperty(StorageManager.prototype, 'persisted', { configurable: true, writable: true, value: async () => kept });
    Object.defineProperty(StorageManager.prototype, 'persist', {
      configurable: true,
      writable: true,
      value: async () => {
        w.__persistAsked++;
        if (o.answer === 'throw') throw new DOMException('The request is not allowed', 'NotAllowedError');
        kept = o.answer;
        return kept;
      },
    });
  }, o);
}
const asked = (page: Page) => page.evaluate(() => (window as unknown as { __persistAsked: number }).__persistAsked);
const words = (page: Page) => page.locator('.home-foot .ck-home-foot-keep');
const card = (page: Page) => page.getByRole('note').filter({ hasText: 'Home Screen' });
const IPHONE_WORDS = 'Safari may delete projects if Kadr is not opened for 7 days. Add Kadr to the Home Screen or save a backup.';
const MAC_WORDS = 'Safari may delete projects if Kadr is not opened for 7 days. Add Kadr to the Dock or save a backup.';

/** A project with a photo in it, made and left (saved more than once); `n` projects are listed then. */
async function oneProject(page: Page, n: number) {
  await newProject(page);
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.locator('.project-card')).toHaveCount(n);
}

test('the browser is asked to keep the projects once, when there is one, and not again in that page (V-223)', async ({ page }) => {
  await stubStorage(page, { kept: false, answer: false });
  await page.goto('./');
  await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
  await page.waitForTimeout(1500);
  expect(await asked(page), 'Home with no project asks nothing').toBe(0);
  await oneProject(page, 1);
  await expect.poll(() => asked(page), { message: 'a project made, a photo added, back on Home: asked once' }).toBe(1);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await importFiles(page, 'Media', ['photo.png']);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.getByRole('button', { name: 'Back to projects' }).click();
  await expect(page.locator('.project-card')).toHaveCount(2);
  await page.waitForTimeout(1000);
  expect(await asked(page), 'a second project in the same page: not again').toBe(1);
});

test('a refusal, even one that throws, changes nothing: the project is made, kept in the list and opens again (V-223)', async ({ page }) => {
  await stubStorage(page, { kept: false, answer: 'throw' });
  await page.goto('./');
  await oneProject(page, 1);
  await expect.poll(() => asked(page)).toBe(1);
  await page.reload();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.locator('.ck-project-open').first().click();
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
});

test('the words about Safari deleting projects: under Home while the data is not kept, once the card above is dismissed on the iPhone; gone once the data is kept (V-223)', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the iPhone\'s Safari; Chromium is the next test');
  await stubStorage(page, { kept: false, answer: true });
  await page.goto('./');
  await expect(card(page), 'the card says it first').toBeVisible();
  await expect(words(page), 'and the line under Home does not say it again').toHaveCount(0);
  await card(page).getByRole('button', { name: 'Got it' }).click();
  await expect(words(page)).toHaveText(IPHONE_WORDS);
  await oneProject(page, 1); // the first project: Kadr asks, the browser keeps the data
  await page.reload();
  await expect(page.locator('.project-card')).toHaveCount(1);
  await page.waitForTimeout(1000);
  await expect(words(page), 'kept for good: nothing to warn about').toHaveCount(0);
});

test('Chromium does not delete a site after 7 days: no words, whatever the storage (V-223)', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'Chromium');
  await stubStorage(page, { kept: false, answer: false });
  await page.goto('./');
  await oneProject(page, 1);
  await page.waitForTimeout(1000);
  await expect(words(page)).toHaveCount(0);
});

test.describe('Safari on a Mac', () => {
  test.use({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Safari/605.1.15', viewport: { width: 1280, height: 800 }, isMobile: false, hasTouch: false });

  test('no card there: the line names the Dock while the data is not kept, and is not said when it is (V-223)', async ({ page, browserName }) => {
    test.skip(browserName !== 'webkit', 'Safari\'s own engine');
    await stubStorage(page, { kept: false, answer: false });
    await page.goto('./');
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    await expect(words(page)).toHaveText(MAC_WORDS);
    await expect(card(page)).toHaveCount(0);
  });
});

test('the words are not said when the data is kept for good from the start, and Kadr does not ask (V-223)', async ({ page }) => {
  await stubStorage(page, { kept: true, answer: true });
  await page.goto('./');
  const tip = card(page);
  if (await tip.count()) await tip.getByRole('button', { name: 'Got it' }).click();
  await page.waitForTimeout(1000);
  await expect(words(page)).toHaveCount(0);
  await oneProject(page, 1);
  await page.waitForTimeout(1000);
  expect(await asked(page), 'kept already: not asked').toBe(0);
  await expect(words(page)).toHaveCount(0);
});

test('what the engine really answers, recorded: persisted() before, persist(), persisted() after (V-223)', async ({ page, browserName }, info) => {
  await page.goto('./');
  const r = await page.evaluate(async () => {
    const before = await navigator.storage.persisted();
    let answer: unknown;
    try { answer = await navigator.storage.persist(); } catch (e) { answer = `threw ${(e as Error).name}`; }
    return { before, answer, after: await navigator.storage.persisted() };
  });
  note(info, 'persist.json', JSON.stringify({ browserName, ...r }));
  console.log(`V-223 storage (${info.project.name}): persisted ${r.before}, persist() → ${String(r.answer)}, then persisted ${r.after}`);
  expect(typeof r.before).toBe('boolean');
  expect(typeof r.after).toBe('boolean');
});
