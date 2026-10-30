// Measurement, not a check (v1.4.20, docs/02): where the time goes when a phone video is added as an overlay, and what
// the overlay costs the export. Stages are timed inside the page; the app is not changed for it. Runs only on request:
//   OVERLAY_COST=1 [M_EXPORT=1] [M_GPU=1] [M_PERSIST=1] [M_OVERLAYS=a.mov,b.mp4] [M_MAIN=…] [M_OUT=file.jsonl] \
//     E2E_URL=… npx playwright test e2e/overlay-cost.spec.ts --project=iphone-webkit
// Files: PHONE_ALL=1 npm run fixtures. Each run appends one JSON line per overlay to M_OUT.
import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const fx = (n: string) => path.join(import.meta.dirname, '..', 'fixtures', n);
const MAIN = process.env.M_MAIN ?? 'phone_1080_h264.mp4';
const OVERLAYS = (process.env.M_OVERLAYS ?? 'phone_4k_hevc.mov,phone_4k_h264.mp4,phone_1080_hevc.mov,phone_1080_h264.mp4').split(',');
const EXPORT = !!process.env.M_EXPORT;
/** A profile on disk, as a phone's browser has: IndexedDB keeps the file as a Blob (an ephemeral WebKit context refuses Blobs). */
const PERSIST = !!process.env.M_PERSIST;
/** Chromium only: a CPU profile of the export with the overlay, summed by function (self time). */
const PROFILE = !!process.env.M_PROFILE;
/** Plays 5 s with the overlay and reports the preview's frames per second and draw times. */
const PLAY = !!process.env.M_PLAY;
type Node = { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] };
function summarize(profile: { nodes: Node[]; samples: number[]; timeDeltas: number[] }) {
  const self = new Map<number, number>();
  profile.samples.forEach((id, i) => self.set(id, (self.get(id) ?? 0) + (profile.timeDeltas[i] ?? 0)));
  const byName = new Map<string, number>();
  for (const n of profile.nodes) {
    const k = `${n.callFrame.functionName || '(anon)'} ${n.callFrame.url.split('/').pop() ?? ''}:${n.callFrame.lineNumber}`;
    byName.set(k, (byName.get(k) ?? 0) + (self.get(n.id) ?? 0) / 1000);
  }
  return [...byName].sort((a, b) => b[1] - a[1]).slice(0, 30).map(([k, ms]) => `${Math.round(ms)}ms ${k}`);
}
const OUT = process.env.M_OUT ?? path.join(import.meta.dirname, '..', 'test-results', 'overlay-cost.jsonl');

test.use({ serviceWorkers: 'block' });
// M_GPU=1: Chromium on the real GPU with hardware decoding, as Android Chrome runs (headless defaults to software GL).
if (process.env.M_GPU) test.use({ launchOptions: { args: ['--enable-gpu', '--use-angle=metal', '--ignore-gpu-blocklist'] } });

