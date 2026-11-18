// L5 of lane U on v1.9.14: SW-U-11 (the black-bars note as one raised row, the frame's edge drawn while it is up) and
// V-148 (the site's «Как добавить видео»). A video from Photos is a manual step, so the first piece is a landscape picture
// drawn in the page and dropped on the editor: the note answers a picture as it answers a video. Taps are page events.
//   node scripts/l5-u-1914.mjs [site URL]     Env: L5_UDID, L5_OUT (screenshots), L5_MAC=1 (Safari on this Mac)
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? 'https://timofeys22.github.io/Kadr/';
const OUT = process.env.L5_OUT ?? join(process.env.TMPDIR ?? '/tmp', 'kadr-l5-sweep-u');
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.L5_PORT ?? 4452);

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


const result = { site: URL_, device: process.env.L5_MAC ? 'Safari on the Mac' : 'iPhone', when: new Date().toISOString(), checks: [] };
const check = (name, ok, detail) => { result.checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

try {
  await call('POST', `${S}/url`, { url: URL_ });
  await js("localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1'); localStorage.setItem('kadr.iosFormatCard.v1', '1');");
  await call('POST', `${S}/url`, { url: URL_ });
  result.version = await waitFor('the version', () => js("const m = (document.querySelector('.home-foot') || {}).textContent?.match(/v\\d+\\.\\d+\\.\\d+/); return m && m[0];"), 30_000);
  console.log(`site ${URL_}: ${result.version}`);
  // ---- SW-U-11: a new 9:16 project, a landscape picture as its first piece ----
  await tap('Новый проект');
  await sleep(700);
  await waitFor('9:16', () => js("const c = [...document.querySelectorAll('.aspect-card, button')].find((b) => b.textContent.includes('9:16') && b.offsetParent); if (c) c.click(); return !!c;"), 10_000);
  await waitFor('the editor', () => js("return !!document.querySelector('.preview-canvas')"), 30_000);
  await sleep(800);
  await js(`const c = Object.assign(document.createElement('canvas'), { width: 1920, height: 1080 }); const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 1920, 0); grad.addColorStop(0, '#2b4d8c'); grad.addColorStop(0.5, '#c06a3a'); grad.addColorStop(1, '#e8c26a'); g.fillStyle = grad; g.fillRect(0, 0, 1920, 1080);
    return new Promise((ok) => c.toBlob((b) => { const dt = new DataTransfer(); dt.items.add(new File([b], 'landscape.png', { type: 'image/png' })); const ed = document.querySelector('.editor');
      for (const t of ['dragenter', 'dragover', 'drop']) ed.dispatchEvent(new DragEvent(t, { dataTransfer: dt, bubbles: true, cancelable: true })); ok(true); }, 'image/png'));`);
  await waitFor('the note', () => js("return !!document.querySelector('.ck-frame-fit')"), 30_000);
  await sleep(1200);
  const m = await js(`const n = document.querySelector('.ck-frame-fit'), c = document.querySelector('.preview-canvas'), r = n.getBoundingClientRect(), cs = getComputedStyle(c);
    const btn = (q) => { const b = [...n.querySelectorAll('button')].find((x) => (x.getAttribute('aria-label') || '').startsWith(q)); if (!b) return null; const br = b.getBoundingClientRect(); return { w: Math.round(br.width), h: Math.round(br.height), text: b.textContent.trim() }; };
    return { vh: innerHeight, vw: innerWidth, note: Math.round(r.height), noteBottom: Math.round(r.bottom), frame: [c.clientWidth, c.clientHeight], edge: cs.outlineStyle, edgeColour: cs.outlineColor,
      sr: n.querySelector('.ck-sr')?.textContent, first: n.firstElementChild?.className, fill: btn('Заполнить кадр'), format: btn('Формат кадра'), close: btn('Закрыть'), sideways: document.documentElement.scrollWidth > innerWidth };`);
  check('SW-U-11: the note is one row of 64 px in Safari, nothing sideways', m.note <= 64 && !m.sideways, JSON.stringify({ note: m.note, vh: m.vh, vw: m.vw }));
  check('SW-U-11: the 9:16 frame stays a picture to judge while the note is up (≥ 160 px wide)', m.frame[0] >= 160, JSON.stringify({ frame: m.frame }));
  check('SW-U-11: the frame\'s edge is drawn — a dashed line round it', m.edge === 'dashed', JSON.stringify({ edge: m.edge, colour: m.edgeColour }));
  check('SW-U-11: a screen reader hears the whole sentence first, the answers by their full names', m.first === 'ck-sr' && /^Видео шире кадра/.test(m.sr ?? '') && !!m.fill && m.fill.text === 'Заполнить' && !!m.format && m.format.text === '16:9' && !!m.close, JSON.stringify({ sr: m.sr, fill: m.fill, format: m.format, close: m.close }));
  check('SW-U-11: the answers take a finger (44 px)', [m.fill, m.format, m.close].every((b) => b && b.h >= 44 && b.w >= 44), JSON.stringify([m.fill, m.format, m.close]));
  await shot('swu11-note');
  await js("[...document.querySelectorAll('.ck-frame-fit button')].find((b) => b.getAttribute('aria-label') === 'Заполнить кадр').click()");
  await sleep(1200);
  const after = await js("return { note: !!document.querySelector('.ck-frame-fit'), edge: getComputedStyle(document.querySelector('.preview-canvas')).outlineStyle }");
  check('SW-U-11: «Заполнить» answers it — the note and the edge go', !after.note && after.edge === 'none', JSON.stringify(after));
  await shot('swu11-filled');
  // ---- V-148: the site says how a video gets in on an iPhone ----
  const site = new URL('ru/', URL_).href;
  await call('POST', `${S}/url`, { url: site });
  await sleep(1500);
  const hub = await js("const h = [...document.querySelectorAll('h2')].find((x) => x.textContent.trim() === 'Как добавить видео'); if (!h) return null; h.scrollIntoView({ block: 'center' }); return { p: h.nextElementSibling?.textContent, sideways: document.documentElement.scrollWidth > innerWidth };");
  check('V-148: the site\'s hub says how a video gets in on an iPhone and that Share will not list it', !!hub && /На iPhone — из «Фото» или «Файлов»/.test(hub.p ?? '') && /не появится/.test(hub.p ?? '') && !hub.sideways, JSON.stringify(hub));
  await sleep(500);
  await shot('v148-site');
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
process.exit(result.failed || result.checks.some((c) => !c.ok) ? 1 : 0);
