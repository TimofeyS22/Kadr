// Anonymous statistics (G-3, V-194; src/lib/events.ts) on a page built with a sink, as the deployed site will be once the
// owner's key is set: the page is the test build's own, with the meta tag and the one connect-src host that
// scripts/events-sink.ts adds. What leaves the device is only the outcome events, to that one host, with no file name,
// project name or typed text in them (the marks of qa-privacy-canary); the switch on the home screen stops them; an
// export the tab did not finish is said when Kadr opens again. Builds without a key send nothing: qa-privacy-canary.
import { expect, test, type Page, type Request, type Route } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const SINK = 'https://events.kadr.test/api/v0/event';
const FILE_MARK = 'kadrfilemark7q', PROJECT_MARK = 'kadrprojmark4w', TEXT_MARK = 'Секретнаястрока9';
const MARKS = [FILE_MARK, PROJECT_MARK, TEXT_MARK].flatMap((m) => [m, encodeURIComponent(m), Buffer.from(m).toString('base64').slice(0, -2)]);
const ALLOWED = [/^127\.0\.0\.1$/, /^localhost$/, /^timofeys22\.github\.io$/, /^events\.kadr\.test$/];

// The first visit and every reload come from the network, so every page load is the one with the sink (the service
// worker would answer a reload from its cache, with the build's page and no sink).
test.use({ serviceWorkers: 'block' });

type Sent = { name: string; props: Record<string, unknown> };
async function sinkPage(page: Page, baseURL: string | undefined) {
  const events: Sent[] = [];
  const requests: { url: string; text: string }[] = [];
  page.context().on('request', (r: Request) => {
    if (/^(blob|data):/.test(r.url())) return;
    requests.push({ url: r.url(), text: [r.url(), JSON.stringify(r.headers()), r.postData() ?? ''].join('\n') });
  });
  await page.route(SINK, async (route: Route) => {
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, App-Key', 'Access-Control-Allow-Methods': 'POST' };
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
    const b = JSON.parse(route.request().postData() ?? '{}') as { eventName: string; props: Record<string, unknown> };
    events.push({ name: b.eventName, props: b.props });
    return route.fulfill({ status: 200, headers: cors, body: '{}' });
  });
  // The built page as scripts/events-sink.ts makes it with a key: the meta tag and the sink's host in connect-src.
  const home = new URL(baseURL ?? 'http://127.0.0.1/').href;
  await page.route((u) => u.href === home || u.pathname.endsWith('/index.html'), async (route) => {
    if (route.request().resourceType() !== 'document') return route.fallback();
    const res = await route.fetch();
    const html = (await res.text())
      .replace("connect-src 'self' ", `connect-src 'self' ${new URL(SINK).origin} `)
      .replace('</head>', `<meta name="kadr-events" content="${SINK}" data-key="A-EU-test" /></head>`);
    const headers = Object.fromEntries(Object.entries(res.headers()).filter(([k]) => !/^content-(length|encoding)$/i.test(k)));
    return route.fulfill({ status: res.status(), body: html, headers: { ...headers, 'content-type': 'text/html' } });
  });
  page.on('dialog', (d) => void d.accept()); // «Leave the page?» while an export runs: yes
  await page.addInitScript(() => {
    // A person, not a robot: the sink stays quiet under automation (src/lib/events.ts), which this test is.
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
    for (const [k, v] of Object.entries({ 'kadr.tips': '99', 'kadr.iosFormatCard.v1': '1', 'kadr.locale': 'en', 'kadr.hint.move': '1', 'kadr.iosVideoTip.v3': '1' })) localStorage.setItem(k, v);
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });
  return { events, requests, names: () => events.map((e) => e.name) };
}

const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function newProjectWith(page: Page, file: string) {
  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();
  const media = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await media).setFiles(file);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();
}

async function exportVideo(page: Page) {
  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
}

