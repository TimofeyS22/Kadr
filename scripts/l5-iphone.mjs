// L5-авто (docs/16 §4): the inner part of the main path on a real iPhone, through Safari's WebDriver. System steps are
// replaced and the journal says so: the project is the built-in sample instead of a file from Photos, and the finished
// file is checked in the page instead of going to the share sheet.
//   node scripts/l5-iphone.mjs [site URL]     (phone: unlocked, Web Inspector and Remote Automation on)
// Env: L5_UDID picks a phone when several are connected.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? 'https://timofeys22.github.io/Kadr/';
const PORT = 4446;
const OUT = process.env.L5_OUT ?? join(process.env.TMPDIR ?? '/tmp', 'kadr-l5');
const JOURNAL = 'reports/L5 — журнал.md';
mkdirSync(OUT, { recursive: true });

const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));

async function call(method, path, body, ms = 120_000) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}
const caps = { browserName: 'safari', platformName: 'ios', 'safari:useSimulator': false, ...(process.env.L5_UDID ? { 'safari:deviceUDID': process.env.L5_UDID } : { 'safari:deviceType': 'iPhone' }) };
// A phone that has just locked or reconnected refuses a session for a moment.
let session;
for (let attempt = 1; !session; attempt++) {
  try {
    session = await call('POST', '/session', { capabilities: { alwaysMatch: caps } });
  } catch (e) {
    if (attempt === 5) { driver.kill(); console.error(`L5: no session: ${e.message}`); process.exit(2); }
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const S = `/session/${session.sessionId}`;
await call('POST', `${S}/timeouts`, { script: 180_000 });
const js = (script, ...args) => call('POST', `${S}/execute/sync`, { script, args });
const jsAsync = (script, ...args) => call('POST', `${S}/execute/async`, { script, args }, 200_000);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A button or radio by what a screen reader calls it, as the e2e tests find it. */
const FIND = `const name = arguments[0];
  return [...document.querySelectorAll('button,[role=radio],[role=switch]')].find((e) => e.offsetParent !== null && ((e.getAttribute('aria-label') || e.textContent).trim() === name)) || null;`;
async function waitFor(what, fn, ms = 60_000) {
  const t = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`${what}: not within ${ms} ms`);
    await sleep(150);
  }
}
const button = (name, ms) => waitFor(`button "${name}"`, () => js(FIND, name), ms);
/**
 * click() in the page. safaridriver cannot click an element on iOS ("no such element"), and its touch actions arrive as a
 * long press that selects text (2026-11-09, iPhone 15, iOS 26.5.2). Real fingers are the manual run's job (docs/16 §4).
 */
const tap = async (name, ms) => {
  await button(name, ms);
  await js(`const found = (function () { ${FIND} }).apply(null, arguments); found.scrollIntoView({ block: 'nearest', inline: 'nearest' }); found.click();`, name);
};
const count = (css) => js('return document.querySelectorAll(arguments[0]).length', css);
const shot = async (name) => writeFileSync(join(OUT, `${name}.png`), Buffer.from(await call('GET', `${S}/screenshot`), 'base64'));

const WATCH = `if (!window.__l5) {
  window.__l5 = { errors: [], toasts: [], blob: null };
  addEventListener('error', (e) => window.__l5.errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__l5.errors.push(String(e.reason)));
  new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => { if (!window.__l5.toasts.includes(el.textContent)) window.__l5.toasts.push(el.textContent); })).observe(document, { subtree: true, childList: true });
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  const create = URL.createObjectURL;
  URL.createObjectURL = function (b) { if (b instanceof Blob && /^video/.test(b.type)) window.__l5.blob = b; return create.call(URL, b); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download && this.href.startsWith('blob:')) return; return click.call(this); };
}`;

const steps = [];
const journal = { url: URL_, started: new Date().toISOString(), replaced: 'sample project instead of Photos; file checked in the page instead of the share sheet; taps are click() in the page, not fingers', peakMemory: 'not available in Safari' };
async function step(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    steps.push({ name, ms: Date.now() - t, ok: true, note });
    console.log(`ok   ${name}: ${Date.now() - t} ms${note ? ` (${JSON.stringify(note)})` : ''}`);
  } catch (e) {
    steps.push({ name, ms: Date.now() - t, ok: false, error: e.message });
    console.log(`FAIL ${name}: ${e.message}`);
    await shot(`fail-${name}`).catch(() => undefined);
    throw e;
  }
}