const init = () => {
    localStorage.setItem('kadr.tips', '99');
    localStorage.setItem('kadr.locale', 'en');
    localStorage.setItem('kadr.hint.move', '1');
    localStorage.setItem('kadr.iosVideoTip.v3', '1');
    localStorage.setItem('kadr.exportPrefs', JSON.stringify({ quick: false }));
    Object.defineProperty(navigator, 'canShare', { value: undefined });
    const w = window as unknown as { __st: { name: string; at: number }[]; __armed: boolean };
    const log: { name: string; at: number }[] = (w.__st = []);
    const at = (name: string) => { if (w.__armed) log.push({ name, at: performance.now() }); };
    document.addEventListener('change', (e) => { if ((e.target as HTMLInputElement).type === 'file') at('change'); }, true);
    const est = navigator.storage?.estimate?.bind(navigator.storage);
    if (est) navigator.storage.estimate = () => { at('probed'); return est(); };
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const k = String(key);
      if (/^[bcw]:/.test(k)) { at(`put:${k.slice(0, 2)}`); this.transaction.addEventListener('complete', () => at(`stored:${k.slice(0, 2)}`)); }
      return put.call(this, value, key);
    } as typeof put;
    const get = IDBObjectStore.prototype.get;
    IDBObjectStore.prototype.get = function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
      const k = String(key);
      if (/^[bcw]:/.test(k)) at(`get:${k.slice(0, 2)}`);
      return get.call(this, key);
    } as typeof get;
    for (const C of ['VideoDecoder', 'AudioDecoder'] as const) {
      const N = (window as unknown as Record<string, new (init: unknown) => object>)[C];
      if (!N) continue;
      (window as unknown as Record<string, unknown>)[C] = class extends N { constructor(init: unknown) { super(init); at(`new:${C}`); } };
      Object.assign((window as unknown as Record<string, unknown>)[C] as object, { isConfigSupported: (N as unknown as { isConfigSupported: unknown }).isConfigSupported });
    }
    // Main-thread cost of the export's per-layer steps (armed separately from the import stages).
    const cost = ((window as unknown as { __cost: Record<string, number> }).__cost = { on: 0, draw2d: 0, n2d: 0, tex: 0, ntex: 0 });
    const d2 = CanvasRenderingContext2D.prototype.drawImage;
    const VF = window.VideoFrame;
    CanvasRenderingContext2D.prototype.drawImage = function (this: CanvasRenderingContext2D, ...a: unknown[]) {
      if (!cost.on || !VF || !(a[0] instanceof VF)) return (d2 as (...x: unknown[]) => void).apply(this, a);
      const t = performance.now();
      (d2 as (...x: unknown[]) => void).apply(this, a);
      cost.draw2d += performance.now() - t; cost.n2d++;
    } as typeof d2;
    const seen = new WeakSet<object>();
    const tex = WebGL2RenderingContext.prototype.texImage2D;
    WebGL2RenderingContext.prototype.texImage2D = function (this: WebGL2RenderingContext, ...a: unknown[]) {
      const src = a[a.length - 1];
      const frame = !!VF && src instanceof VF;
      if ((src instanceof HTMLCanvasElement || frame) && !seen.has(src as object)) { seen.add(src as object); at(`tex:${frame ? 'frame' : `${(src as HTMLCanvasElement).width}x${(src as HTMLCanvasElement).height}`}`); }
      if (!cost.on || !(src instanceof HTMLCanvasElement || frame)) return (tex as (...x: unknown[]) => void).apply(this, a);
      const t = performance.now();
      (tex as (...x: unknown[]) => void).apply(this, a);
      cost.tex += performance.now() - t; cost.ntex++;
    } as typeof tex;
    new MutationObserver(() => {
      if (w.__armed && document.querySelector('.tl-row.overlay .clip') && !log.some((x) => x.name === 'clip')) at('clip');
    }).observe(document, { subtree: true, childList: true });
};
test.beforeEach(async ({ page }) => { await page.addInitScript(init); });

const tool = (page: Page, name: string) => page.getByRole('button', { name, exact: true });

async function exportVideo(page: Page, label: string, info: { outputPath: (n: string) => string; project: { name: string } }) {
  const cdp = PROFILE && info.project.name.includes('chromium') ? await page.context().newCDPSession(page) : null;
  if (cdp) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 500 }); await cdp.send('Profiler.start'); }
  await tool(page, 'Export').first().click();
  await page.getByRole('radio', { name: 'Video', exact: true }).click();
  await page.getByRole('radio', { name: 'TikTok, Reels, Shorts' }).click();
  await page.evaluate(() => { const c = (window as unknown as { __cost: Record<string, number> }).__cost; for (const k of Object.keys(c)) c[k] = 0; c.on = 1; });
  const t0 = Date.now();
  await page.getByRole('button', { name: 'Export video' }).click();
  await expect(page.getByText(/Ready: .* MB/)).toBeVisible({ timeout: 900_000 });
  const ms = Date.now() - t0;
  if (cdp) {
    const { profile } = await cdp.send('Profiler.stop');
    fs.writeFileSync(info.outputPath(`${label}.cpuprofile`), JSON.stringify(profile));
    console.log(`PROFILE ${label}\n${summarize(profile as unknown as Parameters<typeof summarize>[0]).join('\n')}`);
  }
  const cost = await page.evaluate(() => { const c = (window as unknown as { __cost: Record<string, number> }).__cost; c.on = 0; return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, Math.round(v)])); });
  const dl = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save / Share' }).click();
  const file = info.outputPath(`${label}-${(await dl).suggestedFilename()}`);
  await (await dl).saveAs(file);
  await page.getByRole('button', { name: 'Done' }).click();
  const probe = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_name,width,height,r_frame_rate', '-of', 'compact', file]).toString().trim().replace(/\n/g, ' | ');
  return { ms, cost, probe };
}

