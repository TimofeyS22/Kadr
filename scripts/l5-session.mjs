// The phone's side of the L5 sweeps (docs/21 §9): one safaridriver session on the iPhone and the page helpers every sweep
// shares — buttons found by name and clicked in the page (safaridriver's own touches arrive as long presses), a test file
// pushed in place of the Photos picker, the exported file pulled to the Mac in pieces, counters the page keeps for the
// rows (decoders, WebGL contexts, toasts). Taken from scripts/l5-tools.mjs, whose scenarios keep their own copy.
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import { avOffsets, brokenPackets, joins, parseEbur128, parseVolume, probeSummary } from './l5-verdict.mjs';

const CHUNK = 3 * 2 ** 20;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const fixture = (name) => join(import.meta.dirname, '..', 'fixtures', name);

/** A button, radio, switch or tab by its accessible name (any of the names given), shown on screen. */
const FIND = `const names = arguments[0];
  const own = (e) => { const c = e.cloneNode(true); c.querySelectorAll('.ck-btn-sub').forEach((x) => x.remove()); return c.textContent; };
  const named = (e) => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim() || e.closest('label')?.textContent || own(e)).trim();
  const el = [...document.querySelectorAll('button,[role=radio],[role=switch],[role=tab],[role=menuitem]')].find((e) => e.offsetParent !== null && names.includes(named(e))) || null;`;

/**
 * What the page keeps for the sweeps, set once a document: page errors, every error toast (and every toast's words),
 * console warnings, a file input answered with pushed files, a download kept as a Blob instead of the share sheet,
 * VideoDecoders open now and at most (page only; workers keep their own), WebGL contexts made, lost against the page's
 * will, and asked for in vain (2D canvases too: Safari refuses them past its canvas memory).
 */
const WATCH = `if (!window.__l5) {
  const L = window.__l5 = { errors: [], toasts: [], notes: [], warns: [], files: [], parts: [], blob: null, saved: null,
    dec: { made: 0, open: 0, peak: 0 }, gl: { made: 0, lost: 0, dropped: 0, nulls: 0, nulls2d: 0 } };
  addEventListener('error', (e) => L.errors.push(String(e.message).slice(0, 200)));
  addEventListener('unhandledrejection', (e) => L.errors.push(String(e.reason && (e.reason.message || e.reason)).slice(0, 200)));
  new MutationObserver(() => document.querySelectorAll('.toast').forEach((el) => {
    const t = el.textContent.slice(0, 200);
    if (!L.notes.includes(t)) L.notes.push(t);
    if (el.classList.contains('error') && !L.toasts.includes(t)) L.toasts.push(t);
  })).observe(document, { subtree: true, childList: true, characterData: true });
  const warn = console.warn;
  console.warn = function (...a) { try { L.warns.push(a.map((x) => x && x.name && x.message ? x.name + ': ' + x.message : String(x)).join(' ').slice(0, 400)); if (L.warns.length > 200) L.warns.shift(); } catch {} return warn.apply(this, a); };
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  const aclick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.download && this.href.startsWith('blob:')) { L.saved = this.download; fetch(this.href).then((r) => r.blob()).then((b) => { L.blob = b; }); return; }
    return aclick.call(this);
  };
  const iclick = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file' || !L.files.length) return iclick.call(this);
    const dt = new DataTransfer(); for (const f of L.files) dt.items.add(f); this.files = dt.files; L.files = [];
    this.dispatchEvent(new Event('change', { bubbles: true }));
  };
  if (window.VideoDecoder) {
    const VD = window.VideoDecoder, gone = new WeakSet();
    const shut = (d) => { if (!gone.has(d)) { gone.add(d); L.dec.open--; } };
    window.VideoDecoder = class extends VD {
      constructor(init) { let self = null; super({ ...init, error: (e) => { if (self) shut(self); init.error(e); } }); self = this; L.dec.made++; L.dec.open++; L.dec.peak = Math.max(L.dec.peak, L.dec.open); }
      close() { shut(this); return super.close(); }
    };
  }
  const meant = new WeakSet(), seen = new WeakSet();
  const getContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function (type, ...rest) {
    const c = getContext.call(this, type, ...rest);
    if (!c && type === '2d') L.gl.nulls2d++;
    if (/webgl/.test(type)) {
      if (!c) L.gl.nulls++;
      else if (!seen.has(c)) {
        seen.add(c); L.gl.made++;
        const ext = c.getExtension('WEBGL_lose_context');
        if (ext) { const lose = ext.loseContext.bind(ext); ext.loseContext = () => { meant.add(c); L.gl.dropped++; return lose(); }; }
        this.addEventListener('webglcontextlost', () => { if (!meant.has(c)) L.gl.lost++; });
      }
    }
    return c;
  };
}`;