test('with a sink, only outcome events leave, to its one host, without names or text; the home switch stops them (G-3)', async ({ page, baseURL }, info) => {
  test.setTimeout(300_000);
  const s = await sinkPage(page, baseURL);
  const video = info.outputPath(`${FILE_MARK}.mp4`);
  fs.copyFileSync(path.join(import.meta.dirname, '..', 'fixtures', 'landscape.mp4'), video);
  await newProjectWith(page, video);
  await tool(page, 'Text').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill(TEXT_MARK);
  await page.getByRole('button', { name: 'Done' }).click();
  await exportVideo(page);
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();
  await expect.poll(s.names).toEqual(['media_import_started', 'media_import_ended', 'export_started', 'export_completed']);
  // Back home: the project is named there, and the switch is where the Privacy link is.
  await page.goto('./');
  await page.getByRole('button', { name: /^Rename / }).first().click();
  const sheet = page.getByRole('dialog', { name: 'Rename' });
  await sheet.getByRole('textbox', { name: 'Project name' }).fill(PROJECT_MARK);
  await sheet.getByRole('button', { name: 'Save' }).click();
  await expect(page.getByRole('button', { name: `Open ${PROJECT_MARK}` })).toBeVisible();

  const imported = s.events.find((e) => e.name === 'media_import_ended')!, done = s.events.find((e) => e.name === 'export_completed')!;
  console.log(`events (${info.project.name}): ${s.events.map((e) => `${e.name} ${JSON.stringify(e.props)}`).join('\n')}`);
  expect(imported.props).toMatchObject({ added: 1, failed: 0 });
  expect(done.props).toMatchObject({ resolution: expect.any(Number), fps: 30, quick: 'no' });
  expect(['iphone', 'android'], 'the device class of the emulated phone').toContain(done.props.device);
  const outside = s.requests.filter((r) => !ALLOWED.some((h) => h.test(new URL(r.url).hostname)));
  expect(outside.map((r) => r.url), 'no host but the sink is new').toEqual([]);
  const leaks = s.requests.flatMap((r) => MARKS.filter((m) => r.text.includes(m)).map((m) => `${m} in ${r.url}`));
  expect(leaks, 'no file name, project name or text in any request').toEqual([]);
  // The control: a request that does carry a mark is seen, to the sink too. If the recorder goes blind, this goes red.
  const seen = s.requests.length;
  await page.evaluate(async ([url, m]) => { await fetch(url, { method: 'POST', body: JSON.stringify({ eventName: 'x', props: { m } }) }).catch(() => undefined); }, [SINK, FILE_MARK]);
  await expect.poll(() => s.requests.slice(seen).filter((r) => r.text.includes(FILE_MARK)).length, { message: 'a planted leak is seen' }).toBeGreaterThan(0);

  const sw = page.getByRole('switch', { name: 'Anonymous statistics' });
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await sw.click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  const before = s.events.length;
  await page.getByRole('button', { name: `Open ${PROJECT_MARK}` }).click();
  await exportVideo(page);
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  await page.waitForTimeout(1000);
  expect(s.events.length, 'nothing after the person said no').toBe(before);
});

test('an export the tab did not finish is sent as abandoned when Kadr opens again, once (G-3, docs/16 Z3)', async ({ page, baseURL }) => {
  test.setTimeout(300_000);
  const s = await sinkPage(page, baseURL);
  await newProjectWith(page, path.join(import.meta.dirname, '..', 'fixtures', 'long_1.mp4')); // 60 s: the export is still running
  await exportVideo(page);
  await expect.poll(s.names).toContain('export_started');
  await page.reload(); // the tab is gone mid-export, as when iOS kills it
  await expect.poll(s.names).toContain('export_abandoned');
  await page.reload();
  await page.waitForTimeout(1500);
  expect(s.names().filter((n) => n === 'export_abandoned'), 'said once').toHaveLength(1);
  expect(s.names()).not.toContain('export_completed');
});
