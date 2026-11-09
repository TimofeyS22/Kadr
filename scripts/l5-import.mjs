// How long Kadr itself takes to add a phone video on a real iPhone (docs/16 N5), apart from the iPhone's own picker:
// the file is pushed into the page over WebDriver and handed to Kadr's file input, so the system picker (and the
// re-encoding iOS does inside it) is not in the measurement. The journal says so.
//   node scripts/l5-import.mjs <video file> [more files]     Env: L5_URL (site), L5_UDID
import { spawn } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { basename, extname } from 'node:path';

const files = process.argv.slice(2);
if (!files.length) { console.error('usage: node scripts/l5-import.mjs <video file> [more files]'); process.exit(2); }
const URL_ = process.env.L5_URL ?? 'https://timofeys22.github.io/Kadr/';
const PORT = 4449;
const CHUNK = 3 * 2 ** 20; // a multiple of 3: base64 pieces join without padding in between

const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
async function call(method, path, body, ms = 180_000) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}
const caps = { browserName: 'safari', platformName: 'ios', 'safari:useSimulator': false, ...(process.env.L5_UDID ? { 'safari:deviceUDID': process.env.L5_UDID } : { 'safari:deviceType': 'iPhone' }) };
let session;
for (let attempt = 1; !session; attempt++) {
  try { session = await call('POST', '/session', { capabilities: { alwaysMatch: caps } }); } catch (e) {
    if (attempt === 5) { driver.kill(); console.error(`L5: no session: ${e.message}`); process.exit(2); }
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const S = `/session/${session.sessionId}`;
await call('POST', `${S}/timeouts`, { script: 170_000 });
const js = (script, ...args) => call('POST', `${S}/execute/sync`, { script, args });
const jsAsync = (script, ...args) => call('POST', `${S}/execute/async`, { script, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(what, fn, ms) {
  const t = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`${what}: not within ${ms} ms`);
    await sleep(200);
  }
}
const click = (name) => js("const n = arguments[0]; const b = [...document.querySelectorAll('button,[role=radio]')].find((e) => e.offsetParent !== null && (e.getAttribute('aria-label') || e.textContent).trim() === n); if (!b) return false; b.click(); return true;", name);

/** In the page: storage writes timed, the file input answered with the pushed file, the moment a clip appears. */
const WATCH = `window.__imp = { parts: [], file: null, t: {}, puts: [], errors: [] };
  addEventListener('error', (e) => window.__imp.errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__imp.errors.push(String(e.reason)));
  new MutationObserver(() => {
    const m = window.__imp; if (!m.t.click) return;
    document.querySelectorAll('.toast.error').forEach((el) => { if (!m.errors.includes(el.textContent)) m.errors.push(el.textContent); });
    if (!m.t.busy && document.querySelector('.busy')) m.t.busy = performance.now() - m.t.click;
    if (!m.t.clip && document.querySelector('.tl-row.main .clip')) m.t.clip = performance.now() - m.t.click;
  }).observe(document, { subtree: true, childList: true });
  const put = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (value, key) {
    const r = put.apply(this, arguments);
    if (/^[bc]:/.test(String(key)) && (value instanceof Blob || value instanceof ArrayBuffer)) {
      const at = performance.now(), rec = { key: String(key).slice(0, 2), mb: Math.round((value.size ?? value.byteLength) / 1e5) / 10, ms: null };
      window.__imp.puts.push(rec);
      r.addEventListener('success', () => { rec.ms = Math.round(performance.now() - at); });
      r.addEventListener('error', () => { rec.ms = -1; rec.error = String(r.error); });
    }
    return r;
  };
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file' || !window.__imp.file) return click.call(this);
    const dt = new DataTransfer(); dt.items.add(window.__imp.file); this.files = dt.files;
    window.__imp.t.click = performance.now();
    this.dispatchEvent(new Event('change'));
  };`;

const results = [];
try {
  await call('POST', `${S}/url`, { url: URL_ });
  await js("localStorage.setItem('kadr.tips','99');localStorage.setItem('kadr.iosFormatCard.v1','1');localStorage.setItem('kadr.locale','en');localStorage.setItem('kadr.hint.move','1');localStorage.setItem('kadr.iosVideoTip.v3','1');");
  for (const path of files) {
    const size = statSync(path).size, name = basename(path);
    const row = { file: name, mb: Math.round(size / 1e5) / 10 };
    results.push(row);
    try {
      await call('POST', `${S}/url`, { url: URL_ });
      await waitFor('home', () => click('New project'), 60_000);
      await waitFor('aspect', () => js("const c = [...document.querySelectorAll('.aspect-card')].find((e) => e.textContent.includes('9:16')); if (!c) return false; c.click(); return true;"), 20_000);
      await waitFor('editor', () => js("return !!document.querySelector('.preview-canvas')"), 30_000);
      row.version = await js("return document.title") ;
      await js(WATCH);
      const bytes = readFileSync(path);
      const pushed = Date.now();
      for (let at = 0; at < size; at += CHUNK) {
        const ok = await jsAsync("const done = arguments[arguments.length - 1]; fetch('data:application/octet-stream;base64,' + arguments[0]).then((r) => r.arrayBuffer()).then((b) => { window.__imp.parts.push(b); done(true); }, (e) => done(String(e)));", bytes.subarray(at, at + CHUNK).toString('base64'));
        if (ok !== true) throw new Error(`push failed: ${ok}`);
      }
      row.pushS = Math.round((Date.now() - pushed) / 100) / 10;
      const type = { '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.m4v': 'video/mp4' }[extname(name).toLowerCase()] ?? 'video/mp4';
      await js("const m = window.__imp; m.file = new File(m.parts, arguments[0], { type: arguments[1], lastModified: Date.now() }); m.parts = []; return m.file.size;", name, type);
      await js("const c = document.querySelector('[aria-label=\"Close tools\"]'); if (c) c.click();");
      if (!(await click('Media'))) throw new Error('no Media button');
      const done = await waitFor('a clip or an error', () => js("const m = window.__imp; return m.t.clip || m.errors.length ? { t: m.t, errors: m.errors } : null;"), 170_000);
      if (done.errors.length) throw new Error(done.errors.join(' | ').slice(0, 300));
      row.busyMs = Math.round(done.t.busy ?? 0);
      row.clipMs = Math.round(done.t.clip);
      // Thumbnails and the waveform come after the clip; the person can already work.
      const marks = await waitFor('thumbnails', () => js("const k = window.__kadrPerf?.marks ?? {}; const th = Object.keys(k).find((x) => x.startsWith('thumbs:')); return th ? { thumbs: k[th], wave: k[Object.keys(k).find((x) => x.startsWith('wave:'))] ?? null, start: k['import:start'] ?? null } : null;"), 120_000).catch(() => null);
      if (marks) { row.thumbsMs = marks.start != null ? Math.round(marks.thumbs - marks.start) : null; row.waveMs = marks.wave != null && marks.start != null ? Math.round(marks.wave - marks.start) : null; }
      await sleep(1500);
      const end = await js("return { puts: window.__imp.puts, errors: window.__imp.errors }");
      row.stored = end.puts.length ? `${end.puts[0].key === 'b:' ? 'whole Blob' : `${end.puts.length} chunks`}, ${end.puts.reduce((a, p) => a + (p.ms ?? 0), 0)} ms` : 'nothing written yet';
      if (end.errors.length) row.errors = end.errors;
      // The person leaves and comes back: how long until the clip is there again.
      await sleep(1200);
      const back = Date.now();
      await call('POST', `${S}/url`, { url: URL_ });
      await waitFor('the project in the list', () => js("const p = document.querySelector('.project-open'); if (!p) return false; p.click(); return true;"), 30_000);
      await waitFor('the clip again', () => js("return !!document.querySelector('.tl-row.main .clip')"), 120_000);
      row.reopenMs = Date.now() - back;
      // Nothing of the test stays on the phone.
      await call('POST', `${S}/url`, { url: URL_ });
      await waitFor('home again', () => js("return !!document.querySelector('.project-open')"), 30_000);
      await js("window.confirm = () => true; const d = [...document.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || '').startsWith('Delete ')); if (d) d.click();");
      await sleep(1500);
    } catch (e) {
      row.error = e.message;
    }
    console.log(JSON.stringify(row));
  }
} finally {
  await call('DELETE', S).catch(() => undefined);
  driver.kill();
}
process.exit(results.some((r) => r.error) ? 1 : 0);
