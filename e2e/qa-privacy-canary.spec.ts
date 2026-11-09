// What leaves the device (audit V-238, docs/16 N14). The audit in editor.spec.ts checks hosts and methods, so text in a
// GET to an allowed host went unseen. Here a file name, a project name, a typed line and captions carry marks, and no
// request may contain them in any usual encoding: not in the URL, the headers or the body, on any host, from any thread.
import { expect, test, type Page, type Request } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

const FILE_MARK = 'kadrfilemark7q';
const PROJECT_MARK = 'kadrprojmark4w';
const TEXT_MARK = 'Секретнаястрока9';
const CAPTION_MARK = 'Субтитрметка3';
const MARKS = [FILE_MARK, PROJECT_MARK, TEXT_MARK, CAPTION_MARK];

/** Every form a mark could travel in: plain, URL-encoded, hex, and base64 at each of the three byte alignments. */
function forms(mark: string): string[] {
  const bytes = Buffer.from(mark, 'utf8');
  const out = [mark, encodeURIComponent(mark), encodeURIComponent(mark).toLowerCase(), bytes.toString('hex')];
  for (const skip of [0, 1, 2]) {
    const b64 = bytes.subarray(skip).toString('base64').replace(/=+$/, '');
    // The last characters depend on the bytes that follow; the middle does not.
    out.push(b64.slice(0, -2), b64.slice(0, -2).replace(/\+/g, '-').replace(/\//g, '_'));
  }
  return out;
}
const LOOK_FOR = MARKS.flatMap((m) => forms(m).map((form) => ({ mark: m, form })));

type Seen = { url: string; text: string };
async function record(r: Request): Promise<Seen> {
  const headers = await r.allHeaders().catch(() => r.headers());
  const body = r.postDataBuffer();
  return { url: r.url(), text: [r.url(), ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), body?.toString('latin1') ?? '', body?.toString('utf8') ?? ''].join('\n') };
}
const leaks = (seen: Seen[]) => seen.flatMap((s) => LOOK_FOR.filter((l) => s.text.includes(l.form)).map((l) => `${l.mark} (as ${l.form}) in ${s.url}`));

test('names and text stay on the device: no request carries them, and the check sees one that does', async ({ page }, info) => {
  test.setTimeout(300_000);
  const pending: Promise<Seen>[] = [];
  page.context().on('request', (r) => { if (!/^(blob|data):/.test(r.url())) pending.push(record(r)); });
  page.on('dialog', (d) => void (d.type() === 'prompt' ? d.accept(PROJECT_MARK) : d.accept()));
  await page.addInitScript(() => {
    localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.iosFormatCard.v1', '1');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined }); // headless WebKit has no share sheet
  });

  const video = info.outputPath(`${FILE_MARK}.mp4`), srt = info.outputPath('c.srt');
  fs.copyFileSync(fx('landscape.mp4'), video);
  fs.writeFileSync(srt, `1\n00:00:00,500 --> 00:00:03,000\n${CAPTION_MARK}\n`);

  await page.goto('./');
  await page.getByRole('button', { name: 'New project' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  await expect(page.locator('.preview-canvas')).toBeVisible();

  await tool(page, 'Captions').click();
  const subs = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Import .srt or .vtt' }).click();
  await (await subs).setFiles(srt);
  await expect(page.locator('.clip-caption')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.keyboard.press('Escape');
  const close = page.getByRole('button', { name: 'Close tools' });
  if (await close.isVisible()) await close.click();

  const media = page.waitForEvent('filechooser');
  await tool(page, 'Media').click();
  await (await media).setFiles(video);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  if (await close.isVisible()) await close.click();

  await tool(page, 'Text').click();
  await page.getByRole('textbox', { name: 'Text', exact: true }).fill(TEXT_MARK);
  await page.getByRole('button', { name: 'Done' }).click();
  await page.waitForTimeout(1200); // autosave: the words reach storage

  await page.getByRole('button', { name: 'Export' }).first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'Small file' }).click();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 120_000 });
  await page.getByRole('button', { name: 'Done' }).click();

  // The name is typed on the home screen; coming back there also loads whatever the home screen loads.
  await page.goto('./');
  await page.getByRole('button', { name: /^Rename / }).first().click();
  await expect(page.getByRole('button', { name: `Open ${PROJECT_MARK}` })).toBeVisible();
  await page.waitForTimeout(800);

  const quiet = await Promise.all(pending);
  expect(quiet.length, 'the page loaded through the recorder').toBeGreaterThan(3);
  expect(leaks(quiet)).toEqual([]);

  // The control: a page or a worker that does send them is seen. If the recorder or the encodings go blind, this goes red.
  const planted: [string, RegExp][] = [
    [`?t=${encodeURIComponent(TEXT_MARK)}`, /Секретнаястрока9/],
    [`?x=${Buffer.from(FILE_MARK).toString('base64')}`, /kadrfilemark7q/],
  ];
  for (const [query, expected] of planted) {
    const before = pending.length;
    await page.evaluate(async (q) => { await fetch(location.origin + location.pathname + q).catch(() => undefined); }, query);
    await expect.poll(() => pending.length, { message: 'the planted request was recorded' }).toBeGreaterThan(before);
    expect(leaks(await Promise.all(pending.slice(before))).join('\n')).toMatch(expected);
  }
  const before = pending.length;
  await page.evaluate(async (mark) => {
    const src = `fetch(${JSON.stringify(`${location.origin}${location.pathname}?w=`)} + ${JSON.stringify(encodeURIComponent(mark))}).finally(() => postMessage(1))`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    const w = new Worker(url);
    await new Promise((res) => { w.onmessage = res; setTimeout(res, 5000); });
    w.terminate();
    URL.revokeObjectURL(url);
  }, CAPTION_MARK);
  await expect.poll(() => pending.length, { message: 'a request from a worker was recorded' }).toBeGreaterThan(before);
  expect(leaks(await Promise.all(pending.slice(before))).join('\n')).toMatch(/Субтитрметка3/);
  console.log(`privacy marks (${info.project.name}): ${quiet.length} requests clean, ${path.basename(video)} and three texts absent; 3 planted leaks seen`);
});
