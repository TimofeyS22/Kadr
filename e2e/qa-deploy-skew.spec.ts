// Deploy skew (docs/12): a tab opened before a deploy keeps running the old code, and GitHub Pages replaces the whole
// site, so every file the old code loads later (lazy chunks, the speech worker) was gone. The owner's iPhone, 26 minutes
// after the v1.4.15 deploy: "Не получилось сделать рилс: Importing a module script failed." (reproduced here).
// The site is served like GitHub Pages serves it (max-age=600). A deploy is simulated with the same build under new
// file names, so these tests need nothing but the build under test (NEW_DIST, default dist/). OLD_DIST adds the
// owner's real case: a previous version's build open while this one is deployed.
import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const root = path.join(import.meta.dirname, '..');
const fx = (n: string) => path.join(root, 'fixtures', n);
const BUILD = process.env.NEW_DIST ?? path.join(root, 'dist');
const OLD = process.env.OLD_DIST;
const BIG = ['music', 'ru', 'en', 'diag', 'models']; // unhashed folders: linked, not copied

/** A script CI runs around a deploy (.github/workflows/deploy.yml). Not execFileSync: the site is served from this process. */
const run = async (script: string, ...args: string[]) => (await promisify(execFile)('node', [script, ...args], { cwd: root, encoding: 'utf8' })).stdout;
const keepAssets = (site: string, dist: string) => run('scripts/keep-assets.mjs', site, dist);

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8', '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.wasm': 'application/wasm', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json', '.m4a': 'audio/mp4', '.woff2': 'font/woff2', '.woff': 'font/woff',
};

/** The site as GitHub Pages serves it: whatever is in `dir` right now, cacheable for 10 minutes. */
function pages(dir: string): Promise<{ url: string; close(): void }> {
  const server = http.createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    let file = path.join(dir, p.endsWith('/') ? `${p}index.html` : p);
    if (!file.startsWith(dir)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) && !path.extname(file)) file = path.join(dir, 'index.html');
    fs.readFile(file, (err, body) => {
      if (err) { res.writeHead(404, { 'content-type': 'text/html' }).end('<h1>404</h1>'); return; }
      // The length on HEAD too, as Pages sends it: scripts/smoke-live.mjs checks the model parts' sizes that way.
      res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'content-length': String(body.length), 'cache-control': 'max-age=600' }).end(body);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/`, close: () => server.close() })));
}

/** A copy of a build to deploy (it may get old files added); big unhashed folders are linked. */
function copyBuild(dist: string, to: string) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(dist, { withFileTypes: true })) {
    const from = path.join(dist, e.name), dest = path.join(to, e.name);
    if (e.isDirectory() && BIG.includes(e.name)) fs.symlinkSync(fs.realpathSync(from), dest);
    else fs.cpSync(from, dest, { recursive: true });
  }
}

/** The next version, as far as a tab can tell: the same build with every hashed file under a new name. */
function nextVersion(dist: string, to: string) {
  copyBuild(dist, to);
  const assets = path.join(to, 'assets');
  const renames = new Map<string, string>();
  for (const f of fs.readdirSync(assets)) {
    const m = /^(.*-)([\w-]{8})(\.(?:js|mjs|css|wasm))$/.exec(f);
    // Another hash of the same length, never one that differs only in case (macOS disks ignore case).
    if (m) renames.set(f, `${m[1]}${m[2][0].toLowerCase() === 'z' ? 'y' : 'z'}${m[2].slice(1)}${m[3]}`);
  }
  for (const [from, name] of renames) fs.renameSync(path.join(assets, from), path.join(assets, name));
  const texts = [...fs.readdirSync(to).filter((f) => /\.(html|js)$/.test(f)).map((f) => path.join(to, f)),
    ...fs.readdirSync(assets).filter((f) => /\.(m?js|css)$/.test(f)).map((f) => path.join(assets, f))];
  for (const file of texts) {
    let s = fs.readFileSync(file, 'utf8');
    for (const [from, name] of renames) s = s.split(from).join(name);
    // index.html now names other files: its precache revision changes, as it does in a real deploy.
    if (path.basename(file) === 'sw.js') s = s.replace(/(url:"index\.html",revision:")([0-9a-f]+)"/, (_, a: string, r: string) => `${a}${[...r].reverse().join('')}"`);
    fs.writeFileSync(file, s);
  }
}

/** Deploys `build` as GitHub Pages does: the site becomes exactly that folder. */
function deploy(site: string, build: string) {
  fs.rmSync(site, { recursive: true, force: true });
  fs.renameSync(build, site);
}

/** Russian interface, no tips; every toast the page shows is recorded as 'error: …' or 'info: …'. */
async function watchToasts(page: Page, toasts: string[]) {
  await page.addInitScript(() => { localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.hint.move', '1'); });
  await page.exposeFunction('__toast', (s: string) => { if (!toasts.includes(s)) toasts.push(s); });
  await page.addInitScript(() => new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
    void (window as unknown as { __toast(s: string): Promise<void> }).__toast(`${el.classList.contains('error') ? 'error' : 'info'}: ${el.textContent}`);
  })).observe(document, { subtree: true, childList: true }));
}