/**
 * L5_PW=1: a dry run in Playwright's WebKit on this Mac (the e2e's «iPhone 15», a persistent profile — the ephemeral one
 * refuses Blobs in IndexedDB), speaking the few WebDriver commands the sweeps use. It shows that a scenario is built and
 * reaches its steps; it measures nothing of the phone.
 */
async function playwright(out) {
  const { webkit, devices } = await import('@playwright/test');
  const context = await webkit.launchPersistentContext(join(out, 'pw-profile'), { ...devices['iPhone 15'], headless: !process.env.L5_PW_HEADED });
  const pages = context.pages().length ? [...context.pages()] : [await context.newPage()];
  // The page's console and its workers', into L5_OUT/console.log: what Safari's Web Inspector would show on the phone.
  const log = (where) => (m) => appendFileSync(join(out, 'console.log'), `${new Date().toISOString()} ${where} ${m.type()}: ${m.text().slice(0, 600)}\n`);
  const watchPage = (p) => { p.on('console', log('page')); p.on('worker', (w) => w.on('console', log(`worker ${w.url().split('/').pop()}`))); };
  pages.forEach(watchPage);
  context.on('page', watchPage);
  let current = pages[0];
  const handle = (p) => `pw-${pages.indexOf(p)}`;
  const b64 = (buf) => Buffer.from(buf).toString('base64');
  async function call(method, path, body) {
    const tail = path.replace(/^\/session\/[^/]+/, '');
    if (method === 'POST' && tail === '/url') { await current.goto(body.url, { waitUntil: 'load' }); return null; }
    if (method === 'POST' && tail === '/refresh') { await current.reload({ waitUntil: 'load' }); return null; }
    if (method === 'POST' && tail === '/execute/sync') return current.evaluate(([src, args]) => new Function(src).apply(null, args), [body.script, body.args]);
    if (method === 'POST' && tail === '/execute/async') return current.evaluate(([src, args]) => new Promise((done) => { new Function(src).apply(null, [...args, done]); }), [body.script, body.args]);
    if (method === 'GET' && tail === '/screenshot') return b64(await current.screenshot());
    if (method === 'POST' && tail === '/element') return { 'element-6066-11e4-a52e-4f735466cecf': encodeURIComponent(body.value) };
    const el = /^\/element\/([^/]+)\/screenshot$/.exec(tail);
    if (method === 'GET' && el) return b64(await current.locator(decodeURIComponent(el[1])).first().screenshot());
    if (method === 'GET' && tail === '/window') return handle(current);
    if (method === 'POST' && tail === '/window/new') { const p = await context.newPage(); pages.push(p); return { handle: handle(p), type: 'tab' }; }
    if (method === 'POST' && tail === '/window') { current = pages[Number(body.handle.slice(3))]; await current.bringToFront(); return null; }
    if (method === 'DELETE' && tail === '/window') { await current.close(); pages.splice(pages.indexOf(current), 1, null); current = pages.find(Boolean); return null; }
    if (method === 'POST' && (tail === '/timeouts' || tail === '/window/rect')) return null;
    if (method === 'DELETE' && tail === '') { await context.close(); return null; }
    throw new Error(`L5_PW: no ${method} ${tail}`);
  }
  return { call, session: { sessionId: 'pw', capabilities: { 'safari:deviceName': 'Playwright WebKit (iPhone 15, Mac)', 'safari:platformVersion': 'dry run' } } };
}

