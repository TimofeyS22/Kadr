// L5 of the Chetko screens (docs/17 Ч4): what the releases changed, on a real iPhone through Safari's WebDriver — the
// values on the Scale (a finger's drag, the playhead left where it was), the mask's tiles drawn by the phone's GPU, the
// export's film of the file's own frames from the phone's encoder, and (on a build that has it) the frame's field.
// Taps and drags are dispatched in the page as touch pointer events: safaridriver's own touches arrive as long presses.
//   node scripts/l5-chetko.mjs [site URL]     Env: L5_UDID, L5_OUT (screenshots), L5_MAC=1 (Safari on this Mac)
// The phone: unlocked, Settings › Safari › Advanced › Web Inspector and Remote Automation on.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const URL_ = process.argv[2] ?? 'https://timofeys22.github.io/Kadr/';
const OUT = process.env.L5_OUT ?? join(process.env.TMPDIR ?? '/tmp', 'kadr-l5-chetko');
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
/** How many canvases under `css` have anything drawn. */
const painted = (css) => js(`return [...document.querySelectorAll(arguments[0])].filter((c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 16) if (d[i]) return true; } catch { /* a WebGL canvas */ } return false; }).length`, css);

const result = { site: URL_, device: process.env.L5_MAC ? 'Safari on the Mac' : 'iPhone', when: new Date().toISOString(), checks: [], errors: [] };
const check = (name, ok, detail) => { result.checks.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`); };

try {
  await call('POST', `${S}/url`, { url: URL_ });
  await js("localStorage.setItem('kadr.locale', 'ru'); localStorage.setItem('kadr.tips', '99'); localStorage.setItem('kadr.hint.move', '1'); localStorage.setItem('kadr.undoMoved.v1', '1'); localStorage.setItem('kadr.iosVideoTip.v3', '1'); localStorage.setItem('kadr.iosFormatCard.v1', '1');");
  await call('POST', `${S}/url`, { url: URL_ });
  await js("window.__errs = []; addEventListener('error', (e) => window.__errs.push(String(e.message).slice(0, 200))); addEventListener('unhandledrejection', (e) => window.__errs.push(String(e.reason && (e.reason.message || e.reason)).slice(0, 200)));");
  result.version = await waitFor('the version', () => js("const m = (document.querySelector('.home-foot') || {}).textContent?.match(/v\\d+\\.\\d+\\.\\d+/); return m && m[0];"), 30_000);
  console.log(`site ${URL_}: ${result.version}`);
  await tap('Открыть пример');
  await waitFor('the sample', () => js("return !!document.querySelector('.preview-canvas') && document.querySelectorAll('.tl-row.main .clip').length > 0"), 90_000);
  await sleep(1500);

  // ---- release 8, where the build has it: the field and the frame ----
  if (await js("return !!document.querySelector('.ck-stage')")) {
    const f = await js(`const p = document.querySelector('.preview'), c = document.querySelector('.preview-canvas'), x = document.createElement('canvas').getContext('2d');
      x.fillStyle = getComputedStyle(p).backgroundColor; x.fillRect(0, 0, 1, 1); const [r, g, b] = x.getImageData(0, 0, 1, 1).data;
      return { field: [r, g, b], radius: getComputedStyle(c).borderRadius, line: getComputedStyle(c).boxShadow };`);
    check('frame: the field is black, the frame square with no line', f.field.join() === '0,0,0' && f.radius === '0px' && f.line === 'none', JSON.stringify(f));
    await shot('frame');
  }

  // ---- release 7: the values of «Трансформация» on the Scale ----
  await js("const el = document.querySelector('.tl-row.main .clip'), r = el.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }; el.dispatchEvent(new PointerEvent('pointerdown', at)); el.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 })); el.click();");
  await waitFor('the clip selected', () => js("return !!document.querySelector('.tl-row.main .clip.sel')"), 10_000);
  await waitFor('«Трансформация»', () => tool('Трансформация'), 10_000);
  await waitFor('the Scale', () => js("return !!document.querySelector('.sheet .ck-values .ck-scale-strip')"), 10_000);
  await sleep(500);
  const tabs = await js("return [...document.querySelectorAll('.sheet .ck-values [role=tab]')].map((t) => t.textContent.trim())");
  check('values: «Трансформация» is tabs over one Scale', tabs.length === 5, tabs.join(' · '));
  const time0 = await js("return document.querySelector('.time')?.textContent");
  // A finger's drag on the strip: 60 px to the left raises the value (the strip moves under the needle).
  const drag = await js(`const s = document.querySelector('.sheet .ck-values .ck-scale-strip'), r = s.getBoundingClientRect(), y = r.top + r.height / 2, x0 = r.left + r.width / 2;
    const ev = (type, x, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: y, pointerId: 9, pointerType: 'touch', isPrimary: true, button: 0, buttons });
    const before = Number(s.getAttribute('aria-valuenow'));
    s.dispatchEvent(ev('pointerdown', x0, 1));
    for (let i = 1; i <= 12; i++) s.dispatchEvent(ev('pointermove', x0 - i * 5, 1));
    s.dispatchEvent(ev('pointerup', x0 - 60, 0));
    return { before, after: Number(s.getAttribute('aria-valuenow')) };`);
  await sleep(300);
  const time1 = await js("return document.querySelector('.time')?.textContent");
  check('values: a drag of the strip sets the value', drag.after > drag.before, `${drag.before} → ${drag.after}`);
  check('values: the playhead stays where it was', time0 === time1, `${time0} / ${time1}`);
  const tabNote = await js("return !!document.querySelector('.sheet .ck-values [role=tab][aria-selected=true] .ck-tab-note')");
  check('values: the changed tab is marked', tabNote);
  await shot('transform');
  await tap('Сбросить');
  await done();
  await sleep(500);

  // ---- release 7: the mask's shapes as tiles of the frame ----
  await waitFor('«Маска»', () => tool('Маска'), 10_000);
  await waitFor('the mask tiles', () => js("return document.querySelectorAll('.sheet .ck-mask-tiles canvas').length === 4"), 10_000);
  await sleep(3000);
  const corner = (name) => js(`const t = [...document.querySelectorAll('.sheet .ck-mask-tiles [role=radio]')].find((e) => e.textContent.trim() === arguments[0]); const c = t && t.querySelector('canvas'); if (!c) return -1; const [r, g, b] = c.getContext('2d').getImageData(2, 2, 1, 1).data; return r + g + b;`, name);
  const none = await corner('Нет'), circle = await corner('Круг');
  check('mask: the tiles are drawn on the phone (the frame in «Нет», a dark corner in «Круг»)', none > 150 && circle >= 0 && circle < 60, `corner sums: Нет ${none}, Круг ${circle}`);
  await tap('Круг');
  await sleep(800);
  await shot('mask');
  await tap('Нет');
  await done();
  await sleep(500);

  // ---- release 6: the export's film of the file's own frames, on the phone's encoder ----
  await js("const c = document.querySelector('[aria-label=\"Назад: закрыть инструменты\"]'); if (c) c.click();");
  await sleep(500);
  await tap('Экспорт');
  const seen = [];
  const t0 = Date.now();
  await waitFor('the file', async () => {
    const s = await js(`const bar = document.querySelector('.sheet .ck-work [role=progressbar]');
      return { pct: bar ? Number(bar.getAttribute('aria-valuenow')) : null, ready: !!document.querySelector('.sheet .ck-work-ready'), failed: !!document.querySelector('.sheet .error-text') };`);
    if (s.pct !== null && !s.ready) seen.push([s.pct, await painted('.sheet .ck-work-frame')]);
    if (seen.length === 3) await shot('export-running');
    if (s.failed) throw new Error('the export failed: ' + await js("return document.querySelector('.sheet .error-text').textContent"));
    return s.ready;
  }, 300_000);
  const took = Math.round((Date.now() - t0) / 100) / 10;
  await sleep(400);
  const end = await js("return { ready: document.querySelector('.sheet .ck-work-ready')?.textContent, facts: document.querySelector('.sheet .ck-work .ck-hint')?.textContent }");
  const frames = await painted('.sheet .ck-work-frame');
  check('export: the film fills with the file\'s own frames as it is made', seen.length > 0 && seen.every(([p, n]) => n <= Math.floor(((p + 3) / 100) * 8) + 1), `${seen.length} looks: ${seen.slice(0, 8).map(([p, n]) => `${p}%:${n}`).join(' ')}`);
  check('export: the whole film stays when the file is ready', frames === 8, `${frames} of 8 painted; ${end.ready}; ${end.facts}; ${took} s`);
  await shot('export-done');
  result.errors = await js('return window.__errs || []');
  check('no page errors', result.errors.length === 0, result.errors.join(' | '));
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