async function openEditorWithSpeech(page: Page, url: string, toasts: string[]) {
  await watchToasts(page, toasts);
  await page.goto(url);
  await page.getByRole('button', { name: 'Новый проект' }).click();
  await page.locator('.aspect-card', { hasText: '9:16' }).click();
  const chooser = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: 'Медиа', exact: true }).click();
  await (await chooser).setFiles([fx('speech_ru.mp4')]);
  await expect(page.locator('.tl-row.main .clip')).toHaveCount(1);
  await page.waitForTimeout(800); // autosave
}

/** The entry script the page runs: which version it is. Null while it navigates. */
const scriptOf = (page: Page) => page.evaluate(() => document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src ?? '').catch(() => null);

async function makeReel(page: Page) {
  if (await page.getByRole('button', { name: 'Закрыть инструменты' }).isVisible()) await page.getByRole('button', { name: 'Закрыть инструменты' }).click();
  await page.getByRole('button', { name: 'Рилс в 1 тап', exact: true }).click();
  await page.getByRole('button', { name: 'Сделать рилс' }).click();
}

test.use({ serviceWorkers: 'block' }); // the network path: no service worker answers for the old files

let tmp = '';
test.beforeEach(() => { tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-skew-')); });
test.afterEach(() => { fs.rmSync(tmp, { recursive: true, force: true }); });

test('a tab opened before a deploy keeps working: the deploy keeps the previous version\'s files', async ({ page }) => {
  test.setTimeout(400_000);
  const site = path.join(tmp, 'site');
  copyBuild(OLD ?? BUILD, site);
  const server = await pages(site);
  try {
    const toasts: string[] = [];
    await openEditorWithSpeech(page, server.url, toasts);
    const next = path.join(tmp, 'next');
    if (OLD) copyBuild(BUILD, next); else nextVersion(BUILD, next);
    expect(await keepAssets(server.url, next)).toMatch(/kept 2 generations/); // the live site's files go back in
    deploy(site, next);
    expect(await run('scripts/smoke-live.mjs', server.url)).toMatch(/files of 2 generations served/); // CI's check after the deploy
    await makeReel(page);
    await expect(page.locator('.reel-done')).toBeVisible({ timeout: 300_000 });
    await expect(page.locator('.clip-caption')).toHaveCount(1);
    expect(toasts.filter((x) => x.startsWith('error'))).toEqual([]);
  } finally {
    server.close();
  }
});

test('a tab whose files are gone reloads into the new version, keeps the project and the reel works on the next tap', async ({ page }) => {
  test.setTimeout(400_000);
  const site = path.join(tmp, 'site');
  copyBuild(BUILD, site);
  const server = await pages(site);
  try {
    const toasts: string[] = [];
    await openEditorWithSpeech(page, server.url, toasts);
    const next = path.join(tmp, 'next');
    nextVersion(BUILD, next);
    deploy(site, next); // no files kept: a tab older than the deploys CI keeps
    const reloaded = page.waitForEvent('load', { timeout: 60_000 });
    await makeReel(page);
    await reloaded; // the page reloads into the new version by itself
    expect(toasts.some((x) => /^info: (Kadr обновился|Часть Kadr не загрузилась)\. Перезагру/.test(x)), toasts.join(' | ')).toBe(true); // now, or when the failed reel ends
    await expect.poll(() => toasts.some((x) => x.includes('Повторите')), { timeout: 20_000 }).toBe(true);
    expect(toasts.filter((x) => x.startsWith('error'))).toEqual([]);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1); // the project is where it was
    await makeReel(page);
    await expect(page.locator('.reel-done')).toBeVisible({ timeout: 300_000 });
    await expect(page.locator('.clip-caption')).toHaveCount(1);
  } finally {
    server.close();
  }
});

test('a lazy chunk that is gone (the home screen\'s example) reloads the page into the new version; the next tap works', async ({ page }) => {
  test.setTimeout(180_000);
  // The owner's path: the page's own code imports a chunk the deploy removed (vite:preloadError), not a worker.
  const site = path.join(tmp, 'site');
  copyBuild(BUILD, site);
  const server = await pages(site);
  try {
    const toasts: string[] = [];
    await watchToasts(page, toasts);
    await page.goto(server.url);
    const example = page.getByRole('button', { name: 'Открыть пример' });
    await expect(example).toBeVisible();
    const before = await scriptOf(page);
    const next = path.join(tmp, 'next');
    nextVersion(BUILD, next);
    deploy(site, next); // no files kept
    const reloaded = page.waitForEvent('load', { timeout: 60_000 });
    await example.click();
    await reloaded;
    expect(toasts.some((x) => /^info: (Kadr обновился|Часть Kadr не загрузилась)\. Перезагру/.test(x)), toasts.join(' | ')).toBe(true);
    await expect.poll(() => toasts.some((x) => x.includes('Повторите')), { timeout: 20_000 }).toBe(true);
    expect(toasts.filter((x) => x.startsWith('error'))).toEqual([]);
    expect(await scriptOf(page)).not.toBe(before);
    await page.getByRole('button', { name: 'Открыть пример' }).click();
    await expect(page.locator('.tl-row.main .clip').first()).toBeVisible({ timeout: 60_000 });
  } finally {
    server.close();
  }
});

test.describe('with the service worker', () => {
  test.use({ serviceWorkers: 'allow' });

  test('a new version waits: the open editor is never reloaded, works on its own cached files, and the home screen takes the update', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Playwright WebKit does not run service workers');
    test.setTimeout(400_000);
    const site = path.join(tmp, 'site');
    copyBuild(BUILD, site);
    const server = await pages(site);
    try {
      const toasts: string[] = [];
      const entry = () => scriptOf(page);
      await page.goto(server.url);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await openEditorWithSpeech(page, server.url, toasts); // now under the service worker, with its cached files
      const before = await entry();
      let loads = 0;
      page.on('load', () => loads++);
      const next = path.join(tmp, 'next');
      nextVersion(BUILD, next);
      expect(await keepAssets(server.url, next)).toMatch(/kept 2 generations/);
      deploy(site, next);
      await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
      await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting), { timeout: 30_000 }).toBe(true);
      await makeReel(page);
      await expect(page.locator('.reel-done')).toBeVisible({ timeout: 300_000 });
      await expect(page.locator('.clip-caption')).toHaveCount(1);
      expect(loads, 'the editor was reloaded under the person').toBe(0);
      expect(toasts.filter((x) => x.startsWith('error'))).toEqual([]);
      // Home: nothing is running, the new version takes over.
      await page.locator('.reel-done').getByRole('button').first().click().catch(() => undefined);
      await page.evaluate(() => { location.hash = ''; });
      await expect.poll(async () => (await entry()) ?? before, { timeout: 60_000 }).not.toBe(before);
    } finally {
      server.close();
    }
  });

  test('code gone under an editor the service worker controls: the reload brings the new version, not the old one again', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Playwright WebKit does not run service workers');
    test.setTimeout(400_000);
    // The speech worker is not in the precache: a tab whose worker the deploy removed (no files kept) cannot start
    // speech. A plain reload would get the old page again from the old worker's cache (review 2026-10-28).
    const site = path.join(tmp, 'site');
    copyBuild(BUILD, site);
    const server = await pages(site);
    try {
      const toasts: string[] = [];
      await page.goto(server.url);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await openEditorWithSpeech(page, server.url, toasts);
      const before = await scriptOf(page);
      const next = path.join(tmp, 'next');
      nextVersion(BUILD, next);
      deploy(site, next); // no files kept
      await makeReel(page);
      await expect.poll(async () => (await scriptOf(page)) ?? before, { timeout: 90_000 }).not.toBe(before);
      await expect(page.locator('.tl-row.main .clip')).toHaveCount(1); // the project is where it was
      await expect.poll(() => toasts.some((x) => x.includes('Повторите')), { timeout: 20_000 }).toBe(true);
      expect(toasts.filter((x) => x.startsWith('error')), toasts.join(' | ')).toEqual([]);
      await makeReel(page);
      await expect(page.locator('.reel-done')).toBeVisible({ timeout: 300_000 });
    } finally {
      server.close();
    }
  });

  test('another tab never lets the new version in while this one works; both take it once nothing is running', async ({ page, browserName }) => {
    test.skip(browserName !== 'chromium', 'Playwright WebKit does not run service workers');
    test.setTimeout(300_000);
    const site = path.join(tmp, 'site');
    copyBuild(BUILD, site);
    const server = await pages(site);
    try {
      const entry = scriptOf;
      const waiting = (p: Page) => p.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting).catch(() => false);
      await page.goto(server.url);
      await page.evaluate(async () => { await navigator.serviceWorker.ready; });
      await openEditorWithSpeech(page, server.url, []); // tab A: the editor, its project open
      const before = await entry(page);
      let loadsA = 0;
      page.on('load', () => loadsA++);
      const next = path.join(tmp, 'next');
      nextVersion(BUILD, next);
      expect(await keepAssets(server.url, next)).toMatch(/kept 2 generations/);
      deploy(site, next);
      const home = await page.context().newPage(); // tab B: the home screen finds the new version
      await home.goto(server.url);
      await expect.poll(() => waiting(home), { timeout: 30_000 }).toBe(true);
      await home.waitForTimeout(5000);
      expect(await waiting(home), 'the new version took over while tab A had the editor open').toBe(true);
      expect(loadsA).toBe(0);
      expect(await entry(page)).toBe(before);
      // Tab A goes home: nothing is running anywhere, the new version takes over both tabs.
      await page.evaluate(() => { location.hash = ''; });
      await expect.poll(async () => (await entry(page)) ?? before, { timeout: 90_000 }).not.toBe(before);
      await expect.poll(async () => (await entry(home)) ?? before, { timeout: 30_000 }).not.toBe(before);
      expect(await waiting(home)).toBe(false);
    } finally {
      server.close();
    }
  });
});
