// SW-L-3: on the iPhone 15, in a fresh Safari cache, the first «Cutout» downloaded the vision runtime (11.8 MB) for
// over a minute; Kadr waited 60 s in all and said «the server did not answer» while it was answering. Through a slow
// proxy (slowNetwork.ts) the same happens here on both engines: a download that keeps coming is waited for and its
// progress is said; a server that goes quiet, or a connection that breaks, is named for what it is.
import { expect, test, type Page } from '@playwright/test';
import { audits, expectedConsole, fx, note, selectClip, toastErrors, tool } from './qa-platform-kit';
import { slowNetwork } from './slowNetwork';

audits();

/** The vision runtime, the worker's or the page's. */
const RUNTIME = /\/assets\/vision_wasm_(module_)?internal-[^/]+\.wasm$/;
const base = () => process.env.E2E_URL ?? 'http://localhost:4191/';
const overlay = (page: Page) => page.locator('p[aria-live="polite"]');

/** A new project with one photo of a person, selected, opened through `url`. */
async function personClip(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Media', exact: true }).click();
  await (await chooser).setFiles(fx('person.jpg'));
  const main = page.locator('.tl-row.main .clip');
  await expect(main).toHaveCount(1);
  await selectClip(page, main.first());
}

/** What the busy overlay and the toasts said until `until` holds, read every half second (at most `maxS` seconds). */
async function watch(page: Page, until: () => Promise<boolean>, maxS: number) {
  const said: { s: number; text: string; pct: string }[] = [];
  const t0 = Date.now();
  while ((Date.now() - t0) / 1000 < maxS && !(await until())) {
    const text = (await overlay(page).allTextContents()).join(' | ');
    const pct = (await page.locator('.ck-editor-pct').allTextContents()).join('');
    if (text && said.at(-1)?.text !== text) said.push({ s: (Date.now() - t0) / 1000, text, pct });
    await page.waitForTimeout(500);
  }
  return said;
}

const errorToast = (page: Page) => page.locator('.toast.error');

