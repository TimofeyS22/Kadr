// L5 of lane U of the sweep (docs/21; reports/L5 — очередь.md, section U): what only Safari on a real iPhone can say about
// the interface rows UI-2, UI-6, UI-7, Q-33 / SW-U-1, SW-U-3, SW-U-4 — the sheet and the frame in Safari's own visible
// height with its bars, the header's size, a sheet's swipe and a cancelled one, the handle and the ribbon's edges.
// Taps and drags are dispatched in the page as touch pointer events (safaridriver's own touches arrive as long presses), so
// a real finger and the system's Home gesture stay a manual step (see the queue).
//   node scripts/l5-sweep-u.mjs [site URL]     Env: L5_UDID, L5_OUT (screenshots), L5_MAC=1 (Safari on this Mac)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? 'https://timofeys22.github.io/Kadr/';
const OUT = process.env.L5_OUT ?? join(process.env.TMPDIR ?? '/tmp', 'kadr-l5-sweep-u');
mkdirSync(OUT, { recursive: true });
const PORT = 4452;

const driver = spawn('safaridriver', ['-p', String(PORT)], { stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 2000));
async function call(method, path, body, ms = 330_000) {
  const res = await fetch(`http://127.0.0.1:${PORT}${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms) });
  const json = await res.json();
  if (json.value?.error) throw new Error(`${json.value.error}: ${json.value.message}`);
  return json.value;
}
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
// Safari on the Mac rehearses the phone in a narrow upright window: the editor's phone layout is under 900 px, upright.
if (process.env.L5_MAC) await call('POST', `${S}/window/rect`, { width: 430, height: 900 }).catch(() => undefined);
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
const FIND = `const names = arguments[0];
  const named = (e) => (e.getAttribute('aria-label') || e.textContent || '').trim();
  return [...document.querySelectorAll('button,[role=radio],[role=switch],[role=tab]')].find((e) => e.offsetParent !== null && names.some((n) => named(e) === n || named(e).startsWith(n + ','))) || null;`;
const tap = async (names, ms = 30_000) => {
  const list = [names].flat();
  await waitFor(`"${list[0]}"`, () => js(`${FIND.replace('return [', 'const el = [')} if (!el) return false; el.scrollIntoView({ block: 'nearest' }); el.click(); return true;`, list), ms);
};
const tool = (name) => js(`const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => e.textContent.trim() === arguments[0]); if (t) { t.scrollIntoView({ inline: 'nearest' }); t.click(); } return !!t;`, name);
const done = () => js("const b = document.querySelector('.sheet .sheet-head .ck-btn'); if (b) b.click();");

const result = { site: URL_, device: process.env.L5_MAC ? 'Safari on the Mac' : 'iPhone', when: new Date().toISOString(), checks: [], errors: [] };

const pick = () => js("const el = document.querySelector('.tl-row.main .clip'), r = el.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0 }; el.dispatchEvent(new PointerEvent('pointerdown', { ...at, buttons: 1 })); el.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 })); el.click();");
const back = () => js("const b = document.querySelector('.toolbar .tool-back'); if (b) b.click();");

try {
  await call('POST', `${S}/url`, { url: URL_ });
  await js("localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1'); localStorage.setItem('kadr.iosFormatCard.v1', '1');");
  await call('POST', `${S}/url`, { url: URL_ });
  await js("window.__errs = []; addEventListener('error', (e) => window.__errs.push(String(e.message).slice(0, 200))); addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason && (e.reason.message || e.reason)).slice(0, 200)));");
  result.version = await waitFor('the version', () => js("const m = (document.querySelector('.home-foot') || {}).textContent?.match(/v\\d+\\.\\d+\\.\\d+/); return m && m[0];"), 30_000);
  console.log(`site ${URL_}: ${result.version}`);
  // V-148: on an iPhone nothing promises «Поделиться → Kadr» — the install card needs beforeinstallprompt, which Safari never sends.
  await sleep(1000);
  const promise = await js("return { card: !!document.querySelector('.ck-home-install'), text: document.body.innerText.includes('«Поделиться» в галерее') }");
  check('V-148: Home promises no «Поделиться → Kadr» on an iPhone (no install card)', !promise.card && !promise.text, JSON.stringify(promise));
  await tap('Открыть пример');
  await waitFor('the sample', () => js("return !!document.querySelector('.preview-canvas') && document.querySelectorAll('.tl-row.main .clip').length > 0"), 90_000);
  await sleep(1500);
  result.viewport = await js('return [innerWidth, innerHeight]');

  // ---- UI-2: the size of a one-tap export in the header, the settings before anything renders ----
  const head = await js(`const s = document.querySelector('.topbar .ck-editor-size'), e = [...document.querySelectorAll('.topbar .ck-primary')][0], n = document.querySelector('.ck-editor-name');
    if (!s) return null; const r = s.getBoundingClientRect(), er = e.getBoundingClientRect(), st = getComputedStyle(n), c = document.createElement('canvas').getContext('2d'); c.font = st.fontWeight + ' ' + st.fontSize + ' ' + st.fontFamily;
    return { text: s.textContent.trim(), name: s.getAttribute('aria-label'), w: Math.round(r.width), h: Math.round(r.height), left: r.right <= er.left, room: Math.round(n.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight)), need: Math.round(c.measureText('Поход на Алт').width), sideways: document.documentElement.scrollWidth > innerWidth };`);
  check('UI-2: the header names the size of a one-tap export, left of «Экспорт», 44 px, twelve letters of the name, nothing sideways', !!head && /^(720p|1080p|2K|4K)$/.test(head.text) && head.w >= 44 && head.h >= 44 && head.left && head.room >= head.need && !head.sideways, JSON.stringify(head));
  await shot('ui2-header');
  await js("document.querySelector('.topbar .ck-editor-size').click();");
  await waitFor('the export settings', () => js("const b = [...document.querySelectorAll('.sheet button')].find((x) => x.textContent.startsWith('Экспортировать видео')); return !!b && !b.disabled;"), 20_000);
  await sleep(600);
  const sizes = await js(`const s = document.querySelector('.sheet'), h = [...s.querySelectorAll('h3')].find((x) => x.textContent === 'Разрешение'), f = s.querySelector('.ck-panel-foot');
    return { chipsBottom: Math.round(h.nextElementSibling.getBoundingClientRect().bottom), fadeTop: Math.round(f.getBoundingClientRect().top - 24), checked: h.nextElementSibling.querySelector('[aria-checked=true]')?.textContent, rendering: !!s.querySelector('.ck-work-frame') };`);
  check('UI-2: the size opens the settings with nothing rendered, the sizes in sight above the held button, the same size chosen', sizes.chipsBottom <= sizes.fadeTop && !sizes.rendering && sizes.checked === head?.text, JSON.stringify(sizes));
  await shot('ui2-settings');
  await done();
  await sleep(600);

  // ---- UI-6: a new text in the Russian interface ----
  await waitFor('«Текст»', () => tool('Текст'), 10_000);
  const word = await waitFor('the text field', () => js("const f = document.querySelector('.sheet textarea'); return f && f.value;"), 10_000);
  check('UI-6: a new text starts with «Ваш текст»', word === 'Ваш текст', word);
  await js("document.querySelector('.transport button[aria-label=\"Отменить\"]')?.click()");
  await done();
  await sleep(600);

  // ---- UI-7 and SW-U-4, SW-U-3: a piece picked ----
  await pick();
  await waitFor('the clip selected', () => js("return !!document.querySelector('.tl-row.main .clip.sel')"), 10_000);
  await sleep(500);
  const handle = await js(`const h = document.querySelector('.ck-stage-handle').getBoundingClientRect(), s = document.querySelector('.ck-stage').getBoundingClientRect();
    return { bottom: Math.round(h.bottom), stageBottom: Math.round(s.bottom), right: Math.round(h.right), stageRight: Math.round(s.right) };`);
  check('SW-U-3: the corner handle stands whole on the stage', handle.bottom <= handle.stageBottom + 1 && handle.right <= handle.stageRight + 1, JSON.stringify(handle));
  const ribbon = await js(`const t = document.querySelector('.toolbar .ck-ribbon-tools'); const read = () => ({ start: t.hasAttribute('data-more-start'), end: t.hasAttribute('data-more-end') });
    t.scrollLeft = 0; const a = read(); t.scrollLeft = t.scrollWidth; return new Promise((r) => setTimeout(() => { const b = read(); t.scrollLeft = 0; r({ atStart: a, atEnd: b }); }, 300));`);
  check('SW-U-4: the ribbon fades only where more tools lie, nothing at the end', ribbon.atStart.end && !ribbon.atStart.start && !ribbon.atEnd.end, JSON.stringify(ribbon));
  await shot('swu3-handle');
  for (const name of ['Фильтры', 'Настройка', 'Трансформация']) {
    await waitFor(`«${name}»`, () => tool(name), 10_000);
    await waitFor(`the sheet ${name}`, () => js("return !!document.querySelector('.sheet')"), 10_000);
    await sleep(900);
    const m = await js(`const top = document.querySelector('.ck-editor-top'), c = document.querySelector('.preview-canvas').getBoundingClientRect(), v = document.querySelector('.sheet [role=slider]')?.getBoundingClientRect();
      return { header: Math.round(top.getBoundingClientRect().height), inert: top.inert, frame: +(c.width * c.height / (innerWidth * innerHeight) * 100).toFixed(1), valueBottom: v && Math.round(v.bottom), vh: innerHeight };`);
    check(`UI-7: «${name}» — the header folds, the value is in sight, the frame keeps 15 % of Safari's visible height or more`, m.header === 0 && m.inert && m.valueBottom <= m.vh && m.frame >= 15, JSON.stringify(m));
    await shot(`ui7-${name}`);
    await done();
    await sleep(600);
  }

  // ---- Q-33 and SW-U-1: a swipe of the sheet's header closes it; a swipe the browser cancels springs back ----
  const swipe = (cancel) => js(`const h = document.querySelector('.sheet .ck-panel-head'), r = h.getBoundingClientRect(), x = r.left + 80, y0 = r.top + 14;
    const ev = (type, y, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0, buttons });
    h.dispatchEvent(ev('pointerdown', y0, 1)); for (let i = 1; i <= 10; i++) h.dispatchEvent(ev('pointermove', y0 + i * 24, 1));
    h.dispatchEvent(ev(arguments[0] ? 'pointercancel' : 'pointerup', y0 + 240, 0)); return true;`, cancel);
  await waitFor('«Трансформация»', () => tool('Трансформация'), 10_000);
  await sleep(900);
  await swipe(true);
  await sleep(500);
  const kept = await js("const s = document.querySelector('.sheet'); return !!s && !s.style.transform");
  check('SW-U-1: a swipe the browser cancels springs the sheet back', kept);
  await swipe(false);
  await sleep(700);
  check('Q-33: a swipe down the header closes the sheet', await js("return !document.querySelector('.sheet')"));
  await back();
  const errs = await js('return window.__errs');
  check('no page errors', errs.length === 0, errs.join(' | '));
} catch (e) {
  result.failed = String(e.message || e);
  console.error(`L5: ${result.failed}`);
  await shot('failed').catch(() => undefined);
} finally {
  writeFileSync(join(OUT, 'result.json'), JSON.stringify(result, null, 2));
  await call('DELETE', S).catch(() => undefined);
  driver.kill();
}
console.log(`screenshots and result.json in ${OUT}`);
// What a script cannot do on a phone: a finger, the system's Home gesture, a pick from Photos (reports/L5 — очередь.md, U).
console.log(`
By hand, on the phone, after this run:
  1. SW-U-1  «Трансформация»: drag the sheet's header half way down and, still holding, carry the finger to the Home bar — the sheet springs back.
  2. SW-U-3  pick the sample's piece; drag the corner handle with a finger — the piece scales.
  3. UI-3, UI-9  drag the Scale of «Трансформация» with a finger — the value changes; take a trim handle 15 px off its centre.
  4. SW-U-8  new project 9:16 → «Медиа» → a landscape video from Photos: the note is a strip between the frame and Undo/Play,
     «Заполнить кадр» fills the frame, Undo brings the bars back; a text added then follows the finger on the frame.
  5. V-148  Photos → any video → Share: Kadr is not in the list (with Kadr on the Home Screen too, if it is there).
     After the release that carries V-148: …/Kadr/ru/ → «Как добавить видео» is there and reads at the phone's width.`);
process.exit(result.failed || result.checks.some((c) => !c.ok) ? 1 : 0);
