// L5 for font pairs (docs/18 П5) on a real iPhone, through Safari's WebDriver, on the live site with `?pairs`:
// the nine pairs on a Russian text one after another (each drawn, its faces loaded, the time from the tap to the settled
// frame), «Line 2» set in another face, «Swap lines» and its undo, and then WYSIWYG on a cold page — the project opened
// again with none of the pair's faces loaded and exported first: the file's frame against the preview's (Ш7).
// The control must be red: the preview before the pair against the same frame of the file.
//   node scripts/l5-pairs.mjs [site URL]     (phone: unlocked, Auto-Lock Never, Web Inspector and Remote Automation on)
// Env: L5_UDID picks a phone, L5_OUT the folder for pictures and run.json. Taps are click() in the page, not fingers;
// the file is checked on the Mac instead of the share sheet (as in scripts/l5-iphone.mjs).
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.argv[2] ?? 'https://timofeys22.github.io/Kadr/';
const URL_ = `${BASE}${BASE.includes('?') ? '&' : '?'}pairs`;
const PORT = 4447;
const OUT = process.env.L5_OUT ?? join(process.env.TMPDIR ?? '/tmp', 'kadr-l5-pairs');
const T = 1.5; // s: inside the sample's text clip (it starts at 0.3 s), frame 45
const TEXT = 'Лето в городе';
const PAIRS = ['Tender', 'Party', 'Cover', 'Runway', 'Film', 'Vlog', 'Jazz', 'Bold', 'Air'];
mkdirSync(OUT, { recursive: true });

// One WebDriver session per phone: another session's run (scripts/l5-iphone.mjs, l5-chetko.mjs) must finish first.
if (spawnSync('pgrep', ['-x', 'safaridriver']).status === 0) { console.error('L5 pairs: safaridriver is running — another run has the phone'); process.exit(3); }
const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
await sleep(2000);

async function call(method, path, body, ms = 120_000) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}
// L5_DESKTOP=1: the Mac's Safari in a phone-wide window, to try the script itself while the phone is away (not L5).
const DESKTOP = process.env.L5_DESKTOP === '1';
const caps = DESKTOP ? { browserName: 'safari' } : { browserName: 'safari', platformName: 'ios', 'safari:useSimulator': false, ...(process.env.L5_UDID ? { 'safari:deviceUDID': process.env.L5_UDID } : { 'safari:deviceType': 'iPhone' }) };
// After a session ends the phone may refuse a new one for 20–60 s.
let session;
for (let attempt = 1; !session; attempt++) {
  try {
    session = await call('POST', '/session', { capabilities: { alwaysMatch: caps } });
  } catch (e) {
    if (attempt === 6) { driver.kill(); console.error(`L5 pairs: no session: ${e.message}`); process.exit(2); }
    await sleep(20_000);
  }
}
const S = `/session/${session.sessionId}`;
await call('POST', `${S}/timeouts`, { script: 180_000 });
if (DESKTOP) await call('POST', `${S}/window/rect`, { width: 400, height: 860, x: 40, y: 40 });
const js = (script, ...args) => call('POST', `${S}/execute/sync`, { script, args });
const jsAsync = (script, ...args) => call('POST', `${S}/execute/async`, { script, args }, 200_000);

const FIND = `const name = arguments[0];
  const own = (e) => { const c = e.cloneNode(true); c.querySelectorAll('.ck-btn-sub').forEach((x) => x.remove()); return c.textContent; };
  return [...document.querySelectorAll('button,[role=radio],[role=switch]')].find((e) => e.offsetParent !== null && ((e.getAttribute('aria-label') || own(e)).trim() === name)) || null;`;
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
const tap = async (name, ms) => {
  await button(name, ms);
  await js(`const found = (function () { ${FIND} }).apply(null, arguments); found.scrollIntoView({ block: 'nearest', inline: 'nearest' }); found.click();`, name);
};
/** click() on the first element a CSS selector finds whose aria-label or text is `name` (null: any). */
const tapIn = (css, name) => js(`const el = [...document.querySelectorAll(arguments[0])].find((e) => arguments[1] === null || (e.getAttribute('aria-label') || e.textContent).trim() === arguments[1]);
  if (!el) return false; el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.click(); return true;`, css, name ?? null);