test('the first Cutout on a slow network: 75 s for the runtime, past the 60 s that ended it on the iPhone — no error, the overlay says how far, the cutout is made (SW-L-3)', async ({ page }, info) => {
  test.setTimeout(300_000);
  // 11.76 MB at 160 kB/s: ~74 s.
  const net = await slowNetwork(base(), [{ match: RUNTIME, bytesPerSecond: 160_000 }]);
  try {
    await personClip(page, net.url);
    await tool(page, 'Cutout').click();
    const pressed = async () => (await tool(page, 'Cutout').getAttribute('aria-pressed')) === 'true';
    const said = await watch(page, async () => (await pressed()) || (await errorToast(page).count()) > 0, 240);
    note(info, 'said.json', JSON.stringify({ said, sent: net.sent }, null, 1));
    expect(await errorToast(page).allTextContents(), 'no error while the runtime keeps coming').toEqual([]);
    expect(net.sent.find((x) => x.how === 'whole')?.seconds, 'the runtime took longer than the old 60 s limit').toBeGreaterThan(60);
    const mb = said.map((x) => /Downloading the on-device model, once: ([\d.]+) of ([\d.]+) MB/.exec(x.text)).filter((m) => m !== null);
    expect(mb.length, 'the overlay says how many MB are in, again and again').toBeGreaterThanOrEqual(20);
    expect(new Set(mb.map((m) => m[2])), 'of the whole file').toEqual(new Set(['11.8']));
    const done = mb.map((m) => Number(m[1]));
    console.log(`SW-L-3 slow runtime (${info.project.name}): ${net.sent.find((x) => x.how === 'whole')?.seconds} s, ${mb.length} counts from ${done[0]} to ${done.at(-1)} of ${mb[0]?.[2]} MB, cut out ${said.at(-1)?.s} s after the tap`);
    expect(done, 'and the number only grows').toEqual(done.toSorted((a, b) => a - b));
    expect(done.at(-1)! - done[0], 'from near the start to near the end').toBeGreaterThan(8);
    expect(said.filter((x) => x.pct).length, 'with the share in per cent').toBeGreaterThanOrEqual(20);
    await expect(tool(page, 'Cutout')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.toast').filter({ hasText: 'Background removed' })).toBeVisible();
  } finally {
    await net.close();
  }
});

test('a server that goes quiet in the middle of the runtime: «did not answer» 20 s after its last byte, not a minute; the next try works (SW-L-3)', async ({ page }) => {
  test.setTimeout(240_000);
  const net = await slowNetwork(base(), [{ match: RUNTIME, bytesPerSecond: 400_000, quietAfter: 2_000_000, times: 1 }]);
  try {
    await personClip(page, net.url);
    await tool(page, 'Cutout').click();
    await expect(errorToast(page)).toBeVisible({ timeout: 120_000 });
    const after = (Date.now() - net.sent[0].at) / 1000;
    expect(net.sent[0].how).toBe('quiet');
    expect(await errorToast(page).textContent()).toContain('the server did not answer');
    expect(after, 'seconds from the last byte to the message').toBeGreaterThan(19);
    expect(after).toBeLessThan(35);
    expect(await toastErrors(page)).toHaveLength(1);
    await expect(overlay(page)).toHaveCount(0);
    await expect(tool(page, 'Cutout')).not.toHaveAttribute('aria-pressed', 'true');
    // Nothing stays stuck on the quiet download: the next tap downloads anew and the cutout is made.
    await page.locator('.toast.error').getByRole('button', { name: 'Close' }).click().catch(() => undefined);
    await tool(page, 'Cutout').click();
    await expect(tool(page, 'Cutout')).toHaveAttribute('aria-pressed', 'true', { timeout: 120_000 });
  } finally {
    await net.close();
  }
});

test('a connection that breaks in the middle of the runtime: «the connection broke», not «did not answer» (SW-L-3)', async ({ page }) => {
  test.setTimeout(240_000);
  const net = await slowNetwork(base(), [{ match: RUNTIME, bytesPerSecond: 400_000, breakAfter: 2_000_000, times: 1 }]);
  // The browser's own line about the connection this test breaks (WebKit, Chromium).
  expectedConsole(/^Failed to load resource: (The network connection was lost\.|net::ERR_CONTENT_LENGTH_MISMATCH)$/);
  try {
    await personClip(page, net.url);
    await tool(page, 'Cutout').click();
    await expect(errorToast(page)).toBeVisible({ timeout: 120_000 });
    expect(net.sent[0].how).toBe('broken');
    expect(await errorToast(page).textContent()).toContain('the connection broke');
    expect((Date.now() - net.sent[0].at) / 1000, 'said at once, not after a wait').toBeLessThan(10);
    expect(await toastErrors(page)).toHaveLength(1);
    await expect(tool(page, 'Cutout')).not.toHaveAttribute('aria-pressed', 'true');
  } finally {
    await net.close();
  }
});

// The runtime downloads ahead on intent, not on a picked clip (lead's decision: Safari says nothing of a metered
// network, so a picked clip would cost every newcomer 3.5 MB). A tap before the end joins that download.

test('a picked photo downloads nothing; the ribbon scrolled to Cutout starts the runtime, and the tap on Cutout joins that download: one request, its progress said (SW-L-3)', async ({ page }) => {
  test.setTimeout(240_000);
  // 11.76 MB at 400 kB/s: ~29 s.
  const net = await slowNetwork(base(), [{ match: RUNTIME, bytesPerSecond: 400_000 }]);
  try {
    await personClip(page, net.url);
    await page.waitForTimeout(3000);
    expect(net.sent, 'a picked photo downloads nothing').toHaveLength(0);
    await tool(page, 'Cutout').scrollIntoViewIfNeeded();
    await expect.poll(() => net.sent.length, { message: 'the ribbon at Cutout starts the download', timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(4000); // the person looks at the tools, then taps
    await tool(page, 'Cutout').click();
    const pressed = async () => (await tool(page, 'Cutout').getAttribute('aria-pressed')) === 'true';
    const said = await watch(page, async () => (await pressed()) || (await errorToast(page).count()) > 0, 120);
    expect(await errorToast(page).allTextContents()).toEqual([]);
    const mb = said.map((x) => /Downloading the on-device model, once: ([\d.]+) of ([\d.]+) MB/.exec(x.text)).filter((m) => m !== null);
    expect(mb.length, 'the tap shows the download under way').toBeGreaterThanOrEqual(3);
    expect(Number(mb[0][1]), 'from where it was, not from zero').toBeGreaterThan(1);
    expect(net.sent, 'one download, not two').toHaveLength(1);
    await expect(tool(page, 'Cutout')).toHaveAttribute('aria-pressed', 'true');
  } finally {
    await net.close();
  }
});

test('the Hide faces sheet starts the runtime; switching faces on joins that download: one request (SW-L-3)', async ({ page }) => {
  test.setTimeout(240_000);
  const net = await slowNetwork(base(), [{ match: RUNTIME, bytesPerSecond: 400_000 }]);
  try {
    await personClip(page, net.url);
    await tool(page, 'Hide faces').click();
    await expect.poll(() => net.sent.length, { message: 'the sheet starts the download', timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(4000);
    const hide = page.getByRole('switch', { name: 'Hide faces automatically' });
    await hide.click();
    const said = await watch(page, async () => (await hide.isChecked()) || (await errorToast(page).count()) > 0, 120);
    expect(await errorToast(page).allTextContents()).toEqual([]);
    const mb = said.map((x) => /Downloading the on-device model, once: ([\d.]+) of ([\d.]+) MB/.exec(x.text)).filter((m) => m !== null);
    expect(mb.length, 'the switch shows the download under way').toBeGreaterThanOrEqual(3);
    expect(Number(mb[0][1]), 'from where it was, not from zero').toBeGreaterThan(1);
    expect(net.sent, 'one download, not two').toHaveLength(1);
    await expect(hide).toBeChecked();
  } finally {
    await net.close();
  }
});
