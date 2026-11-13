// Every tool once on a real iPhone (docs/16 §4, L5-авто): a fresh project per scenario, a test file pushed into the page
// instead of the Photos picker, taps as click() in the page (safaridriver's touches arrive as long presses). Records
// time, page errors, error toasts and whether the tab died. Nothing of the test stays on the phone.
//   node scripts/l5-tools.mjs [scenario ...]      Env: L5_URL (site), L5_UDID, L5_OUT (screenshots)
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

const URL_ = process.env.L5_URL ?? 'https://timofeys22.github.io/Kadr/';
const OUT = process.env.L5_OUT ?? join(process.env.TMPDIR ?? '/tmp', 'kadr-l5-tools');
mkdirSync(OUT, { recursive: true });
const fx = (n) => join(import.meta.dirname, '..', 'fixtures', n);
const PORT = Number(process.env.L5_PORT ?? 4450); // another port for a second driver (a dry run in Safari on the Mac while the phone is busy)
const CHUNK = 3 * 2 ** 20;

const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
async function call(method, path, body, ms = 330_000) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}
// L5_MAC: Safari on this Mac (the same engine and its back-forward cache, for a build that is not published yet).
const caps = process.env.L5_MAC ? { browserName: 'safari' } : { browserName: 'safari', platformName: 'ios', 'safari:useSimulator': false, ...(process.env.L5_UDID ? { 'safari:deviceUDID': process.env.L5_UDID } : { 'safari:deviceType': 'iPhone' }) };
let session;
for (let attempt = 1; !session; attempt++) {
  try { session = await call('POST', '/session', { capabilities: { alwaysMatch: caps } }); } catch (e) {
    if (attempt === 5) { driver.kill(); console.error(`L5: no session: ${e.message}`); process.exit(2); }
    await new Promise((r) => setTimeout(r, 4000));
  }
}
const S = `/session/${session.sessionId}`;
await call('POST', `${S}/timeouts`, { script: 320_000 });
const js = (script, ...args) => call('POST', `${S}/execute/sync`, { script, args });
const jsAsync = (script, ...args) => call('POST', `${S}/execute/async`, { script, args });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const shot = async (name) => writeFileSync(join(OUT, `${name}.png`), Buffer.from(await call('GET', `${S}/screenshot`), 'base64'));
async function waitFor(what, fn, ms) {
  const t = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`${what}: not within ${Math.round(ms / 1000)} s`);
    await sleep(300);
  }
}
/** A button, radio or switch by its accessible name (any of the names, for two languages); clicked in the page. */
const FIND = `const names = arguments[0];
  // A button's own words: the line of facts under a big button (Chetko export sheet, v1.9.0) is not its name.
  const own = (e) => { const c = e.cloneNode(true); c.querySelectorAll('.ck-btn-sub').forEach((x) => x.remove()); return c.textContent; };
  const named = (e) => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ').map((id) => document.getElementById(id)?.textContent ?? '').join(' ').trim() || e.closest('label')?.textContent || own(e)).trim();
  return [...document.querySelectorAll('button,[role=radio],[role=switch],[role=tab]')].find((e) => e.offsetParent !== null && names.includes(named(e))) || null;`;
const tap = async (names, ms = 30_000) => {
  const list = [names].flat();
  await waitFor(`"${list[0]}"`, () => js(`${FIND.replace('return [', 'const el = [')} if (!el) return false; el.scrollIntoView({ block: 'nearest' }); el.click(); return true;`, list), ms);
};
const checked = (names, ms) => waitFor(`"${[names].flat()[0]}" on`, () => js(`${FIND.replace('return [', 'const el = [')} return !!el && (el.getAttribute('aria-checked') === 'true' || el.checked === true);`, [names].flat()), ms);
const count = (css) => js('return document.querySelectorAll(arguments[0]).length', css);
// 'Back: close tools' since Chetko Ч4 release 3 (v1.8.1), 'Close tools' before it.
const closeTools = () => js("const c = document.querySelector('[aria-label=\"Back: close tools\"],[aria-label=\"Назад: закрыть инструменты\"],[aria-label=\"Close tools\"],[aria-label=\"Закрыть инструменты\"]'); if (c) c.click();");
const selectClip = async (n = 0) => {
  await js(`const el = document.querySelectorAll('.tl-row.main .clip')[arguments[0]], r = el.getBoundingClientRect();
    const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
    el.dispatchEvent(new PointerEvent('pointerdown', at)); el.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 })); el.click();`, n);
  await waitFor('the clip selected', () => js("return !!document.querySelector('.tl-row.main .clip.sel')"), 10_000);
};
const idle = (ms) => waitFor('the job to end', () => js("return !document.querySelector('.busy')"), ms);