const shot = async (name) => { const f = join(OUT, `${name}.png`); writeFileSync(f, Buffer.from(await call('GET', `${S}/screenshot`), 'base64')); return f; };
const seek = (t) => js('document.querySelector(".tl-scroll").scrollLeft = arguments[0];', Math.round(t * 60));
const field = () => js("return document.querySelector('.sheet textarea')?.value ?? null");

const WATCH = `if (!window.__l5) {
  window.__l5 = { errors: [], toasts: [], blob: null, draws: [] };
  addEventListener('error', (e) => window.__l5.errors.push(String(e.message)));
  addEventListener('unhandledrejection', (e) => window.__l5.errors.push(String(e.reason)));
  new MutationObserver(() => document.querySelectorAll('.toast.error').forEach((el) => { if (!window.__l5.toasts.includes(el.textContent)) window.__l5.toasts.push(el.textContent); })).observe(document, { subtree: true, childList: true });
  Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
  const create = URL.createObjectURL;
  URL.createObjectURL = function (b) { if (b instanceof Blob && /^video/.test(b.type)) window.__l5.blob = b; return create.call(URL, b); };
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download && this.href.startsWith('blob:')) return; return click.call(this); };
  // Every draw of the preview, to time a tap to the frame it settles on (the context exists already: patch the prototype).
  for (const fn of ['drawArrays', 'drawElements']) {
    const draw = WebGL2RenderingContext.prototype[fn];
    WebGL2RenderingContext.prototype[fn] = function (...a) { if (this.canvas?.classList?.contains('preview-canvas')) window.__l5.draws.push(performance.now()); return draw.apply(this, a); };
  }
}`;

/** The preview canvas cut out of a screenshot of the page, at the screenshot's own scale. */
async function preview(name) {
  const r = await js("const r = document.querySelector('.preview-canvas').getBoundingClientRect(); return [r.x, r.y, r.width, r.height, innerWidth];");
  const png = await shot(`${name}-screen`);
  const w = Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width', '-of', 'csv=p=0', png], { encoding: 'utf8' }).trim());
  const k = w / r[4];
  const [x, y, cw, ch] = r.slice(0, 4).map((v) => Math.round(v * k));
  const out = join(OUT, `${name}.png`);
  execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', png, '-vf', `crop=${cw}:${ch}:${x}:${y}`, out]);
  return out;
}
const rgb = (file, n) => execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-vf', `${n === undefined ? '' : `select=eq(n\\,${n}),`}scale=135:240`, '-fps_mode', 'passthrough', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-']);
const meanAbsDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
/** The largest mean signed R, G or B difference of any 15×15 block of two 135×240 pictures (as e2e/editor.spec.ts). */
function worstBlock(a, b) {
  let worst = 0;
  for (let by = 0; by < 240; by += 15) for (let bx = 0; bx < 135; bx += 15) {
    const sum = [0, 0, 0];
    for (let y = by; y < by + 15; y++) for (let x = bx; x < bx + 15; x++) for (let c = 0; c < 3; c++) { const i = (y * 135 + x) * 3 + c; sum[c] += a[i] - b[i]; }
    worst = Math.max(worst, ...sum.map((v) => Math.abs(v) / 225));
  }
  return worst;
}
/** The preview once it holds still: a scrub shows a near keyframe first, and cold faces arrive after the first draw. */
async function stillPreview(name) {
  let prev = rgb(await preview(name));
  for (let k = 1; k <= 12; k++) {
    await sleep(700);
    const next = rgb(await preview(name));
    if (meanAbsDiff(prev, next) < 0.3) return { file: join(OUT, `${name}.png`), waitedMs: k * 700 };
    prev = next;
  }
  throw new Error(`${name}: the preview did not hold still`);
}