for (const overlay of OVERLAYS) {
  test(`overlay ${overlay} on ${MAIN}`, async ({ page: fresh, playwright }, info) => {
    test.setTimeout(1_800_000);
    test.skip(!process.env.OVERLAY_COST, 'a measurement: OVERLAY_COST=1');
    test.skip(![MAIN, overlay].every((f) => fs.existsSync(fx(f))), 'needs PHONE_ALL=1 npm run fixtures');
    test.skip(info.project.name.includes('chromium') && /hevc/.test(overlay + MAIN), 'Playwright Chromium has no HEVC decoder');
    let page = fresh;
    let ctx: BrowserContext | null = null;
    if (PERSIST) {
      const { defaultBrowserType, ...use } = info.project.use as Record<string, unknown>;
      void defaultBrowserType;
      const type = info.project.name.includes('webkit') ? playwright.webkit : playwright.chromium;
      ctx = await type.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'kadr-measure-')), { ...use, serviceWorkers: 'block', acceptDownloads: true });
      page = ctx.pages()[0] ?? await ctx.newPage();
      await page.addInitScript(init);
    }
    await page.goto('./');
    await page.getByRole('button', { name: 'New project' }).click();
    await page.locator('.aspect-card', { hasText: '9:16' }).click();
    await expect(page.locator('.preview-canvas')).toBeVisible();
    let chooser = page.waitForEvent('filechooser');
    await tool(page, 'Media').click();
    await (await chooser).setFiles([fx(MAIN)]);
    await expect(page.locator('.tl-row.main .clip')).toHaveCount(1, { timeout: 300_000 });
    await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { __kadrPerf: { marks: Record<string, number> } }).__kadrPerf.marks).filter((k) => k.startsWith('thumbs:')).length), { timeout: 300_000 }).toBe(1);
    await page.getByRole('button', { name: 'Close tools' }).click();
    const report: Record<string, unknown> = { engine: info.project.name, main: MAIN, overlay, size: Math.round(fs.statSync(fx(overlay)).size / 1e6) };
    if (EXPORT) report.exportNoOverlay = await exportVideo(page, 'plain', info);
    await page.waitForTimeout(1000);

    await page.evaluate(() => { (window as unknown as { __armed: boolean }).__armed = true; });
    chooser = page.waitForEvent('filechooser');
    await tool(page, 'Overlay').click();
    await (await chooser).setFiles([fx(overlay)]);
    await expect(page.locator('.tl-row.overlay .clip, .toast.error')).toHaveCount(1, { timeout: 600_000 });
    await expect(page.locator('.toast.error')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => (window as unknown as { __st: { name: string }[] }).__st.filter((x) => x.name.startsWith('tex:')).length), { timeout: 600_000 }).toBeGreaterThan(0);
    await expect.poll(() => page.evaluate(() => Object.keys((window as unknown as { __kadrPerf: { marks: Record<string, number> } }).__kadrPerf.marks).filter((k) => k.startsWith('thumbs:')).length), { timeout: 600_000 }).toBe(2);
    await page.waitForTimeout(1500);
    const { st, marks } = await page.evaluate(() => ({
      st: (window as unknown as { __st: { name: string; at: number }[] }).__st,
      marks: (window as unknown as { __kadrPerf: { marks: Record<string, number> } }).__kadrPerf.marks,
    }));
    const t0 = st.find((x) => x.name === 'change')!.at;
    const first = (n: string) => { const x = st.find((s) => s.name.startsWith(n)); return x ? Math.round(x.at - t0) : null; };
    const thumbs = Object.entries(marks).filter(([k]) => k.startsWith('thumbs:')).map(([, v]) => v).sort((a, b) => a - b)[1];
    report.stages = {
      // stored: the file as one Blob; WebKit refuses Blobs in an ephemeral context, then it goes in 16 MB chunks (`c:`).
      probed: first('probed'), storeStart: first('put:'), stored: first('stored:b') ?? st.filter((x) => x.name === 'stored:c:').map((x) => Math.round(x.at - t0)).at(-1) ?? null, clipVisible: first('clip'),
      firstFrame: first('tex:'), thumbnails: Math.round(thumbs - t0),
      decoders: st.filter((x) => x.name.startsWith('new:')).map((x) => `${x.name.slice(4, 9)}@${Math.round(x.at - t0)}`).join(' '),
      blobReads: st.filter((x) => x.name.startsWith('get:')).map((x) => `${x.name.slice(4)}@${Math.round(x.at - t0)}`).join(' '),
    };
    console.log('MEASURE import', JSON.stringify(report));
    if (PLAY) {
      const before = await page.evaluate(() => { const p = (window as unknown as { __kadrPerf: { drawn: number; drawMs: number[] } }).__kadrPerf; p.drawMs.length = 0; return p.drawn; });
      await page.getByRole('button', { name: 'Play', exact: true }).click();
      await page.waitForTimeout(5000);
      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      const { drawn, drawMs } = await page.evaluate(() => (window as unknown as { __kadrPerf: { drawn: number; drawMs: number[] } }).__kadrPerf);
      const sorted = [...drawMs].sort((a, b) => a - b), q = (x: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(x * sorted.length))] ?? 0);
      report.preview = { fps: Math.round(((drawn - before) / 5) * 10) / 10, drawMsP50: q(0.5), drawMsP95: q(0.95) };
    }
    if (EXPORT) {
      await page.evaluate(() => { (window as unknown as { __armed: boolean }).__armed = false; });
      report.exportWithOverlay = await exportVideo(page, 'overlay', info);
    }
    console.log('MEASURE', JSON.stringify(report));
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    fs.appendFileSync(OUT, `${JSON.stringify({ ...report, persist: PERSIST })}\n`);
    await ctx?.close();
  });
}