/** Watches the page: errors, error toasts, a marker that a reload (a crashed tab) wipes, the file input answered with pushed files. */
const WATCH = `if (!window.__l5) {
  window.__l5 = { errors: [], toasts: [], files: [], parts: [], warns: [] };
  // What the app warns of, with the error's name, words and stack: the only trace of a failure on the phone.
  const warn = console.warn;
  // Which part fails: a read of a stored file, or the device's decoder (S-1-13). Each failure with what it was reading.
  window.__l5.diag = [];
  // A Blob made in memory, belonging to no storage: if it dies too, WebKit's network process (which holds every Blob
  // of the page) was restarted, not one stored file lost (WebKit bug 230861).
  window.__l5.canary = new Blob([new Uint8Array(1 << 20).fill(7)]);
  const note = (x) => { if (window.__l5.diag.length < 40) window.__l5.diag.push(String(x).slice(0, 300)); };
  // Where each Blob came from: the IndexedDB key it was read under; a slice keeps its parent's tag.
  const tags = new WeakMap();
  const at = () => Math.round(performance.now());
  const get = IDBObjectStore.prototype.get;
  IDBObjectStore.prototype.get = function (key) { const req = get.call(this, key); req.addEventListener('success', () => { const r = req.result; if (r instanceof Blob) tags.set(r, String(key).slice(0, 24) + ' size=' + r.size + ' got@' + at()); }); return req; };
  const del = IDBObjectStore.prototype.delete;
  window.__l5.kept = 0;
  // S1_KEEP_PIECES (set below by the runner): the take's pieces are not deleted — does the error go away?
  IDBObjectStore.prototype.delete = function (key) { if (window.__l5.keepPieces && String(key).startsWith('t:')) { window.__l5.kept++; return { onsuccess: null, onerror: null, addEventListener() {} }; } return del.call(this, key); };
  const slice = Blob.prototype.slice;
  Blob.prototype.slice = function (...a) { const s = slice.apply(this, a); tags.set(s, tags.get(this) || ('memory size=' + this.size)); return s; };
  const ab = Blob.prototype.arrayBuffer;
  // How long a stored file stays unreadable (S-1-13): from its first failed read, a fresh read of its record every
  // 250 ms until one reads, for 30 s at most. The door's own new leases wait 50 and 250 ms.
  window.__l5.revive = {};
  const probe = (key) => {
    if (!key.startsWith('b:') || window.__l5.revive[key]) return;
    const t0 = at();
    window.__l5.revive[key] = 'dead';
    const tick = () => { const o = indexedDB.open('kadr'); o.onsuccess = () => { try { const r = o.result.transaction('kv').objectStore('kv').get(key);
      r.onsuccess = () => { o.result.close(); const b = r.result; if (!(b instanceof Blob)) { window.__l5.revive[key] = 'gone after ' + (at() - t0) + ' ms'; return; }
        ab.call(slice.call(b, 0, 8)).then(() => { window.__l5.revive[key] = 'readable after ' + (at() - t0) + ' ms'; }, () => { if (at() - t0 < 30000) setTimeout(tick, 250); else window.__l5.revive[key] = 'dead after 30 s'; }); };
      } catch (e) { o.result.close(); window.__l5.revive[key] = 'probe ' + e.name; } }; };
    tick();
  };
  Blob.prototype.arrayBuffer = function () { const b = this; return ab.call(b).catch((e) => { const tag = tags.get(b); note('read ' + e.name + ' of ' + (tag || 'untagged size=' + b.size) + ' @' + at()); if (tag) probe(tag.split(' ')[0]); throw e; }); };
  if (window.VideoDecoder) {
    const VD = window.VideoDecoder;
    window.VideoDecoder = class extends VD {
      constructor(init) { super({ ...init, error: (e) => { note('decoder ' + e.name + ' ' + e.message + ' at ' + Math.round(performance.now())); init.error(e); } }); }
      decode(c) { try { return super.decode(c); } catch (e) { note('decode() threw ' + e.name + ' ' + e.message); throw e; } }
      configure(c) { try { return super.configure(c); } catch (e) { note('configure() threw ' + e.name + ' ' + e.message + ' ' + c.codec); throw e; } }
    };
  }
  console.warn = function (...a) { try { window.__l5.warns.push(a.map((x) => x instanceof Error || (x && x.name && x.message) ? x.name + ': ' + x.message + ' @ ' + String(x.stack || '').slice(0, 600) : String(x)).join(' ').slice(0, 900)); } catch {} return warn.apply(this, a); };
  addEventListener('error', (e) => window.__l5.errors.push(String(e.message).slice(0, 200)));
  addEventListener('unhandledrejection', (e) => window.__l5.errors.push(String(e.reason && (e.reason.message || e.reason)).slice(0, 200)));
  new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => { const t = el.textContent.slice(0, 200); if (!window.__l5.toasts.includes(t)) window.__l5.toasts.push(t); })).observe(document, { subtree: true, childList: true });
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  const aclick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download && this.href.startsWith('blob:')) { window.__l5.saved = this.download; fetch(this.href).then((r) => r.blob()).then((b) => { window.__l5.blob = b; }); return; } return aclick.call(this); };
  const click = HTMLInputElement.prototype.click;
  HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file' || !window.__l5.files.length) return click.call(this);
    const dt = new DataTransfer(); for (const f of window.__l5.files) dt.items.add(f); this.files = dt.files; window.__l5.files = [];
    this.dispatchEvent(new Event('change'));
  };
}`;
/** A test file: a fixture by name, or a file made here by its full path. */
async function push(name) {
  const path = name.startsWith('/') ? name : fx(name);
  name = basename(path);
  const bytes = readFileSync(path);
  await js('window.__l5.parts = [];');
  for (let at = 0; at < bytes.length; at += CHUNK) {
    const ok = await jsAsync("const done = arguments[arguments.length - 1]; fetch('data:application/octet-stream;base64,' + arguments[0]).then((r) => r.arrayBuffer()).then((b) => { window.__l5.parts.push(b); done(true); }, (e) => done(String(e)));", bytes.subarray(at, at + CHUNK).toString('base64'));
    if (ok !== true) throw new Error(`push failed: ${ok}`);
  }
  const type = { '.mov': 'video/quicktime', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.m4a': 'audio/mp4', '.kadr': 'application/zip' }[extname(name).toLowerCase()];
  await js("window.__l5.files.push(new File(window.__l5.parts, arguments[0], { type: arguments[1] })); window.__l5.parts = [];", name, type);
}
const RU = { 'New project': 'Новый проект', Media: 'Медиа' };
async function fresh(files, { ru = false, aspect = '9:16' } = {}) {
  await call('POST', `${S}/url`, { url: URL_ });
  await js(`localStorage.setItem('kadr.tips','99');localStorage.setItem('kadr.locale',arguments[0]);localStorage.setItem('kadr.hint.move','1');localStorage.setItem('kadr.iosVideoTip.v3','1');localStorage.setItem('kadr.iosFormatCard.v1','1');localStorage.setItem('kadr.exportPrefs',JSON.stringify({quick:false}));`, ru ? 'ru' : 'en');
  await call('POST', `${S}/url`, { url: URL_ });
  await tap(ru ? RU['New project'] : 'New project', 60_000);
  // Only a card on screen: the sheet's cards can be in the page while it is closed, and a click there does nothing. When
  // the sheet did not open (a tap that came while the page was still starting), "New project" is pressed again.
  await waitFor('aspect', () => js(`const c = [...document.querySelectorAll('.aspect-card')].find((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0 && e.textContent.includes(arguments[0]));
    if (c) { c.click(); return true; }
    const again = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && arguments[1].includes(e.textContent.trim()));
    if (again) again.click();
    return false;`, aspect, ['New project', RU['New project']]), 20_000);
  await waitFor('editor', () => js("return !!document.querySelector('.preview-canvas')"), 30_000);
  await js(WATCH);
  for (const f of files) await push(f);
  if (files.length) {
    await tap(ru ? RU.Media : 'Media');
    await waitFor('clips', async () => (await count('.tl-row.main .clip')) >= 1, 120_000);
    await closeTools();
    await settled();
  }
}
/** The site's storage stops growing: the added files and the project are saved (so a later growth is something else). */
async function settled() {
  let last = -2;
  for (let t = Date.now(); Date.now() - t < 30_000; await sleep(2000)) {
    const now = await usage();
    if (now === last) return;
    last = now;
  }
}
async function exportAs(format, button, preset) {
  await tap(['Export', 'Экспорт']);
  await tap(format);
  if (preset) await tap(preset);
  await tap(button);
  const ready = await waitFor('"Ready"', () => js("const m = document.body.innerText.match(/(Ready|Готово): [^\\n]* (MB|МБ)/); return m && m[0];"), 300_000);
  await tap(['Save / Share', 'Save', 'Сохранить / Поделиться', 'Сохранить']).catch(() => undefined);
  await sleep(500);
  await tap(['Done', 'Готово']).catch(() => undefined);
  return ready;
}

/** The file the last export saved, brought to the Mac (the bytes, as the phone made them). */
async function pull(name) {
  await waitFor('the saved file', () => js('return !!window.__l5.blob'), 15_000);
  const b64 = await jsAsync(`const done = arguments[arguments.length - 1];
    const r = new FileReader(); r.onload = () => done(r.result.split(',')[1]); r.onerror = () => done(null); r.readAsDataURL(window.__l5.blob);`);
  if (!b64) throw new Error('the file could not be read');
  await js('window.__l5.blob = null;');
  const file = join(OUT, name);
  writeFileSync(file, Buffer.from(b64, 'base64'));
  return file;
}
const probe = (file) => {
  const p = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-show_entries', 'stream=codec_type,codec_name,width,height,nb_read_frames:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
  const v = p.streams.find((s) => s.codec_type === 'video');
  const duration = Number(p.format.duration), frames = Number(v?.nb_read_frames);
  return { codec: v?.codec_name, width: v?.width, height: v?.height, frames, duration, fps: Math.round((frames / duration) * 10) / 10, audio: p.streams.some((s) => s.codec_type === 'audio') };
};
/** Mean colour of four bands across the middle rows (as e2e/qa-color-601 measures them). */
const bands = (args, input) => {
  const raw = execFileSync('ffmpeg', ['-v', 'error', ...args, '-frames:v', '1', '-vf', 'format=rgb24,crop=iw:ih*0.5:0:ih*0.25,scale=4:1:flags=area', '-f', 'rawvideo', '-'], { input });
  return [0, 1, 2, 3].map((i) => [...raw.subarray(i * 3, i * 3 + 3)]);
};
const off = (a, b) => Math.max(...a.flatMap((c, i) => c.map((v, k) => Math.abs(v - b[i][k]))));
/** The playhead to `s` seconds (60 px a second at the default zoom). */
const seek = (s) => js("document.querySelector('.tl-scroll').scrollLeft = arguments[0]", s * 60);
/** The preview canvas as the phone shows it. */
async function previewShot() {
  const el = await call('POST', `${S}/element`, { using: 'css selector', value: '.preview-canvas' });
  return Buffer.from(await call('GET', `${S}/element/${Object.values(el)[0]}/screenshot`), 'base64');
}
const usage = () => jsAsync('const done = arguments[arguments.length - 1]; navigator.storage.estimate().then((e) => done(e.usage), () => done(-1));');
/**
 * The question before a model download (V-181): it comes, nothing is downloaded while it waits, then it is agreed to.
 * Returns how much the site's storage grew while the question was on screen (MB).
 */
async function consent(yes, required = true) {
  const before = await usage();
  const asked = await waitFor('the question before the download', () => js(`${FIND.replace('return [', 'const el = [')} return !!el;`, [yes].flat()), required ? 60_000 : 10_000).catch((e) => { if (required) throw e; return false; });
  if (!asked) return 'not asked: the model is on the phone already';
  await sleep(6000);
  const grewMb = Math.round(((await usage()) - before) / 1e5) / 10;
  if (grewMb > 1) throw new Error(`the model was downloading before the yes: ${grewMb} MB`);
  await tap(yes);
  return grewMb;
}

async function longCaptions(ru) {
  await fresh(['speech_ru_long.mp4'], { ru });
  await tap(ru ? 'Субтитры' : 'Captions');
  const askedMb = await consent(ru ? 'Скачать и сделать субтитры' : 'Download and make captions');
  await waitFor('captions', async () => (await count('.clip-caption')) >= 1, 600_000);
  await idle(300_000);
  // The captions cover the whole clip only if every piece was read (60 px a second at the default zoom).
  const span = await js("const r = [...document.querySelectorAll('.clip-caption')].map((e) => e.getBoundingClientRect()); return Math.round((Math.max(...r.map((x) => x.right)) - Math.min(...r.map((x) => x.left))) / 6) / 10");
  if (span < 95) throw new Error(`captions cover ${span} s of 101 s`);
  return { askedMb, captionsCoverS: span };
}


// ---------- docs/20: captions on the phone (С1–С4, С6, С7; Г4) ----------
const TEXTS = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'e2e', 'eval', 'texts.json'), 'utf8'));
const wordsOf = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Share of the reference's words the captions got wrong (word-level Levenshtein), as captions-eval counts it. */
function wer(reference, captions) {
  const ref = wordsOf(reference), hyp = wordsOf(captions);
  let row = hyp.map((_, j) => j + 1);
  row.unshift(0);
  for (let i = 1; i <= ref.length; i++) {
    const next = [i];
    for (let j = 1; j <= hyp.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    row = next;
  }
  return Math.round((row[hyp.length] / ref.length) * 1000) / 10;
}
/** Records what the person reads while captions are made: the work's lines, every question, every toast. */
const SAID = `window.__l5.said = []; window.__l5.asks = []; window.__l5.notes = [];
  new MutationObserver(() => {
    const s = document.querySelector('.ck-work-label')?.textContent ?? '', L = window.__l5.said;
    if (s && L[L.length - 1] !== s) L.push(s);
    const q = document.querySelector('.model-ask')?.textContent ?? '', A = window.__l5.asks;
    if (q && A[A.length - 1] !== q) A.push(q.slice(0, 220));
    document.querySelectorAll('.toast').forEach((el) => { const t = el.textContent.slice(0, 160); if (!window.__l5.notes.includes(t)) window.__l5.notes.push(t); });
  }).observe(document, { subtree: true, childList: true, characterData: true });`;
const heard = () => js('return { said: window.__l5.said.slice(), asks: window.__l5.asks.slice(), notes: window.__l5.notes.slice() }');
const captionLines = () => js("return [...document.querySelectorAll('.caption-row input')].map((i) => i.value)");
const YES = ['Скачать и сделать субтитры', 'Download and make captions'];
/** One tap on Captions; every question about a model is answered yes; waits for the lines. */
async function oneTapCaptions(file, { ru = true, ms = 600_000 } = {}) {
  await fresh([file], { ru });
  await js(SAID);
  const t = Date.now();
  await tap(ru ? 'Субтитры' : 'Captions');
  await waitFor('the caption lines', async () => {
    await js(`${FIND.replace('return [', 'const el = [')} if (el) el.click();`, YES);
    return (await count('.caption-row')) >= 1;
  }, ms);
  await idle(60_000);
  return { seconds: Math.round((Date.now() - t) / 100) / 10, lines: await captionLines(), ...(await heard()) };
}
/** A range input set as a finger would leave it (React hears `input`). */
const setRange = (label, value) => js(`const el = [...document.querySelectorAll('input[type=range]')].find((e) => e.getAttribute('aria-label') === arguments[0]); if (!el) return false;
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(arguments[1])); el.dispatchEvent(new Event('input', { bubbles: true })); return true;`, label, value);
/** The live sample read with one tap in the Russian interface: the words wrong, what was asked and said. */
async function liveSpeech(file, limit) {
  const r = await oneTapCaptions(file);
  const wrong = wer(TEXTS.ru_live, r.lines.join(' '));
  if (r.asks.some((a) => /77|не похоже/.test(a))) throw new Error(`Whisper was asked for: ${JSON.stringify(r.asks)}`);
  if (limit && wrong > limit) throw new Error(`${wrong}% of words wrong, the limit is ${limit}%`);
  return { werPercent: wrong, seconds: r.seconds, asks: r.asks, said: r.said, notes: r.notes };
}

const SCENARIOS = {
  'captions-en': async () => { await fresh(['speech_en.mp4']); await tap('Captions'); const askedMb = await consent('Download and make captions'); await waitFor('captions', async () => (await count('.clip-caption')) >= 1, 300_000); return { askedMb, words: await js("return document.querySelector('.clip-caption')?.textContent.slice(0, 80)") }; },
  'captions-ru': async () => { await fresh(['speech_ru.mp4'], { ru: true }); await tap('Субтитры'); const askedMb = await consent('Скачать и сделать субтитры'); await waitFor('captions', async () => (await count('.clip-caption')) >= 1, 300_000); return { askedMb, words: await js("return document.querySelector('.clip-caption')?.textContent.slice(0, 80)") }; },
  // 101 s of speech in pieces (V-136, V-182): the tab lives to the end (the page's marker survives) and every piece is read.
  // Russian interface: the phone's Russian model; English interface: Whisper, the model the leak was reported for.
  'captions-ru-long': () => longCaptions(true),
  'captions-en-long': () => longCaptions(false),
  reel: async () => { await fresh(['speech_ru.mp4'], { ru: true }); await tap('Рилс в 1 тап'); await tap('Сделать рилс', 20_000).catch(() => undefined); const askedMb = await consent('Скачать и сделать рилс', false); await waitFor('the reel', () => js("return document.querySelector('.reel-done')?.textContent.slice(0, 160)"), 330_000); return { askedMb, done: await js("return document.querySelector('.reel-done')?.textContent.slice(0, 160)") }; },
  // V-243: a BT.601 video keeps its colours on the phone, in the preview, a photo and the video (ffmpeg's decode is the truth).
  'color-601': async () => {
    const truth = bands(['-ss', '1', '-i', fx('bt601.mp4')]);
    await fresh(['bt601.mp4'], { aspect: '16:9' });
    await seek(1);
    await sleep(1000);
    const preview = bands(['-i', 'pipe:0'], await previewShot());
    await exportAs('Photo', 'Save photo');
    const photo = bands(['-i', await pull('bt601-photo.jpg')]);
    await exportAs('Video', 'Export video');
    const video = bands(['-ss', '1', '-i', await pull('bt601-video.mp4')]);
    const seen = { preview: off(preview, truth), photo: off(photo, truth), video: off(video, truth) };
    if (Math.max(...Object.values(seen)) > 6) throw new Error(`colours moved, levels: ${JSON.stringify(seen)} truth ${JSON.stringify(truth)} preview ${JSON.stringify(preview)}`);
    return { levelsOff: seen };
  },
  // V-216: what the sheet starts with for a 60 fps video, and whether the phone's encoder keeps every frame.
  'export-60fps': async () => {
    await fresh(['fps60.mp4']);
    await tap(['Export', 'Экспорт']);
    await tap('Video');
    await waitFor('the sizes', () => js(`${FIND.replace('return [', 'const el = [')} return !!el;`, ['720p']), 20_000);
    const picked = await js("return [...document.querySelectorAll('[role=radio][aria-checked=true]')].map((e) => (e.getAttribute('aria-label') || e.textContent).trim())");
    await tap('Export video');
    await waitFor('"Ready"', () => js("return /Ready: [^\\n]* MB/.test(document.body.innerText)"), 300_000);
    await tap('Save / Share');
    const m = probe(await pull('fps60-export.mp4'));
    await tap('Done').catch(() => undefined);
    if (m.frames < 356 || m.frames > 364 || Math.round(m.fps) !== 60 || m.width !== 720 || m.height !== 1280) throw new Error(`not 360 frames at 60 fps, 720x1280: ${JSON.stringify({ picked, ...m })}`);
    return { picked, ...m };
  },
  // The same on a real iPhone clip: 30 s of 4K at 60 fps (HEVC), with the sheet's own choice.
  'export-4k60-phone': async () => {
    await fresh(['phone_4k60_hevc.mov'], { aspect: '16:9' });
    await tap(['Export', 'Экспорт']);
    await tap('Video');
    await waitFor('the sizes', () => js(`${FIND.replace('return [', 'const el = [')} return !!el;`, ['720p']), 20_000);
    if (process.env.L5_PICK) await tap(process.env.L5_PICK); // a size picked by hand instead of the sheet's own (e.g. 1080p)
    const picked = await js("return [...document.querySelectorAll('[role=radio][aria-checked=true]')].map((e) => (e.getAttribute('aria-label') || e.textContent).trim())");
    const t = Date.now();
    await tap('Export video');
    await waitFor('"Ready"', () => js("return /Ready: [^\\n]* MB/.test(document.body.innerText)"), 600_000);
    const realtimeX = Math.round((30_000 / (Date.now() - t)) * 100) / 100;
    await tap('Save / Share');
    const m = probe(await pull('4k60-export.mp4'));
    m.mb = Math.round((await import('node:fs')).statSync(join(OUT, '4k60-export.mp4')).size / 1e5) / 10;
    await tap('Done').catch(() => undefined);
    if (Math.abs(m.frames - m.duration * Math.round(m.fps)) > 3 || Math.abs(m.duration - 30) > 0.2) throw new Error(`frames or time lost: ${JSON.stringify({ picked, ...m })}`);
    // From v1.8.2 nothing picked means 1080p at the video's 60 fps (owner, 2026-11-11); 4K is a choice in the sheet.
    if (!process.env.L5_PICK && (Math.min(m.width, m.height) !== 1080 || Math.round(m.fps) !== 60)) throw new Error(`not 1080p60 when nothing is picked: ${JSON.stringify({ picked, ...m })}`);
    return { picked, realtimeX, ...m };
  },
  // V-157: what the phone says about the delay between the sound computed and the sound heard (with headphones on, too).
  'audio-latency': async () => {
    await fresh(['speech_en.mp4']);
    await js("const c = AudioNode.prototype.connect; AudioNode.prototype.connect = function (...a) { window.__l5.ctx = this.context; return c.apply(this, a); };");
    await tap('Play');
    await sleep(2500);
    const r = await js(`const x = window.__l5.ctx; if (!x) return null; const s = x.getOutputTimestamp ? x.getOutputTimestamp() : null;
      return { state: x.state, outputLatency: x.outputLatency ?? null, baseLatency: x.baseLatency ?? null, currentTime: x.currentTime,
        stampBehind: s && s.contextTime ? x.currentTime - (s.contextTime + (performance.now() - s.performanceTime) / 1000) : null };`);
    await tap('Pause').catch(() => undefined);
    if (!r) throw new Error('no audio context seen');
    return r;
  },
  // D-14: an edit, then at once a new page of the site (the editor goes into the back-forward cache with its save just
  // started). Up to v1.8.0 the new page's list stayed "Loading…" and "New project" did nothing while the old page was cached.
  'leave-after-edit': async () => {
    await fresh(['landscape.mp4']);
    await selectClip();
    await tap('Speed');
    await tap('2×');
    await tap('Done');
    await js("addEventListener('pagehide', (e) => localStorage.setItem('l5.pagehide', String(e.persisted)));");
    await call('POST', `${S}/url`, { url: URL_ }); // a new document, not the app's own way home
    await sleep(3000);
    const seen = await js("return { cached: localStorage.getItem('l5.pagehide'), loading: document.body.innerText.includes('Loading…') || document.body.innerText.includes('Загрузка…'), rows: document.querySelectorAll('.project-open').length }");
    if (seen.loading || seen.rows < 1) throw new Error(`the list does not load after leaving an edit: ${JSON.stringify(seen)}`);
    await js(WATCH); // the page is a new one by design
    return seen;
  },
  // The screens as the phone draws them (for the design review; the pictures stay on the Mac).
  screens: async () => {
    await call('POST', `${S}/url`, { url: URL_ });
    await js("localStorage.setItem('kadr.locale','ru');");
    await call('POST', `${S}/url`, { url: URL_ });
    await waitFor('home', () => js(`${FIND.replace('return [', 'const el = [')} return !!el;`, ['Новый проект']), 30_000);
    await sleep(800);
    await shot('screen-home');
    await fresh(['landscape.mp4'], { ru: true });
    await sleep(800);
    await shot('screen-editor');
    await selectClip();
    await sleep(500);
    await shot('screen-clip-tools');
    await tap(['Export', 'Экспорт']);
    await sleep(800);
    await shot('screen-export');
    return { saved: OUT };
  },
  cutout: async () => { await fresh(['person.jpg']); await selectClip(); await tap('Cutout'); await idle(180_000); await sleep(1500); return { removeBg: await js("return document.body.innerText.includes('Cutout')") }; },
  faces: async () => { await fresh(['walk.mp4'], { aspect: '16:9' }); await selectClip(); await tap('Hide faces'); await tap('Hide faces automatically'); await checked('Hide faces automatically', 120_000); await tap('Done'); return {}; },
  reframe: async () => { await fresh(['walk.mp4']); await selectClip(); await tap('Auto reframe'); await waitFor('reframed', () => js("return /Reframed/.test(document.body.innerText)"), 120_000); return {}; },
  reverse: async () => { await fresh(['landscape.mp4']); await selectClip(); await tap('Reverse'); await idle(180_000); return {}; },
  voice: async () => { await fresh(['speech_en.mp4']); await selectClip(); await tap('Voice'); await tap('Chipmunk'); await checked('Chipmunk', 120_000); await tap('Done'); return {}; },
  noise: async () => { await fresh(['speech_en.mp4']); await selectClip(); await tap('Volume'); await tap('Reduce background noise'); await checked('Reduce background noise', 120_000); await tap('Done'); return {}; },
  speed: async () => { await fresh(['landscape.mp4']); await selectClip(); await tap('Speed'); await tap('2×'); await tap('Done'); return { clipWidth: await js("return Math.round(document.querySelector('.tl-row.main .clip').getBoundingClientRect().width)") }; },
  chroma: async () => { await fresh(['landscape.mp4']); await selectClip(); await tap('Chroma key'); await tap('Remove color (green screen)'); await checked('Remove color (green screen)', 10_000); await tap('Done'); return {}; },
  'export-video': async () => { await fresh(['phone_1080_h264.mp4']); return { ready: await exportAs('Video', 'Export video', 'TikTok, Reels, Shorts') }; },
  'export-4k-hevc': async () => { await fresh(['phone_4k_hevc.mov']); return { ready: await exportAs('Video', 'Export video', 'TikTok, Reels, Shorts') }; },
  'export-photo': async () => { await fresh(['landscape.mp4']); return { ready: await exportAs('Photo', 'Save photo') }; },
  'export-gif': async () => { await fresh(['landscape.mp4']); return { ready: await exportAs('GIF', 'Export GIF') }; },
  'export-audio': async () => { await fresh(['speech_en.mp4']); return { ready: await exportAs('Audio', 'Export audio') }; },

  // ---- The S-1 search's fixes (v1.9.0–v1.9.1) where only the phone can say: its decoder, its storage, its sheet. ----
  // S-1-7/8/9: a 2×2 video, one 8K frame, H.264 4:4:4 and MP3 in a .mov are refused for their real reason, in Kadr's
  // words; the good file of the batch goes in and exports, and nothing fails later with "the decoder stopped".
  's1-refusals': async () => {
    const files = [
      make('tiny_2x2.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=2x2:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
      make('huge_8k.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=8192x4320:r=1', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
      make('yuv444.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv444p']),
      make('mp3_in.mov', ['-f', 'lavfi', '-i', 'sine=f=440:d=3', '-c:a', 'libmp3lame']),
      'landscape.mp4',
    ];
    await fresh(files);
    await sleep(15_000); // the refusals are shown one after another
    const said = await js('const t = window.__l5.toasts.splice(0); return t;');
    const engine = said.filter((x) => /WebCodecs|decodability|Decoder failure|Out of memory|Try Chrome or Safari/.test(x));
    if (!said.some((x) => x.includes('tiny_2x2') && /2×2/.test(x))) throw new Error(`2×2 not refused for its size: ${said.join(' | ')}`);
    if (engine.length) throw new Error(`engine words or advice: ${engine.join(' | ')}`);
    const clips = await count('.tl-row.main .clip');
    const ready = await exportAs('Video', 'Export video', 'TikTok, Reels, Shorts');
    const stopped = (await js('return window.__l5.toasts.slice()')).filter((x) => /decoder of this device stopped|Видеодекодер/.test(x));
    if (stopped.length) throw new Error(`a clip that went in failed in the export: ${stopped.join(' | ')}`);
    return { said, clips, ready };
  },
  // S-1-1: a project deleted on the home screen of a second Safari tab. The tab that has it open says so when the person
  // comes back to it, its header no longer says "saved", and nothing writes the project back (as iOS does it: the
  // first tab is in the background while the second one deletes).
  's1-tabs': async () => {
    await fresh(['landscape.mp4']);
    const id = await js("return decodeURIComponent(location.hash.replace(/^#\\/p\\//, ''))");
    const stored = () => jsAsync(`const done = arguments[arguments.length - 1]; const o = indexedDB.open('kadr');
      o.onsuccess = () => { const r = o.result.transaction('kv').objectStore('kv').getAllKeys(); r.onsuccess = () => { done(r.result.map(String)); o.result.close(); }; };
      o.onerror = () => done(null);`);
    if (!(await stored()).includes(`p:${id}`)) throw new Error('the project was not stored before the test');
    const a = await call('GET', `${S}/window`);
    const { handle: b } = await call('POST', `${S}/window/new`, { type: 'tab' });
    await call('POST', `${S}/window`, { handle: b });
    await call('POST', `${S}/url`, { url: URL_ });
    await waitFor('home in the second tab', () => js("return [...document.querySelectorAll('button')].some((x) => /^Delete /.test(x.getAttribute('aria-label') || ''))"), 30_000);
    try {
      await js("[...document.querySelectorAll('button')].find((x) => /^Delete /.test(x.getAttribute('aria-label') || '')).click()");
      await waitFor('the confirmation', () => js("const c = [...document.querySelectorAll('button')].find((x) => x.offsetParent !== null && x.textContent.trim() === 'Delete'); if (!c) return false; c.click(); return true;"), 10_000);
      await waitFor('the project gone from the list', () => js("return ![...document.querySelectorAll('button')].some((x) => /^Open /.test(x.getAttribute('aria-label') || ''))"), 15_000);
    } finally {
      await call('DELETE', `${S}/window`).catch(() => undefined); // closes the second tab
      await call('POST', `${S}/window`, { handle: a });
    }
    const told = await waitFor('the open tab is told', () => js("const d = document.querySelector('[role=alertdialog]'); return d && d.textContent.includes('This project was deleted') && d.textContent.slice(0, 120);"), 15_000);
    const header = await js("return document.querySelector('.ck-editor-saved')?.getAttribute('data-state') ?? null");
    // A key and the page going away write nothing (past the 2.5 s a save may wait).
    await js("document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true })); document.dispatchEvent(new Event('visibilitychange')); dispatchEvent(new PageTransitionEvent('pagehide'));");
    await sleep(3500);
    const back = (await stored()).includes(`p:${id}`);
    if (back) throw new Error('the deleted project was written back');
    if (header !== 'failed') throw new Error(`the header says ${header}`);
    const journal = await js("return localStorage.getItem('kadr.journal')");
    if (journal) throw new Error('a journal is left that could bring it back');
    return { told, header };
  },
  // S-1-12: takes from the real camera. On the Mac's WebKit about 5 takes in 45 gave the recorder nothing (0 bytes) under
  // load; here each take must land on the timeline. The first time Safari asks for the camera: a person taps Allow.
  's1-camera': async () => {
    await fresh([]);
    if (process.env.S1_KEEP_PIECES) await js('window.__l5.keepPieces = true;');
    const takes = [];
    for (let k = 0; k < Number(process.env.S1_TAKES ?? 4); k++) {
      const before = await count('.tl-row.main .clip-video');
      await tap('Camera');
      await waitFor('the camera (Allow on the phone, the first time)', () => js(`${FIND.replace('return [', 'const el = [')} return !!el;`, ['Start recording']), 90_000);
      await sleep(1000);
      await tap('Start recording');
      const t0 = Date.now();
      await waitFor('recording', () => js(`${FIND.replace('return [', 'const el = [')} return !!el;`, ['Stop recording']), 15_000);
      await sleep(3000);
      await tap('Stop recording').catch(() => undefined); // the net may have stopped it already
      // The take, however long it takes: a word on the way (a decoder that stopped) does not end the wait.
      const got = await waitFor('the take on the timeline', async () => (await count('.tl-row.main .clip-video')) > before && 'clip', 40_000).catch(() => 'no clip in 40 s');
      await closeTools();
      // The take settles in the preview: a decoder that stops says so by now. S1_PAUSE shortens it, as a person who
      // records the next take at once does (the first run, 1.5 s, saw "the video decoder of this device stopped").
      await sleep(Number(process.env.S1_PAUSE ?? 4000));
      takes.push({ take: k + 1, got, recordedMs: Date.now() - t0, said: await js('return window.__l5.toasts.slice()') });
    }
    // Which takes got their film strip (a strip that failed stays empty until it is drawn again), and when the dead files read again.
    const strips = { clips: await count('.tl-row.main .clip-video'), thumbs: await js("return Object.keys(window.__kadrPerf.marks).filter((k) => k.startsWith('thumbs:')).length") };
    // What Kadr wrote down about each error it showed (lib/errorLog: kind, where, message; nothing personal).
    const log = await jsAsync(`const done = arguments[arguments.length - 1]; const o = indexedDB.open('kadr-log');
      o.onsuccess = () => { try { const r = o.result.transaction('log').objectStore('log').getAll(); r.onsuccess = () => done(JSON.stringify(r.result).slice(-1500)); r.onerror = () => done('?'); } catch (e) { done(String(e)); } };
      o.onerror = () => done('no log');`);
    const bad = takes.filter((x) => x.got !== 'clip');
    if (bad.length) throw new Error(`takes that did not land: ${JSON.stringify(bad)}; log ${log}; warns ${JSON.stringify(await js('return window.__l5.warns.slice(-12)'))}`);
    // The takes as a film: the preview plays them, and the file has every frame (none black).
    await seek(0);
    await tap('Play');
    await sleep(4000);
    await tap('Pause').catch(() => undefined);
    const playing = await js('return window.__l5.toasts.slice()');
    await exportAs('Video', 'Export video', 'TikTok, Reels, Shorts');
    const file = await pull('camera.mp4');
    const p = probe(file);
    const black = (spawnSync('ffmpeg', ['-i', file, '-vf', 'blackdetect=d=0.1:pix_th=0.05', '-an', '-f', 'null', '-'], { encoding: 'utf8' }).stderr.match(/black_start:[\d.]+ black_end:[\d.]+/g) ?? []);
    const canary = await jsAsync("const done = arguments[arguments.length - 1]; window.__l5.canary.slice(1000, 1008).arrayBuffer().then((b) => done('readable ' + new Uint8Array(b)[0]), (e) => done(e.name + ': ' + e.message));");
    const lost = await js("return window.__l5.warns.filter((w) => /IndexedDB connection lost|server lost|connection/i.test(w)).slice(0, 4)");
    // Dead Blobs the door replaced since v1.9.6 (docs/19 H5): the trigger still fires, and is cured without a word.
    const leases = await js('return window.__kadrPerf && window.__kadrPerf.leases');
    return { kept: await js('return window.__l5.kept'), takes, afterPlay: playing, file: p, black, log, canary, lost, leases, strips, revive: await js('return window.__l5.revive'), warns: await js('return window.__l5.warns.slice(-4)'), diag: await js('return window.__l5.diag.slice(0, 6)') };
  },
  // One file of the S-1 batch on its own (S1_FILE=tiny_2x2|huge_8k|yuv444|mp3_in): which one, if any, takes the tab down.
  's1-one': async () => {
    const made = {
      tiny_2x2: () => make('tiny_2x2.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=2x2:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
      huge_8k: () => make('huge_8k.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=8192x4320:r=1', '-frames:v', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p']),
      yuv444: () => make('yuv444.mp4', ['-f', 'lavfi', '-i', 'testsrc=s=320x240:r=30', '-t', '2', '-c:v', 'libx264', '-pix_fmt', 'yuv444p']),
      mp3_in: () => make('mp3_in.mov', ['-f', 'lavfi', '-i', 'sine=f=440:d=3', '-c:a', 'libmp3lame']),
    }[process.env.S1_FILE];
    await fresh([]);
    await push(made());
    await push('landscape.mp4');
    await tap('Media');
    await waitFor('clips', async () => (await count('.tl-row.main .clip')) >= 1, 120_000);
    await sleep(12_000);
    const said = await js('return window.__l5.toasts.splice(0);');
    return { said, clips: await count('.tl-row.main .clip') };
  },
  // S-1-5: an hour of video reads in hours, and the first tap on Export says how big and how long before anything runs.
  's1-hour': async () => {
    await fresh([make('hour.mp4', ['-f', 'lavfi', '-i', 'color=c=blue:s=32x32:r=1', '-t', '3600', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '600'])]);
    const hours = await js("return document.body.innerText.includes('1:00:00.0')");
    if (!hours) throw new Error('the time does not read 1:00:00.0');
    await tap(['Export', 'Экспорт']);
    const note = await waitFor('the note on length and size', () => js("const m = document.body.innerText.match(/A 60-minute video[^\\n]*/); return m && m[0];"), 30_000);
    await sleep(3000);
    const running = await js("return /% — keep this screen open/.test(document.body.innerText)");
    if (running) throw new Error('the export started by itself');
    await tap(['Done', 'Готово']).catch(() => undefined);
    return { note };
  },
  // S-1-4: a 10 s song on a 6 s video ends with the video, and the file has no black tail.
  's1-sound-end': async () => {
    await fresh(['landscape.mp4']);
    await push('music.m4a');
    await tap('Audio');
    await waitFor('the song', async () => (await count('.tl-row.audio .clip')) >= 1, 60_000);
    await closeTools();
    const [v, a] = await js("return ['.tl-row.main .clip', '.tl-row.audio .clip'].map((q) => Math.round(document.querySelector(q).getBoundingClientRect().width))");
    if (Math.abs(a - v) > 4) throw new Error(`the song is ${a} px, the video ${v} px`);
    await exportAs('Video', 'Export video', 'TikTok, Reels, Shorts');
    const file = probe(await pull('sound-end.mp4'));
    if (file.duration > 6.15 || !file.audio) throw new Error(`file ${file.duration} s, sound ${file.audio}`);
    return { videoPx: v, songPx: a, fileS: file.duration };
  },
  // S-1-3: a backup whose caption has a null among its words opens, keeps what is whole and drops the rest.
  's1-backup': async () => {
    const { zipSync, strToU8 } = await import('fflate');
    const transform = { x: { v: 0 }, y: { v: 0.18, k: [null, { t: 0, v: 0.2 }, { t: 'x', v: 1 }] }, scale: { v: 1 }, rotation: { v: 0 }, opacity: { v: 1 } };
    const style = { font: 'inter', size: 0.05, weight: 700, italic: false, color: '#ffffff', align: 'center', stroke: 'red', background: { color: 5 }, shadow: false, copies: [null, { color: '#f00', x: 0.02, y: 0.02 }] };
    const project = { id: `dmg${Date.now()}`, version: 1, name: 'Damaged', createdAt: 1, updatedAt: 1,
      settings: { aspect: '9:16', width: 1080, height: 1920, fps: 30, background: { mode: 'color', color: '#000000' } }, assets: {},
      tracks: [{ id: 'm', kind: 'main', clips: [] }, { id: 'o', kind: 'overlay', clips: [{ kind: 'caption', id: 'cap', start: 0, duration: 3, blend: 'normal', highlight: null, wordsPerPage: 4, transform, style,
        words: [null, { t0: 0.2, t1: 0.9, text: 'WHOLE' }, { t0: 1, t1: 2, text: 5 }, { t0: 1, t1: 2 }] }] }] };
    const file = join(OUT, 'damaged.kadr');
    writeFileSync(file, zipSync({ 'project.json': strToU8(JSON.stringify(project)) }, { level: 0 }));
    await call('POST', `${S}/url`, { url: URL_ });
    await js("localStorage.setItem('kadr.tips','99');localStorage.setItem('kadr.locale','en');");
    await call('POST', `${S}/url`, { url: URL_ });
    await waitFor('home', () => js("return !!document.querySelector('button')"), 30_000);
    await js(WATCH);
    await push(file);
    await tap('Restore backup', 30_000);
    await waitFor('the editor', () => js("return !!document.querySelector('.preview-canvas')"), 60_000);
    await sleep(2000);
    const broken = await js("return document.body.innerText.includes('Something went wrong')");
    if (broken) throw new Error('the editor fell to "Something went wrong"');
    return { clips: await count('.tl-row .clip'), caption: await js("return document.querySelector('.clip-caption')?.textContent.slice(0, 40) ?? null") };
  },
  // S-1-2: an edit is in the journal at once (a tab iOS kills a moment later keeps it), not only when the page is left.
  's1-journal': async () => {
    await fresh(['landscape.mp4']);
    await selectClip();
    await seek(2);
    await sleep(600);
    const t = Date.now();
    await tap('Split');
    const ms = await waitFor('the split in the journal', async () => (await js("try { const j = JSON.parse(localStorage.getItem('kadr.journal') || 'null'); return j && j.project.tracks.find((x) => x.kind === 'main').clips.length === 2; } catch { return false; }")) && Date.now() - t, 5000);
    return { journaledWithinMs: ms };
  },
  // docs/20 on the phone. С6: a caption template's tile is never empty while its demo loops.
  'captions-tiles': async () => {
    await fresh(['speech_en.mp4']);
    await tap('Captions');
    await tap(['Settings', 'Not now'], 60_000);
    await js("[...document.querySelectorAll('[role=radiogroup]')].find((g) => g.getAttribute('aria-label') === 'Style')?.scrollIntoView({ block: 'center' })");
    await waitFor('tiles drawn', async () => (await count('.sheet canvas[data-id][data-ready]')) >= 4, 30_000);
    await sleep(1500);
    const seen = await jsAsync(`const done = arguments[arguments.length - 1];
      const tiles = [...document.querySelectorAll('.sheet canvas[data-id][data-ready]')].filter((c) => { const r = c.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.width > 0; });
      const peak = (c) => { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; let m = 0; for (let i = 3; i < d.length; i += 16) if (d[i] > m) m = d[i]; return m; };
      let samples = 0, empty = 0, allEmpty = 0; const t0 = performance.now();
      const tick = () => { const n = tiles.filter((c) => peak(c) < 24).length; samples++; empty += n; if (n === tiles.length) allEmpty++;
        if (performance.now() - t0 < 6000) setTimeout(tick, 40); else done({ tiles: tiles.length, samples, empty, allEmpty }); };
      tick();`);
    await shot('captions-tiles');
    if (seen.tiles < 4 || seen.allEmpty > 0 || seen.empty > 0) throw new Error(`tiles went empty: ${JSON.stringify(seen)}`);
    return seen;
  },
  // С1, С2, С7: the model downloads once and the screen says so; the word under the playhead; a part made again keeps the rest.
  'captions-docs20': async () => {
    const first = await oneTapCaptions('eval_ru.mp4');
    const downloaded = first.asks.length > 0;
    const says = first.said.join(' | ');
    if (downloaded && !/Скачиваем модель речи: \d+ МБ/.test(says)) throw new Error(`a download without its words: ${says}`);
    if (!downloaded && /Скачиваем|скачается/.test(says)) throw new Error(`"downloading" with the model on the phone: ${says}`);
    if (!first.said.includes('Запускаем модель речи (она уже на устройстве)…')) throw new Error(`no "starting": ${says}`);
    const wrong = wer(TEXTS.ru, first.lines.join(' '));
    // The word under the playhead, 5 s in: its line is the current one and the mark lies where the field draws the word.
    await seek(5);
    await sleep(1200);
    await js("document.querySelector('.caption-row[data-now]')?.scrollIntoView({ block: 'center' })");
    await sleep(600);
    const mark = await js(`const rows = [...document.querySelectorAll('.caption-row')], row = rows.find((r) => r.hasAttribute('data-now'));
      if (!row) return null;
      const f = row.querySelector('input'), m = row.querySelector('mark');
      if (!m) return { row: rows.indexOf(row), word: null };
      const cs = getComputedStyle(f), c = document.createElement('canvas').getContext('2d');
      c.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const before = f.value.slice(0, f.value.indexOf(m.textContent)), mr = m.getBoundingClientRect(), fr = f.getBoundingClientRect();
      const r1 = (x) => Math.round(x * 10) / 10;
      return { row: rows.indexOf(row), at: row.querySelector('span').textContent, word: m.textContent, line: f.value, current: f.getAttribute('aria-current'),
        left: r1(mr.left - fr.left - f.scrollLeft * 0), wantLeft: r1(parseFloat(cs.paddingLeft) + c.measureText(before).width - f.scrollLeft), width: r1(mr.width), wantWidth: r1(c.measureText(m.textContent).width),
        markTop: r1(mr.top - fr.top), markHeight: r1(mr.height), fieldHeight: r1(fr.height), fontPx: cs.fontSize };`);
    await shot('captions-word');
    if (!mark || !mark.word) throw new Error(`no word is marked under the playhead: ${JSON.stringify(mark)}`);
    if (mark.current !== 'true' || Math.abs(mark.left - mark.wantLeft) > 2 || Math.abs(mark.width - mark.wantWidth) > 2.5) throw new Error(`the mark is off its word: ${JSON.stringify(mark)}`);
    // A correction in the first line, then captions again for 10–20 s only.
    await js(`const i = document.querySelector('.caption-row input'); i.focus();
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'ПРАВКА человека'); i.dispatchEvent(new Event('input', { bubbles: true }));
      i.dispatchEvent(new FocusEvent('focusout', { bubbles: true })); i.blur();`);
    await sleep(800);
    const before = await captionLines();
    if (!before[0].startsWith('ПРАВКА человека')) throw new Error(`the correction did not land: ${before[0]}`);
    await js('window.__l5.said.length = 0; window.__l5.asks.length = 0;');
    const stored = await usage();
    await tap('Создать заново…');
    await sleep(2500); // the chips learn what the phone keeps
    const chips = await js("const g = [...document.querySelectorAll('[role=radiogroup]')].find((x) => x.getAttribute('aria-label') === 'Распознавание'); return g ? [...g.querySelectorAll('[role=radio]')].map((c) => c.textContent + (c.getAttribute('aria-checked') === 'true' ? ' ✓' : '')) : null");
    if (!chips || !chips.some((c) => /на устройстве/.test(c)) || !chips.includes('Авто ✓')) throw new Error(`the chips: ${JSON.stringify(chips)}`);
    await tap('Участок');
    await sleep(400);
    if (!(await setRange('Конец участка', 20)) || !(await setRange('Начало участка', 10))) throw new Error('no marks for the part');
    await sleep(400);
    const part = await js("return document.querySelector('.ck-part-says')?.textContent");
    await js("document.querySelector('.ck-part')?.scrollIntoView({ block: 'center' })");
    await sleep(400);
    await shot('captions-part');
    const t = Date.now();
    await tap('Создать субтитры');
    await waitFor('captions for the part', () => js("return [...document.querySelectorAll('button')].some((b) => b.offsetParent !== null && b.textContent.trim() === 'Создать заново…') && document.querySelectorAll('.caption-row').length > 0"), 300_000);
    const again = await heard();
    const after = await captionLines();
    const grewMb = Math.round(((await usage()) - stored) / 1e5) / 10;
    const says2 = again.said.join(' | ');
    if (again.asks.length || /Скачиваем|скачается/.test(says2)) throw new Error(`the second run spoke of a download: ${JSON.stringify(again)}`);
    if (!again.said.includes('Запускаем модель речи (она уже на устройстве)…')) throw new Error(`the second run did not say "starting": ${says2}`);
    if (grewMb > 2) throw new Error(`the second run stored ${grewMb} MB more`);
    if (after[0] !== before[0]) throw new Error(`the corrected line changed: ${after[0]}`);
    const persisted = await jsAsync('const done = arguments[arguments.length - 1]; navigator.storage.persisted().then(done, () => done(null));');
    return { firstRun: { seconds: first.seconds, asked: first.asks, said: first.said, werPercent: wrong, lines: first.lines.length }, mark, chips, part,
      secondRun: { seconds: Math.round((Date.now() - t) / 100) / 10, said: again.said, storedMoreMb: grewMb, lines: after.length, first: after[0] }, storagePersisted: persisted };
  },
  // С4, С5 and ADR-С7: live Russian speech with one tap; under music Whisper is not asked for; a quiet recording reads as a normal one.
  'captions-live-ru': () => liveSpeech('eval_ru_live.mp4', 12),
  'captions-music-ru': () => liveSpeech('eval_ru_live_music.mp4', 0),
  'captions-quiet-ru': () => liveSpeech('eval_ru_live_quiet.mp4', 12),
  // С3: an English interface, Russian speech, Auto: the Russian model reads it (asked about first, when the phone does not keep it).
  'captions-auto-en': async () => {
    const r = await oneTapCaptions('eval_ru.mp4', { ru: false });
    const text = r.lines.join(' ').toLowerCase();
    const wrong = wer(TEXTS.ru, text);
    if (!text.includes('привет') || wrong > 25) throw new Error(`not read by the Russian model: ${wrong}% wrong, "${text.slice(0, 80)}"`);
    return { werPercent: wrong, seconds: r.seconds, asks: r.asks, said: r.said, notes: r.notes };
  },
  // Г4: does GigaAM (225 MB, heap about 500 MB) start and read on this iPhone? Through the site's own ?diag page.
  'diag-gigaam': async () => {
    await call('POST', `${S}/url`, { url: `${URL_}?diag` });
    await waitFor('the diagnostics page', () => js("return !!document.querySelector('.diag-report')"), 60_000);
    await js(WATCH);
    await waitFor('the first report', () => js("return (document.querySelector('.diag-report')?.textContent ?? '').includes('## Video export') && !document.querySelector('.diag [role=status]')"), 240_000);
    await js("const b = [...document.querySelectorAll('button')].find((x) => /^(Русская речь|Russian speech), 225/.test(x.textContent.trim())); if (!b) throw new Error('no GigaAM button'); b.click();");
    const ru = await waitFor('GigaAM on the phone', () => js("const t = document.querySelector('.diag-report')?.textContent ?? ''; const m = t.split('## Speech model: ru')[1]; return m && /result: (ok|FAILED)/.test(m) ? m.slice(0, 600) : null"), 560_000);
    if (!/result: ok/.test(ru)) throw new Error(`GigaAM did not run: ${ru.replace(/\s+/g, ' ').slice(0, 200)}`);
    return { report: ru.replace(/\n+/g, ' | ').slice(0, 500) };
  },
};
/** A test file made here with ffmpeg (into the output folder). */
function make(name, args) {
  const out = join(OUT, name);
  execFileSync('ffmpeg', ['-v', 'error', '-y', ...args, out]);
  return out;
}

const pick = process.argv.slice(2);
const names = pick.length ? pick : Object.keys(SCENARIOS);
const results = [];
try {
  for (const name of names) {
    const t = Date.now();
    const row = { name };
    try {
      row.note = await SCENARIOS[name]();
      row.ok = true;
    } catch (e) {
      row.ok = false;
      row.error = e.message.slice(0, 220);
      await shot(`fail-${name}`).catch(() => undefined);
    }
    row.s = Math.round((Date.now() - t) / 100) / 10;
    const page = await js('return window.__l5 ? { errors: window.__l5.errors, toasts: window.__l5.toasts } : null').catch(() => null);
    if (!page) { row.ok = false; row.crashed = 'the page lost its state: reloaded or the tab died'; }
    else { if (page.errors.length) { row.ok = false; row.errors = page.errors; } if (page.toasts.length) { row.ok = false; row.toasts = page.toasts; } }
    results.push(row);
    console.log(JSON.stringify(row));
    // Nothing of the test stays on the phone. Home the app's own way, once its save has landed: a new document here put
    // the editor into the back-forward cache with a save in flight, and up to v1.8.0 that locked the storage (D-14).
    await sleep(1500);
    await js("location.hash = ''").catch(() => undefined);
    await sleep(800);
    for (let i = 0; i < 10 && !process.env.L5_KEEP; i++) {
      const asked = await js("const d = [...document.querySelectorAll('button')].find((b) => /^(Delete|Удалить) /.test(b.getAttribute('aria-label') || '')); if (!d) return false; d.click(); return true;").catch(() => false);
      if (!asked) break;
      await sleep(400);
      await js("const c = [...document.querySelectorAll('button')].find((b) => b.offsetParent !== null && ['Delete', 'Удалить'].includes(b.textContent.trim())); if (c) c.click();").catch(() => undefined);
      await sleep(1200);
    }
  }
} finally {
  writeFileSync(join(OUT, 'tools.json'), JSON.stringify({ url: URL_, device: session.capabilities['safari:platformVersion'], results }, null, 2));
  await call('DELETE', S).catch(() => undefined);
  driver.kill();
}
process.exit(results.every((r) => r.ok) ? 0 : 1);