const steps = [];
const result = { url: URL_, started: new Date().toISOString(), replaced: 'sample project instead of Photos; taps are click() in the page; the file is read on the Mac instead of the share sheet' };
async function step(name, fn) {
  const t = Date.now();
  try {
    const note = await fn();
    steps.push({ name, ms: Date.now() - t, ok: true, note });
    console.log(`ok   ${name}: ${Date.now() - t} ms${note ? ` ${JSON.stringify(note)}` : ''}`);
  } catch (e) {
    steps.push({ name, ms: Date.now() - t, ok: false, error: e.message });
    console.log(`FAIL ${name}: ${e.message}`);
    await shot(`fail-${name.replace(/\W+/g, '-')}`).catch(() => undefined);
    throw e;
  }
}

let failed = false;
try {
  await step('cold start with ?pairs', async () => {
    await call('POST', `${S}/url`, { url: URL_ });
    await js("for (const [k, v] of [['kadr.tips','99'],['kadr.iosFormatCard.v1','1'],['kadr.locale','en'],['kadr.hint.move','1'],['kadr.iosVideoTip.v3','1'],['kadr.undoMoved.v1','1'],['kadr.exportPrefs',JSON.stringify({quick:false})]]) localStorage.setItem(k, v);");
    await call('POST', `${S}/url`, { url: URL_ });
    await button('Try a sample', 60_000);
    return { version: await js("return document.querySelector('.home-foot, .ck-home-foot')?.textContent.match(/v[\\d.]+/)?.[0] ?? null"), ua: await js('return navigator.userAgent') };
  });

  await step('sample, the text clip, the frame before the pair (control)', async () => {
    await tap('Try a sample');
    await waitFor('clips on the timeline', async () => (await js("return document.querySelectorAll('.tl-row.main .clip').length")) > 0, 90_000);
    await js(WATCH);
    await js("const c = document.querySelector('[aria-label=\"Close tools\"]'); if (c) c.click();");
    await seek(T);
    const still = await stillPreview('preview-before');
    // The timeline listens to pointer events, which click() does not send.
    await js(`const el = document.querySelector('.tl-row .clip-text'), r = el.getBoundingClientRect();
      const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 };
      el.dispatchEvent(new PointerEvent('pointerdown', at)); el.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 })); el.click();`);
    await sleep(400);
    return { heldStillAfterMs: still.waitedMs };
  });

  await step('the text sheet opens', async () => {
    const ms = await jsAsync(`const done = arguments[arguments.length - 1];
      const tool = [...document.querySelectorAll('.toolbar .tool')].find((e) => /^(Edit text|Text)$/.test(e.textContent.trim()));
      if (!tool) return done(-1);
      const t = performance.now(); tool.click();
      const wait = () => document.querySelector('.sheet textarea') ? requestAnimationFrame(() => done(Math.round(performance.now() - t))) : setTimeout(wait, 5); wait();`);
    if (ms < 0) throw new Error('no text tool');
    await js(`const f = document.querySelector('.sheet textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(f, arguments[0]); f.dispatchEvent(new Event('input', { bubbles: true }));`, TEXT);
    await sleep(800);
    return { sheetMs: ms };
  });

  await step('«Pairs»: the tiles draw', async () => {
    const t = await js('return performance.now()');
    if (!(await tapIn('.sheet .ck-cat', 'Pairs'))) throw new Error('no «Pairs» category: is the flag on?');
    const READY = "return document.querySelectorAll('.sheet [data-cat=\"pairs\"] canvas[data-ready]').length";
    await waitFor('3 pair tiles drawn', async () => (await js(READY)) >= 3, 30_000);
    const first3 = Math.round((await js('return performance.now()')) - t);
    await sleep(4000);
    await shot('pairs-sheet');
    return { first3TilesMs: first3, pairs: await js("return document.querySelectorAll('.sheet [data-cat=\"pairs\"] [role=radio]').length"), drawnAfter4s: await js(READY) };
  });

  result.pairs = [];
  await step('each pair on «Лето в городе»: drawn, its faces in, tap to the settled frame', async () => {
    for (const name of PAIRS) {
      const r = await jsAsync(`const [name, done] = [arguments[0], arguments[arguments.length - 1]];
        const el = [...document.querySelectorAll('.sheet [data-cat="pairs"] [role=radio]')].find((e) => (e.getAttribute('aria-label') || e.textContent).trim() === name);
        if (!el) return done({ error: 'no tile' });
        el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        const t = performance.now(); el.click();
        setTimeout(() => {
          const d = window.__l5.draws.filter((x) => x > t);
          // The strip marks no tile (StylePicker value={null}): a pair is on when the line controls are there.
          done({ firstDrawMs: d.length ? Math.round(d[0] - t) : null, settledMs: d.length ? Math.round(d.at(-1) - t) : null, draws: d.length,
            text: document.querySelector('.sheet textarea')?.value, lines: !!document.querySelector('.sheet [role=radiogroup][aria-label="Line"]') });
        }, 3000);`, name);
      if (r.error) throw new Error(`${name}: ${r.error}`);
      await seek(T);
      await sleep(600);
      await preview(`pair-${name}`);
      result.pairs.push({ name, ...r });
      console.log(`     ${name}: ${JSON.stringify(r)}`);
      if (!r.lines || !r.text.includes('\n')) throw new Error(`${name}: not applied ${JSON.stringify(r)}`);
    }
    const faces = await js("return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => `${f.family} ${f.weight} ${f.style}`)");
    const failedFaces = await js("return [...document.fonts].filter((f) => f.status === 'error').map((f) => `${f.family} ${f.weight} ${f.style}`)");
    if (failedFaces.length) throw new Error(`faces failed to load: ${failedFaces.join(', ')}`);
    const settled = result.pairs.map((p) => p.settledMs ?? 0).sort((a, b) => a - b);
    return { settledMedianMs: settled[Math.floor(settled.length / 2)], settledMaxMs: settled.at(-1), facesLoaded: faces.length };
  });

  await step('«Tender»: line 2 in a serif, «Swap lines», undo', async () => {
    await tapIn('.sheet [data-cat="pairs"] [role=radio]', 'Tender');
    await sleep(800);
    const before = await field();
    await tapIn('.sheet [role=radiogroup][aria-label="Line"] [role=radio]', 'Line 2');
    await sleep(300);
    await js(`const fonts = document.querySelector('.sheet [role=radiogroup][aria-label="Font"]').parentElement;
      [...fonts.querySelectorAll('.ck-cat')].find((e) => e.textContent.trim() === 'Serif').click();`);
    await sleep(500);
    const serif = await js(`const el = document.querySelector('.sheet [role=radiogroup][aria-label="Font"] [data-cat="serif"] [role=radio]'); el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); el.click(); return el.getAttribute('aria-label');`);
    await sleep(800);
    await tap('Swap lines');
    await sleep(800);
    const swapped = await field();
    await seek(T);
    await sleep(800);
    await preview('tender-swapped');
    await tap('Undo');
    await sleep(800);
    const back = await field();
    const [a, b] = before.split('\n');
    if (swapped !== `${b}\n${a}`) throw new Error(`not swapped: ${JSON.stringify({ before, swapped })}`);
    if (back !== before) throw new Error(`undo did not give the lines back: ${JSON.stringify({ before, back })}`);
    await seek(T);
    await sleep(800);
    await preview('tender-line2-serif');
    await tap('Done');
    await sleep(1500); // autosave
    return { before, swapped, line2: serif };
  });

  let previewFile;
  await step('cold page: the project opened again, the preview holds the pair', async () => {
    const page = await js('return window.__l5');
    result.errorsBeforeReload = { errors: page.errors, toasts: page.toasts };
    await call('POST', `${S}/url`, { url: URL_ });
    await waitFor('a saved project', () => js("return document.querySelector('.project-open')"), 30_000);
    await js("document.querySelector('.project-open').click();");
    await waitFor('clips', async () => (await js("return document.querySelectorAll('.tl-row.main .clip').length")) > 0, 60_000);
    await js(WATCH);
    await js("const c = document.querySelector('[aria-label=\"Close tools\"]'); if (c) c.click();");
    await seek(T);
    const still = await stillPreview('preview-pair');
    previewFile = still.file;
    return { heldStillAfterMs: still.waitedMs };
  });

  await step('export 1080p and compare the frame (Ш7)', async () => {
    await tap('Export');
    await tap('Video');
    await tap('TikTok, Reels, Shorts');
    await sleep(400);
    const t = Date.now();
    await tap('Export video');
    await waitFor('"Ready"', () => js("const m = document.body.innerText.match(/Ready: [^\\n]* MB/); return m && m[0];"), 240_000);
    const exportMs = Date.now() - t;
    await tap('Save / Share');
    await waitFor('the file', () => js('return !!window.__l5.blob'), 15_000);
    const b64 = await jsAsync(`const done = arguments[arguments.length - 1];
      const r = new FileReader(); r.onload = () => done(r.result.split(',')[1]); r.onerror = () => done(null); r.readAsDataURL(window.__l5.blob);`);
    if (!b64) throw new Error('the file could not be read');
    const file = join(OUT, 'export.mp4');
    writeFileSync(file, Buffer.from(b64, 'base64'));
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,codec_name,width,height:format=duration', '-of', 'json', file], { encoding: 'utf8' }));
    const v = probe.streams.find((s) => s.codec_type === 'video');
    const n = Math.round(T * 30);
    execFileSync('ffmpeg', ['-v', 'error', '-y', '-i', file, '-vf', `select=eq(n\\,${n})`, '-frames:v', '1', join(OUT, 'export-frame.png')]);
    const frame = rgb(file, n), pair = rgb(previewFile), before = rgb(join(OUT, 'preview-before.png'));
    const m = { video: v?.codec_name, size: `${v?.width}×${v?.height}`, previewAspect: undefined, duration: Number(probe.format.duration), exportMs,
      diff: +meanAbsDiff(pair, frame).toFixed(2), block: +worstBlock(pair, frame).toFixed(1),
      controlDiff: +meanAbsDiff(before, frame).toFixed(2), controlBlock: +worstBlock(before, frame).toFixed(1) };
    result.wysiwyg = m;
    // Thresholds as e2e/editor.spec.ts (video frame < 6, worst block < 20); the control must fail the block one.
    if (m.diff >= 6 || m.block >= 20) throw new Error(`the file differs from the preview: ${JSON.stringify(m)}`);
    if (m.controlBlock < 20) throw new Error(`the control does not see the pair: ${JSON.stringify(m)}`);
    await tap('Done').catch(() => undefined);
    return m;
  });
  const page = await js('return window.__l5');
  result.errors = { errors: page.errors, toasts: page.toasts };
  if (page.errors.length || page.toasts.length) { failed = true; console.log(`page errors: ${JSON.stringify(result.errors)}`); }
} catch {
  failed = true;
} finally {
  result.finished = new Date().toISOString();
  result.steps = steps;
  result.device = { name: session.capabilities['safari:deviceName'], type: session.capabilities['safari:deviceType'], ios: session.capabilities['safari:platformVersion'] };
  writeFileSync(join(OUT, 'run.json'), JSON.stringify(result, null, 2));
  await call('DELETE', S).catch(() => undefined);
  driver.kill();
}
console.log(failed ? 'L5 pairs: FAILED' : 'L5 pairs: passed', OUT);
process.exit(failed ? 1 : 0);