/** Opens the session on the phone (or Safari on this Mac with L5_MAC=1) and returns the helpers bound to it. */
export async function connect({ url, out, port = Number(process.env.L5_PORT ?? 4454) }) {
  mkdirSync(out, { recursive: true });
  // Every WebDriver call, with its time and outcome, into L5_OUT/trace.log (L5_TRACE=1): where a run broke off.
  const trace = (line) => { if (process.env.L5_TRACE) appendFileSync(join(out, 'trace.log'), `${new Date().toISOString()} ${line}\n`); };
  const pw = process.env.L5_PW ? await playwright(out) : null;
  const driver = pw ? { kill: () => undefined } : spawn('safaridriver', ['-p', String(port)], { stdio: 'ignore' });
  if (!pw) await sleep(2000);
  async function call(method, path, body, ms = 330_000) {
    if (pw) return pw.call(method, path, body);
    const what = `${method} ${path.split('/').slice(3).join('/') || path}`, t = Date.now();
    let res;
    const send = () => fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
    try {
      // safaridriver drops a connection that idled while the Mac worked (ffprobe of a 4K file, ffmpeg making 200 MB):
      // the next request meets a dead socket and is reset at once, before the phone saw it. It is sent once more.
      res = await send().catch((e) => {
        if (Date.now() - t < 2000 && /ECONNRESET|EPIPE|UND_ERR_SOCKET|other side closed/.test(`${e.cause?.code} ${e.cause?.message}`)) { trace(`${what} reset at once, sent again`); return send(); }
        throw e;
      });
    } catch (e) {
      // undici's «fetch failed» hides its cause (a reset socket, a timeout): it goes into the words of the row.
      trace(`${what} ${Date.now() - t} ms FAILED ${e.cause?.code ?? e.cause?.message ?? e.message}`);
      throw new Error(`${e.message}${e.cause ? ` (${e.cause.code ?? e.cause.message})` : ''} on ${what} after ${Math.round((Date.now() - t) / 1000)} s`);
    }
    const json = await res.json();
    trace(`${what} ${Date.now() - t} ms${json.value?.error ? ` ${json.value.error}` : ''}`);
    if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
    return json.value;
  }
  const caps = process.env.L5_MAC ? { browserName: 'safari' } : { browserName: 'safari', platformName: 'ios', 'safari:useSimulator': false, ...(process.env.L5_UDID ? { 'safari:deviceUDID': process.env.L5_UDID } : { 'safari:deviceType': 'iPhone' }) };
  let session = pw ? pw.session : null;
  // After a session ends the phone refuses a new one for 20–60 s (reports/L5 — журнал.md): tries 20 s apart for 4 min.
  const until = Date.now() + 240_000;
  while (!session) {
    try { session = await call('POST', '/session', { capabilities: { alwaysMatch: caps } }, 90_000); } catch (e) {
      if (Date.now() > until) { driver.kill(); throw new Error(`no session: ${e.message}`); }
      console.log(`  (телефон не дал сессию: ${e.message.slice(0, 80)} — ещё раз через 20 с)`);
      await sleep(20_000);
    }
  }
  const S = `/session/${session.sessionId}`;
  await call('POST', `${S}/timeouts`, { script: 320_000 });
  // Safari on the Mac rehearses the phone in a narrow upright window: the editor's phone layout (as l5-sweep-u does).
  if (process.env.L5_MAC) await call('POST', `${S}/window/rect`, { width: 430, height: 900 }).catch(() => undefined);
  const js = (script, ...args) => call('POST', `${S}/execute/sync`, { script, args });
  const jsAsync = (script, ...args) => call('POST', `${S}/execute/async`, { script, args });
  const shot = async (name) => writeFileSync(join(out, `${name}.png`), Buffer.from(await call('GET', `${S}/screenshot`), 'base64'));
  async function waitFor(what, fn, ms) {
    const t = Date.now();
    for (;;) {
      const v = await fn().catch(() => null);
      if (v) return v;
      if (Date.now() - t > ms) throw new Error(`${what}: not within ${Math.round(ms / 1000)} s`);
      await sleep(250);
    }
  }
  const has = (names) => js(`${FIND} return !!el;`, [names].flat());
  /** Clicks a control by name once it is on screen. */
  const tap = (names, ms = 30_000) => waitFor(`"${[names].flat()[0]}"`, () => js(`${FIND} if (!el) return false; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.click(); return true;`, [names].flat()), ms);
  const checked = (names) => js(`${FIND} return !!el && (el.getAttribute('aria-checked') === 'true' || el.getAttribute('aria-pressed') === 'true' || el.checked === true);`, [names].flat());
  const count = (css) => js('return document.querySelectorAll(arguments[0]).length', css);
  const closeTools = () => js("const c = document.querySelector('[aria-label=\"Back: close tools\"],[aria-label=\"Назад: закрыть инструменты\"],[aria-label=\"Close tools\"],[aria-label=\"Закрыть инструменты\"]'); if (c) c.click();");
  /** A clip picked as a finger picks it: the timeline listens to pointer events, which click() alone does not send. */
  const selectClip = async (n = 0, row = 'main') => {
    await js(`const el = document.querySelectorAll('.tl-row.' + arguments[1] + ' .clip')[arguments[0]], r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', at)); el.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 })); el.click();`, n, row);
    await waitFor('the clip selected', () => js("return !!document.querySelector('.tl-row .clip.sel')"), 10_000);
  };
  /**
   * A tool of the toolbar by its label (the ribbon scrolls; a tool off screen is still clicked). The label is the tool's
   * first visible span: a tool that is on (Reverse, Voice, Hide faces…) carries a hidden «changed» after it.
   */
  const tool = (names, ms = 15_000) => waitFor(`tool "${[names].flat()[0]}"`, () => js(`const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => arguments[0].includes((e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? e.textContent).trim()));
    if (!t) return false; t.scrollIntoView({ inline: 'nearest', block: 'nearest' }); t.click(); return true;`, [names].flat()), ms);
  /** Whether a tool shows its «on» state (`data-on`, or `aria-pressed` for Cutout and Mirror). */
  const toolOn = (name) => js(`const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => (e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? e.textContent).trim() === arguments[0]);
    return !!t && (t.hasAttribute('data-on') || t.getAttribute('aria-pressed') === 'true');`, name);
  let lastId = '';
  /** The stored project of the open editor (IndexedDB `kadr`/`kv`, key `p:<id>`), as the app saved it. */
  const stored = () => jsAsync(`const done = arguments[arguments.length - 1]; const id = decodeURIComponent(location.hash.replace(/^#\\/p\\//, '')) || arguments[0];
    const o = indexedDB.open('kadr'); o.onerror = () => done(null);
    o.onsuccess = () => { try { const r = o.result.transaction('kv').objectStore('kv').get('p:' + id); r.onsuccess = () => { o.result.close(); done(r.result ?? null); }; r.onerror = () => { o.result.close(); done(null); }; } catch (e) { done(null); } };`, lastId);
  /** The timeline's length as Kadr computes it (core/timeline.ts projectDuration: the latest clip end of any track). */
  const timelineLength = async () => {
    const p = await stored();
    if (!p) return null;
    return Math.round(Math.max(0, ...p.tracks.flatMap((t) => t.clips.map((c) => c.start + c.duration))) * 1e6) / 1e6;
  };
  const idle = (ms) => waitFor('the job to end', () => js("return !document.querySelector('.busy')"), ms);
  /** The playhead to `s` seconds (60 px a second at the default zoom). */
  const seek = (s) => js("document.querySelector('.tl-scroll').scrollLeft = arguments[0]", s * 60);
  const usage = () => jsAsync('const done = arguments[arguments.length - 1]; navigator.storage.estimate().then((e) => done(e.usage), () => done(-1));');
  const watch = () => js(WATCH);
  /** What the page kept, read in one call: values that go together are never read across two requests. */
  const page = () => js(`const L = window.__l5; if (!L) return null;
    return { errors: L.errors.slice(), toasts: L.toasts.slice(), notes: L.notes.slice(), warns: L.warns.slice(-20), dec: { ...L.dec }, gl: { ...L.gl },
      clips: document.querySelectorAll('.tl-row.main .clip').length, drawn: window.__kadrPerf?.drawn ?? null, leases: window.__kadrPerf?.leases ?? null };`);

  /** A test file into the page, in 3 MB pieces: a fixture by name, or a file made on the Mac by its full path. */
  async function push(name) {
    const path = name.startsWith('/') ? name : fixture(name);
    const bytes = readFileSync(path);
    await js('window.__l5.parts = [];');
    for (let at = 0; at < bytes.length; at += CHUNK) {
      const ok = await jsAsync("const done = arguments[arguments.length - 1]; fetch('data:application/octet-stream;base64,' + arguments[0]).then((r) => r.arrayBuffer()).then((b) => { window.__l5.parts.push(b); done(true); }, (e) => done(String(e)));", bytes.subarray(at, at + CHUNK).toString('base64'));
      if (ok !== true) throw new Error(`push failed: ${ok}`);
    }
    const type = { '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.webm': 'video/webm', '.jpg': 'image/jpeg', '.png': 'image/png', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.kadr': 'application/zip' }[extname(path).toLowerCase()] ?? 'application/octet-stream';
    await js("window.__l5.files.push(new File(window.__l5.parts, arguments[0], { type: arguments[1] })); window.__l5.parts = [];", basename(path), type);
  }

  /** The site with the first-run tips and cards answered, the locale set; the page watched. */
  async function home({ ru = false } = {}) {
    await call('POST', `${S}/url`, { url });
    await js(`localStorage.setItem('kadr.tips','99');localStorage.setItem('kadr.locale',arguments[0]);localStorage.setItem('kadr.hint.move','1');localStorage.setItem('kadr.undoMoved.v1','1');localStorage.setItem('kadr.iosVideoTip.v3','1');localStorage.setItem('kadr.iosFormatCard.v1','1');localStorage.setItem('kadr.exportPrefs',JSON.stringify({quick:false}));`, ru ? 'ru' : 'en');
    await call('POST', `${S}/url`, { url });
    await waitFor('home', () => has(ru ? 'Новый проект' : 'New project'), 60_000);
    await watch();
  }
  /** A new project of the given frame with the files added through «Media», the editor settled. */
  async function fresh(files, { ru = false, aspect = '9:16', keepPage = false } = {}) {
    // keepPage: the next project in the same page, home the app's own way (a defect that piles up across exports in one
    // page, as V-190's GPU memory did, is gone with every new document).
    if (keepPage) { await leave(); await waitFor('home', () => has(ru ? 'Новый проект' : 'New project'), 30_000); } else await home({ ru });
    await tap(ru ? 'Новый проект' : 'New project', 60_000);
    // Only a card on screen: a sheet's cards can be in the page while it is closed. A tap that came while the page was
    // still starting did not open the sheet, so «New project» is pressed again.
    await waitFor('aspect', () => js(`const c = [...document.querySelectorAll('.aspect-card')].find((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0 && e.textContent.includes(arguments[0]));
      if (c) { c.click(); return true; }
      const again = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && arguments[1].includes(e.textContent.trim()));
      if (again) again.click();
      return false;`, aspect, ['New project', 'Новый проект']), 20_000);
    await waitFor('editor', () => js("return !!document.querySelector('.preview-canvas')"), 30_000);
    await watch();
    await projectId();
    if (!files.length) return;
    for (const f of files) await push(f);
    await tap(ru ? 'Медиа' : 'Media');
    await waitFor('clips', async () => (await count('.tl-row.main .clip')) >= 1, 180_000);
    await closeTools();
    await settled();
  }
  /** The site's storage stops growing: the added files and the project are saved. */
  async function settled() {
    let last = -2;
    for (let t = Date.now(); Date.now() - t < 30_000; await sleep(2000)) {
      const now = await usage();
      if (now === last) return;
      last = now;
    }
  }
  /** The project's id from the address (`#/p/<id>`). */
  const projectId = async () => (lastId = await js("return decodeURIComponent(location.hash.replace(/^#\\/p\\//, ''))"));
  /** Back to the home screen the app's own way, once its save has landed (a new document mid-save locked storage, D-14). */
  async function leave() {
    await sleep(1500);
    await js("location.hash = ''").catch(() => undefined);
    await sleep(800);
  }
  /** Every project deleted from the home screen: nothing of the test stays on the phone (L5_KEEP=1 keeps them). */
  async function cleanup() {
    await leave();
    for (let i = 0; i < 20 && !process.env.L5_KEEP; i++) {
      const asked = await js("const d = [...document.querySelectorAll('button')].find((b) => /^(Delete|Удалить) /.test(b.getAttribute('aria-label') || '')); if (!d) return false; d.click(); return true;").catch(() => false);
      if (!asked) break;
      await sleep(400);
      await js("const c = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && ['Delete', 'Удалить'].includes(b.textContent.trim())); if (c) c.click();").catch(() => undefined);
      await sleep(1200);
    }
  }

  /** A switch row of a sheet (`label.ck-switch-row`: its words and a note under them) set on or off. */
  const setSwitch = (words, on) => js(`const row = [...document.querySelectorAll('label.ck-switch-row')].find((l) => l.offsetParent !== null && l.textContent.trim().startsWith(arguments[0]));
    const i = row && row.querySelector('input'); if (!i) return null; if (i.checked !== arguments[1]) i.click(); return i.checked;`, words, on);
  /**
   * An export through the sheet (the editor's «Export» opens it: `kadr.exportPrefs.quick` is off). Options: format
   * (Video, Photo, GIF, Audio), preset («TikTok, Reels, Shorts», «Best quality», «Small file»), size (720p … 4K),
   * fps, loud (Even loudness on or off). Returns the «Ready» line, the milliseconds from the tap to it, and the file
   * pulled to the Mac when `file` is given.
   */
  async function exportAs({ format = 'Video', preset, size, fps, loud, file, ms = 600_000 } = {}) {
    await tap(['Export', 'Экспорт']);
    await tap(format);
    await waitFor('the sizes the encoder takes', () => js("return !document.body.innerText.includes('Checking what this device can encode')"), 30_000);
    if (preset) await tap(preset);
    if (size) await tap(size);
    if (fps) await tap(String(fps));
    if (loud !== undefined && (await setSwitch('Even loudness', loud)) !== loud) throw new Error('the «Even loudness» switch did not take');
    const button = { Video: 'Export video', Photo: 'Save photo', GIF: 'Export GIF', Audio: 'Export audio' }[format];
    const t = Date.now();
    await tap(button);
    // «Ready: 7.4 MB in 2 s» (`.ck-work-ready`; the body's words as l5-tools reads them on the phone), or the failure.
    const ready = await waitFor('"Ready"', () => js("const r = document.querySelector('.ck-work-ready')?.textContent; if (r) return r; const b = document.body.innerText; return /(Ready|Готово): [^\\n]* (MB|МБ)/.exec(b)?.[0] ?? /Export failed[^\\n]*/.exec(b)?.[0] ?? null;"), ms).catch(async (e) => {
      const now = await js("return document.querySelector('.ck-work-now')?.textContent ?? ''").catch(() => '');
      throw new Error(`${e.message}${now ? ` (на экране: ${now})` : ''}`);
    });
    if (ready.startsWith('Export failed')) {
      // «Something went wrong» says nothing: the sheet's «Details» and Kadr's own error log (lib/errorLog) say what failed.
      const details = await js("const d = document.querySelector('details.error-more'); if (!d) return ''; d.open = true; return d.textContent.replace(/\\s+/g, ' ').trim().slice(0, 500);").catch(() => '');
      const log = await jsAsync(`const done = arguments[arguments.length - 1]; const o = indexedDB.open('kadr-log');
        o.onsuccess = () => { try { const r = o.result.transaction('log').objectStore('log').getAll(); r.onsuccess = () => done(JSON.stringify(r.result.slice(-1)).slice(0, 700)); r.onerror = () => done(''); } catch (e) { done(''); } };
        o.onerror = () => done('');`).catch(() => '');
      await shot(`export-failed-${Date.now()}`).catch(() => undefined);
      throw new Error(`${ready}${details ? ` | ${details}` : ''}${log ? ` | log ${log}` : ''}`);
    }
    const took = Date.now() - t;
    await tap(['Save / Share', 'Save', 'Сохранить / Поделиться', 'Сохранить'], 10_000).catch(() => undefined);
    const pulled = file ? await pull(file) : null;
    await tap(['Done', 'Готово'], 5000).catch(() => undefined);
    await sleep(500);
    return { ready, ms: took, file: pulled };
  }
  /** The file the last export or backup saved, brought to the Mac in pieces (an export of hundreds of MB fits no single reply). */
  async function pull(name, ms = 60_000) {
    await waitFor('the saved file', () => js('return !!window.__l5.blob'), ms);
    const size = await js('return window.__l5.blob.size');
    const parts = [];
    for (let at = 0; at < size; at += CHUNK) {
      const b64 = await jsAsync(`const done = arguments[arguments.length - 1]; const r = new FileReader();
        r.onload = () => done(r.result.split(',')[1] ?? ''); r.onerror = () => done(null); r.readAsDataURL(window.__l5.blob.slice(arguments[0], arguments[1]));`, at, at + CHUNK);
      if (b64 === null) throw new Error('the file could not be read');
      parts.push(Buffer.from(b64, 'base64'));
    }
    await js('window.__l5.blob = null;');
    const file = join(out, name);
    writeFileSync(file, Buffer.concat(parts));
    return file;
  }
  /** The preview holds the exact frame at `t` s: the playhead moved there and the decoder answered. */
  async function exactAt(t) {
    await seek(t);
    await waitFor(`the exact frame at ${t} s`, () => js('const l = window.__kadrPerf?.last; return !!l && l.exact && Math.abs(l.t - arguments[0]) < 0.05;', t), 30_000);
    await sleep(600);
  }
  /** A button (by aria-label) on screen and not disabled: the recorders' Start waits for the device. */
  const enabled = (name, ms) => waitFor(`"${name}" ready`, () => js("const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.getAttribute('aria-label') === arguments[0]); return !!b && !b.disabled;", name), ms);
  /** Opens the first project of the home screen; the preview has drawn when its count of frames grows past what it was. */
  async function openFirst() {
    const before = await waitFor('a project on the home screen', () => js("const b = document.querySelector('.project-open'); if (!b) return false; const n = window.__kadrPerf?.drawn ?? 0; b.click(); return { n };"), 20_000);
    await waitFor('the preview draws', () => js("return !!document.querySelector('.preview-canvas') && (window.__kadrPerf?.drawn ?? 0) > arguments[0]", before.n), 30_000);
    await watch();
    await projectId();
  }
  /** A stored media file as Kadr keeps it (a whole Blob `b:<id>`, or chunks `c:<id>:<i>`), brought to the Mac. */
  async function pullAsset(assetId, name) {
    const got = await jsAsync(`const done = arguments[arguments.length - 1], id = arguments[0];
      const o = indexedDB.open('kadr'); o.onerror = () => done('no db');
      o.onsuccess = () => { const s = () => o.result.transaction('kv').objectStore('kv');
        const ask = (key) => new Promise((ok, ko) => { const r = s().get(key); r.onsuccess = () => ok(r.result); r.onerror = () => ko(r.error); });
        (async () => { const whole = await ask('b:' + id); if (whole) return whole;
          const meta = await ask('c:' + id); if (!meta) throw new Error('no record of ' + id);
          const parts = []; for (let i = 0; i < meta.chunks; i++) parts.push(await ask('c:' + id + ':' + i)); return new Blob(parts, { type: meta.type }); })()
          .then((b) => { o.result.close(); window.__l5.blob = b; done(b.size); }, (e) => { o.result.close(); done(String(e)); }); };`, assetId);
    if (typeof got !== 'number') throw new Error(`the stored file ${assetId} could not be read: ${got}`);
    return pull(name);
  }
  /** The preview canvas as the phone shows it (PNG bytes). */
  async function previewShot(name) {
    const el = await call('POST', `${S}/element`, { using: 'css selector', value: '.preview-canvas' });
    const png = Buffer.from(await call('GET', `${S}/element/${Object.values(el)[0]}/screenshot`), 'base64');
    if (name) writeFileSync(join(out, `${name}.png`), png);
    return png;
  }
  async function close() {
    await call('DELETE', S).catch(() => undefined);
    driver.kill();
  }
  return { url, out, session, S, call, js, jsAsync, shot, waitFor, has, tap, checked, count, closeTools, selectClip, tool, idle, seek, usage, watch, page, push, home, fresh, settled, projectId, leave, cleanup, setSwitch, exportAs, pull, pullAsset, previewShot, close, toolOn, stored, timelineLength, exactAt, enabled, openFirst };
}

// ---------- on the Mac ----------
/** A test file made with ffmpeg into the output folder. */
export function make(out, name, args) {
  const file = resolve(out, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, file]);
  return file;
}
/** ffprobe of a file the phone made, as the facts a row checks. */
export function probe(file) {
  return probeSummary(JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,profile,width,height,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' })));
}
/** ffmpeg's words on stderr (filters that print and output nothing). */
const ffmpegSays = (args) => spawnSync('ffmpeg', ['-hide_banner', ...args, '-f', 'null', '-'], { encoding: 'utf8', maxBuffer: 256 << 20 }).stderr;
/** White frames and beeps of an avsync export (e2e/qa-media-reverse-sync.spec.ts `measure`). */
export const avSync = (file) => avOffsets(
  ffmpegSays(['-i', file, '-vf', 'signalstats,metadata=print:key=lavfi.signalstats.YAVG', '-an']),
  ffmpegSays(['-i', file, '-af', 'silencedetect=noise=-40dB:d=0.1', '-vn']));
/** AAC packets of a file but the last that are not 1024 samples. */
export function packets(file) {
  const ask = (entries) => execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', entries, '-of', 'csv=p=0', file], { encoding: 'utf8', maxBuffer: 64 << 20 }).trim();
  const codec = ask('stream=codec_name');
  return { codec, broken: codec === 'aac' ? brokenPackets(ask('packet=pts,duration'), Number(ask('stream=sample_rate'))) : [`codec ${codec}`] };
}
/** Integrated loudness, sample and true peak of a file. */
export const loudness = (file) => parseEbur128(ffmpegSays(['-nostats', '-i', file, '-filter_complex', 'ebur128=peak=sample+true:framelog=quiet']));
/** Mean and max volume of a file's sound. */
export const volume = (file, from = []) => parseVolume(ffmpegSays([...from, '-i', file, '-af', 'volumedetect', '-vn']));
/** Mono 48 kHz samples of a file's sound. */
export function samples(file) {
  const b = execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'], { maxBuffer: 512 << 20 });
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
}
/** The levels and steps at the 2 s joins of an export's sound (V-153). */
export const joinsOf = (file) => joins(samples(file));
/** RGB 135×240 of a picture (a file, or PNG bytes), or of a video's frame number `n` (e2e/qa-video-kit.ts `rgbAt`). */
export function rgb(src, n) {
  const pick = n === undefined ? '' : `select=eq(n\\,${n}),`;
  const input = Buffer.isBuffer(src) ? 'pipe:0' : src;
  return execFileSync('ffmpeg', ['-v', 'error', '-i', input, '-vf', `${pick}scale=135:240`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], Buffer.isBuffer(src) ? { input: src } : {});
}
/** Mean luma (0–255) of a picture's middle half (PNG bytes or a file). */
export function luma(src, from = []) {
  const input = Buffer.isBuffer(src) ? 'pipe:0' : src;
  const raw = execFileSync('ffmpeg', ['-v', 'error', ...from, '-i', input, '-frames:v', '1', '-vf', 'crop=iw/2:ih/2,scale=64:64,format=gray', '-f', 'rawvideo', '-'], Buffer.isBuffer(src) ? { input: src } : {});
  let s = 0;
  for (const v of raw) s += v;
  return s / raw.length;
}