let failed = false;
try {
  await step('cold start to the home screen', async () => {
    await call('POST', `${S}/url`, { url: URL_ });
    await js("localStorage.setItem('kadr.tips','99');localStorage.setItem('kadr.locale','en');localStorage.setItem('kadr.hint.move','1');localStorage.setItem('kadr.iosVideoTip.v3','1');localStorage.setItem('kadr.exportPrefs',JSON.stringify({quick:false}));");
    await call('POST', `${S}/url`, { url: URL_ });
    await button('Try a sample', 60_000);
    await js(WATCH);
    return { version: await js("return document.querySelector('.home-foot')?.textContent.match(/v[\\d.]+/)?.[0] ?? null") };
  });
  journal.env = await jsAsync(`const done = arguments[arguments.length - 1];
    (async () => {
      const gl = document.createElement('canvas').getContext('webgl2');
      const dbg = gl && gl.getExtension('WEBGL_debug_renderer_info');
      const est = await navigator.storage.estimate().catch(() => null);
      const enc = async (codec) => (await VideoEncoder.isConfigSupported({ codec, width: 1080, height: 1920, bitrate: 8e6, framerate: 30 }).catch(() => ({ supported: false }))).supported;
      return { ua: navigator.userAgent, secure: isSecureContext, screen: [screen.width, screen.height, devicePixelRatio], cores: navigator.hardwareConcurrency, sw: 'serviceWorker' in navigator, swControlled: !!navigator.serviceWorker?.controller,
        videoDecoder: typeof VideoDecoder, videoEncoder: typeof VideoEncoder, h264High: await enc('avc1.640028'), hevc: await enc('hvc1.1.6.L120.B0'), opfs: !!navigator.storage?.getDirectory, webgpu: !!navigator.gpu,
        gpu: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : null, maxTexture: gl && gl.getParameter(gl.MAX_TEXTURE_SIZE), quotaGb: est && Math.round(est.quota / 1e8) / 10, persisted: await navigator.storage.persisted?.() };
    })().then(done, (e) => done({ error: String(e) }));`);
  console.log('env', JSON.stringify(journal.env));

  await step('sample project opens', async () => {
    await tap('Try a sample');
    await waitFor('clips on the timeline', async () => (await count('.tl-row.main .clip')) > 0, 90_000);
    await js(WATCH);
    await sleep(1500);
    await shot('editor');
    return { clips: await count('.tl-row.main .clip') };
  });
  await step('plays', async () => {
    await js("const c = document.querySelector('[aria-label=\"Close tools\"]'); if (c) c.click();");
    await tap('Play');
    const fps = await jsAsync(`const done = arguments[arguments.length - 1]; let n = 0; const t = performance.now();
      const tick = () => { n++; if (performance.now() - t < 3000) requestAnimationFrame(tick); else done(Math.round(n / ((performance.now() - t) / 1000))); }; requestAnimationFrame(tick);`);
    await tap('Pause');
    return { uiFps: fps };
  });
  await step('split and undo', async () => {
    const before = await count('.tl-row.main .clip');
    // The timeline listens to pointer events, which click() does not send.
    await js(`const el = document.querySelector('.tl-row.main .clip'), r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', at));
      el.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 }));
      el.click();`);
    await sleep(300);
    await js("document.querySelector('.tl-scroll').scrollLeft = 60;");
    await sleep(500);
    await tap('Split');
    await waitFor('one more clip', async () => (await count('.tl-row.main .clip')) === before + 1, 15_000);
    await tap('Undo');
    await waitFor('clips back', async () => (await count('.tl-row.main .clip')) === before, 15_000);
  });
  let exportMs = 0;
  await step('export 1080p', async () => {
    await tap('Export');
    await tap('Video');
    await tap('TikTok, Reels, Shorts');
    await sleep(400);
    await shot('export-sheet');
    const t = Date.now();
    await tap('Export video');
    const ready = await waitFor('"Ready"', () => js("const m = document.body.innerText.match(/Ready: [^\\n]* MB/); return m && m[0];"), 240_000);
    exportMs = Date.now() - t;
    await shot('export-done');
    return { ready, exportMs };
  });
  await step('the file is whole', async () => {
    await tap('Save / Share');
    await waitFor('the file', () => js('return !!window.__l5.blob'), 15_000);
    const seen = await jsAsync(`const done = arguments[arguments.length - 1];
      (async () => {
        const b = window.__l5.blob;
        // iOS loads a video only if it is in the page and has been asked to play.
        const v = Object.assign(document.createElement('video'), { muted: true, playsInline: true, preload: 'auto', src: URL.createObjectURL(b) });
        v.style.cssText = 'position:fixed;left:0;top:0;width:2px;height:2px;opacity:0.01';
        document.body.append(v);
        await Promise.race([v.play().catch(() => undefined), new Promise((ok) => setTimeout(ok, 3000))]);
        v.pause();
        if (!(v.readyState >= 1)) await new Promise((ok, ko) => { v.onloadedmetadata = ok; v.onerror = () => ko(new Error('the file does not load')); setTimeout(() => ko(new Error('no metadata in 20 s')), 20000); });
        const c = Object.assign(document.createElement('canvas'), { width: 32, height: 56 });
        const g = c.getContext('2d', { willReadFrequently: true });
        const luma = async (t) => {
          await new Promise((ok) => { v.onseeked = ok; v.currentTime = t; setTimeout(ok, 5000); });
          await new Promise((ok) => setTimeout(ok, 200));
          g.drawImage(v, 0, 0, 32, 56);
          const d = g.getImageData(0, 0, 32, 56).data; let n = 0;
          for (let i = 0; i < d.length; i += 4) n += (d[i] + d[i + 1] + d[i + 2]) / 3;
          return Math.round(n / (d.length / 4));
        };
        return { type: b.type, mb: Math.round(b.size / 1e5) / 10, duration: v.duration, width: v.videoWidth, height: v.videoHeight, start: await luma(0.5), end: await luma(v.duration - 0.5) };
      })().then(done, (e) => done({ error: String(e) }));`);
    if (seen.error) throw new Error(seen.error);
    if (seen.start < 12 || seen.end < 12) throw new Error(`a black picture: ${JSON.stringify(seen)}`);
    journal.realtime = Math.round((seen.duration * 1000 / exportMs) * 100) / 100;
    return { ...seen, realtimeX: journal.realtime };
  });
  await step('close and open: the project is the same', async () => {
    const before = await count('.tl-row.main .clip');
    await tap('Done').catch(() => undefined);
    await sleep(1500); // autosave
    journal.errors = await js('return window.__l5');
    journal.errors = { errors: journal.errors.errors, toasts: journal.errors.toasts };
    await call('POST', `${S}/url`, { url: URL_ });
    const open = await waitFor('a saved project', () => js("return document.querySelector('.project-open')"), 30_000);
    void open;
    await js("document.querySelector('.project-open').click();");
    await waitFor('the same clips', async () => (await count('.tl-row.main .clip')) === before, 60_000);
    return { clips: before };
  });
} catch {
  failed = true;
} finally {
  journal.finished = new Date().toISOString();
  journal.steps = steps;
  journal.device = { name: session.capabilities['safari:deviceName'], type: session.capabilities['safari:deviceType'], ios: session.capabilities['safari:platformVersion'] };
  writeFileSync(join(OUT, 'run.json'), JSON.stringify(journal, null, 2));
  await call('DELETE', S).catch(() => undefined);
  driver.kill();
}
if (!existsSync(JOURNAL)) writeFileSync(JOURNAL, '# L5 — журнал (настоящие устройства)\n\n> Пишет `scripts/l5-iphone.mjs`. `L5-авто`: системные шаги заменены, см. `docs/16` §4. Медиа в журнал не попадают.\n\n| Дата | Устройство | iOS | Сайт | Версия | Исход | Экспорт, × реального времени | Шаги, мс |\n|---|---|---|---|---|---|---|---|\n');
const v = steps[0]?.note?.version ?? '?';
appendFileSync(JOURNAL, `| ${journal.started} | ${journal.device.type} | ${journal.device.ios} | ${URL_} | ${v} | ${failed ? `СБОЙ: ${steps.at(-1).name}: ${steps.at(-1).error}`.replaceAll('|', '/') : 'прошёл'} | ${journal.realtime ?? '—'} | ${steps.map((s) => `${s.name}: ${s.ms}`).join('; ')} |\n`);
console.log(failed ? 'L5: FAILED' : 'L5: passed', OUT);
process.exit(failed ? 1 : 0);
