// Small things that kept people out (docs/16 stage 4): the text field under the fold (V-202), zoom forbidden (V-177),
// and another site's form able to put its file into a person's projects (V-235).
import { expect, test } from '@playwright/test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
  });
});

test('adding text on a small phone: the field for the words is the first thing in the sheet and on screen', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 667 });
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  await page.getByRole('button', { name: 'Text', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Text', exact: true });
  await expect(field).toBeVisible();
  const box = (await field.boundingBox())!;
  expect(box.y + box.height, 'on screen without scrolling').toBeLessThanOrEqual(667);
  const order = await page.locator('.sheet-body').evaluate((body) => {
    const kids = [...body.children];
    return [kids.findIndex((k) => k.matches('textarea')), kids.findIndex((k) => k.matches('.picker'))];
  });
  expect(order[0], 'before the style grid').toBeLessThan(order[1]);
  await field.fill('Привет');
  await expect(field).toHaveValue('Привет');
});

test('the page may be zoomed: nothing in the viewport setting forbids it', async ({ page }) => {
  await page.goto('./');
  const viewport = await page.locator('meta[name=viewport]').getAttribute('content');
  expect(viewport).not.toMatch(/user-scalable\s*=\s*(no|0)/);
  expect(viewport).not.toMatch(/maximum-scale/);
  // The app's own gestures keep their surfaces: a pinch on the picture scales the layer, not the page.
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  expect(await page.locator('.preview').evaluate((el) => getComputedStyle(el).touchAction)).toBe('none');
});

test('a form on another site posts a file to the share address: Kadr opens, and nothing of it is kept', async ({ page, browserName, baseURL }) => {
  test.skip(browserName !== 'chromium', 'the share address is answered by the service worker; Playwright WebKit runs none');
  await page.goto('./');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(async () => { await page.reload(); return page.evaluate(() => !!navigator.serviceWorker.controller); }).toBe(true);
  const target = new URL('share-target', baseURL).href;
  const other = http.createServer((_, res) => res.writeHead(200, { 'content-type': 'text/html' }).end(`<!doctype html><form method="POST" action="${target}" enctype="multipart/form-data"><input type="file" name="media" id="m"><button id="go">go</button></form>
    <script>const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(2048)], 'theirs.mp4', { type: 'video/mp4' })); document.getElementById('m').files = dt.files;</script>`));
  await new Promise<void>((ok) => other.listen(0, 'localhost', ok));
  try {
    // "localhost" against the test site's 127.0.0.1 (or its real host): another origin, as any other site is.
    await page.goto(`http://localhost:${(other.address() as AddressInfo).port}/`);
    await page.locator('#go').click();
    await page.waitForURL((u) => u.href.startsWith(new URL('./', baseURL).href));
    await expect(page.getByRole('button', { name: 'New project' })).toBeVisible();
    expect(page.url(), 'no project was made').not.toMatch(/#\/p\/|shared=/);
    expect(await page.evaluate(async () => (await (await caches.open('kadr-share')).keys()).length), 'nothing parked').toBe(0);
    await page.waitForTimeout(1500);
    await expect(page.locator('.project-open')).toHaveCount(0);
  } finally {
    other.close();
  }
});
