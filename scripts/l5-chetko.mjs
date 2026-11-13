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
  const back = async () => { await js("const c = document.querySelector('[aria-label=\"Назад: закрыть инструменты\"]'); if (c) c.click();"); await sleep(500); };
  // Each part of releases 8–12 on its own: one that cannot run is a red line, and the rest still run.
  const part = async (name, fn) => { try { await fn(); } catch (e) { check(name, false, String(e.message || e).slice(0, 200)); } };
  // A finger held on an element at (fx, fy) of its box, moved by dy; it stays down until `lift`.
  const hold = (css, fx, fy, dy = 0) => js(`const el = document.querySelector(arguments[0]); el.scrollIntoView({ block: 'center' }); const r = el.getBoundingClientRect();
    const x = r.left + r.width * arguments[1], y = r.top + r.height * arguments[2];
    const ev = (type, yy, buttons) => new PointerEvent(type, { bubbles: true, cancelable: true, clientX: x, clientY: yy, pointerId: 11, pointerType: 'touch', isPrimary: true, button: 0, buttons });
    el.dispatchEvent(ev('pointerdown', y, 1)); for (let i = 1; i <= 6; i++) el.dispatchEvent(ev('pointermove', y + (arguments[3] * i) / 6, 1)); return true;`, css, fx, fy, dy);
  const lift = (css) => js("const el = document.querySelector(arguments[0]); if (el) el.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 11, pointerType: 'touch', isPrimary: true }));", css);

  // ---- release 8: a plain toast on the phone is a dark plate, not white words on the video ----
  await back();
  await part('toast: a plain toast is a dark plate', async () => {
    await js("localStorage.removeItem('kadr.hint.move')");
    await waitFor('«Текст»', () => tool('Текст'), 10_000);
    const x = await waitFor('the toast', () => js("const e = document.querySelector('.toast.info'); if (!e) return null; const s = getComputedStyle(e); return { bg: s.backgroundColor, pad: parseFloat(s.paddingTop), text: e.textContent.slice(0, 48) };"), 10_000);
    check('toast: a plain toast is a dark plate with room round its words', x.bg !== 'rgba(0, 0, 0, 0)' && x.pad >= 12, JSON.stringify(x));
    await shot('toast');
  });
  // The text sheet's styles are drawn as tiles by the phone (the toast's shot caught them black, before their first draw).
  await part('text styles: the tiles', async () => {
    await sleep(2500);
    const tl = await js(`const vis = [...document.querySelectorAll('.sheet .ck-ptile-art canvas')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 0 && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight; });
      const drawn = vis.filter((c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 0; i < d.length; i += 16) if (d[i] + d[i + 1] + d[i + 2] > 120) return true; } catch { /* a WebGL canvas */ } return false; }).length;
      return { seen: vis.length, drawn };`);
    check('text styles: the tiles in view are drawn by the phone (letters on the black)', tl.seen > 0 && tl.drawn === tl.seen, JSON.stringify(tl));
    await shot('text-styles');
  });

  // ---- release 11: the spectrum's loupe drawn by the phone, in view at the top edge of the field too ----
  await part('spectrum: the loupe', async () => {
    await waitFor('the text sheet', () => js("const b = document.querySelector('.sheet [data-tool=spectrum]'); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true;"), 10_000);
    await waitFor('the spectrum', () => js("return !!document.querySelector('.sheet .ck-spectrum-field')"), 10_000);
    const loupe = async (fy) => {
      await hold('.sheet .ck-spectrum-field', 0.6, fy);
      await sleep(400);
      return js(`const l = document.querySelector('.ck-loupe'), c = l && l.querySelector('canvas'); if (!c) return null; const r = l.getBoundingClientRect();
        const d = c.getContext('2d').getImageData(Math.floor(c.width / 2) - 12, Math.floor(c.height / 2) - 12, 1, 1).data;
        return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), right: Math.round(r.right), vh: innerHeight, vw: innerWidth, pixel: [d[0], d[1], d[2], d[3]], code: document.querySelector('.sheet .ck-spectrum-code').value };`);
    };
    const mid = await loupe(0.5);
    await shot('spectrum');
    await lift('.sheet .ck-spectrum-field');
    const top = await loupe(0.02);
    await lift('.sheet .ck-spectrum-field');
    const inView = (l) => l && l.top >= 0 && l.bottom <= l.vh && l.left >= 0 && l.right <= l.vw;
    check('spectrum: the loupe is drawn by the phone and in view', !!mid && mid.pixel[3] > 0 && inView(mid), JSON.stringify(mid));
    check('spectrum: at the top edge of the field the loupe stays in view', inView(top), JSON.stringify(top));
    await js("const b = document.querySelector('.sheet [data-tool=spectrum]'); if (b) b.click();");
  });
  await done();
  await sleep(500);

  // ---- release 11: the speed curve to a finger — a touch in a point's column takes it, its value shows while held ----
  await back();
  await part('curve: a finger on a point', async () => {
    await js("const el = document.querySelector('.tl-row.main .clip'), r = el.getBoundingClientRect(); const at = { bubbles: true, cancelable: true, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2, pointerId: 7, pointerType: 'touch', isPrimary: true, button: 0, buttons: 1 }; el.dispatchEvent(new PointerEvent('pointerdown', at)); el.dispatchEvent(new PointerEvent('pointerup', { ...at, buttons: 0 })); el.click();");
    await waitFor('the clip selected', () => js("return !!document.querySelector('.tl-row.main .clip.sel')"), 10_000);
    await waitFor('«Скорость»', () => tool('Скорость'), 10_000);
    await tap('Кривая');
    await waitFor('the curve', () => js("return !!document.querySelector('.sheet .ck-curve')"), 10_000);
    const dots = await js("return document.querySelectorAll('.sheet .ck-curve-dot').length");
    // The middle point's column, a finger 1/5 of the height up: the value changes only as the finger moves.
    const col = await js("const s = document.querySelector('.sheet .ck-curve'), d = [...s.querySelectorAll('.ck-curve-dot')], m = d[Math.floor(d.length / 2)], r = s.getBoundingClientRect(), b = m.getBoundingClientRect(); return [(b.left + b.width / 2 - r.left) / r.width, (b.top + b.height / 2 - r.top) / r.height];");
    await hold('.sheet .ck-curve', col[0] + 0.03, col[1], -24);
    await sleep(400);
    const v = await js("const d = [...document.querySelectorAll('.sheet .ck-curve-dot')]; return { held: document.querySelector('.sheet .ck-curve-value')?.textContent ?? null, point: d[Math.floor(d.length / 2)].getAttribute('aria-valuetext') };");
    await shot('curve');
    await lift('.sheet .ck-curve');
    check('curve: a finger near a point takes it and its value shows while held', dots > 0 && !!v.held && v.held.trim().endsWith('×'), `${dots} points; held ${v.held}; the point says ${v.point}`);
    await tap('Обычная');
  });
  await done();
  await sleep(500);

  // ---- release 10: the music library and the stickers on the phone's screen ----
  await back();
  await part('music: the library', async () => {
    await waitFor('«Музыка»', () => tool('Музыка'), 10_000);
    const m = await waitFor('the tracks', () => js("const rows = [...document.querySelectorAll('.sheet .ck-track')]; if (!rows.length) return null; const r = rows[0].getBoundingClientRect(), b = rows[0].querySelector('.ck-listen').getBoundingClientRect(); return { rows: rows.length, row: Math.round(r.height), listen: [Math.round(b.width), Math.round(b.height)], sideways: document.querySelector('.sheet .ck-panel-body').scrollWidth > document.querySelector('.sheet .ck-panel-body').clientWidth };"), 20_000);
    check('music: tracks are rows 56 px with a listen button 44 px, nothing sideways', m.rows > 0 && m.row >= 56 && m.listen[0] >= 44 && m.listen[1] >= 44 && !m.sideways, JSON.stringify(m));
    await shot('music');
  });
  await done();
  await sleep(500);
  await back();
  await part('stickers', async () => {
    if (!(await tool('Стикеры'))) { await tap('Все'); await tap('Стикеры'); }
    const s = await waitFor('the stickers', () => js("const t = [...document.querySelectorAll('.sheet .ck-sticker')]; if (!t.length) return null; const r = t[0].getBoundingClientRect(); return { tiles: t.length, size: [Math.round(r.width), Math.round(r.height)] };"), 10_000);
    check('stickers: square tiles at least 44 px', s.tiles > 0 && s.size[0] >= 44 && Math.abs(s.size[0] - s.size[1]) <= 1, JSON.stringify(s));
    await shot('stickers');
  });
  await done();
  await sleep(500);

  // ---- release 6: the export's film of the file's own frames, on the phone's encoder ----
  await back();
  await tap('Экспорт');
  const seen = [];
  const t0 = Date.now();
  await waitFor('the file', async () => {
    // The percent and the film are read in one call, as one look of the screen: read apart, a phone's export (55% a second
    // on v1.9.5) ran a slot ahead between the two round trips and the film seemed to lead the percent (L5, 2026-11-13).
    const s = await js(`const bar = document.querySelector('.sheet .ck-work [role=progressbar]');
      const n = [...document.querySelectorAll('.sheet .ck-work-frame')].filter((c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 16) if (d[i]) return true; } catch { /* a WebGL canvas */ } return false; }).length;
      return { pct: bar ? Number(bar.getAttribute('aria-valuenow')) : null, n, ready: !!document.querySelector('.sheet .ck-work-ready'), failed: !!document.querySelector('.sheet .error-text') };`);
    if (s.pct !== null && !s.ready) seen.push([s.pct, s.n]);
    // On the first look: a 720p export of the sample takes about 1.2 s on an iPhone 15, and by the third look the
    // screenshot (a round trip of its own) caught the finished sheet (L5 v1.9.7: «running» and «done» were one picture).
    if (seen.length === 1) await shot('export-running');
    if (s.failed) throw new Error('the export failed: ' + await js("return document.querySelector('.sheet .error-text').textContent"));
    return s.ready;
  }, 300_000);
  const took = Math.round((Date.now() - t0) / 100) / 10;
  await sleep(400);
  const end = await js("return { ready: document.querySelector('.sheet .ck-work-ready')?.textContent, facts: document.querySelector('.sheet .ck-work .ck-hint')?.textContent }");
  const frames = await painted('.sheet .ck-work-frame');
  check('export: the film fills with the file\'s own frames as it is made', seen.length > 0 && seen.every(([p, n]) => n <= Math.floor(((p + 3) / 100) * 8) + 1), `${seen.length} looks: ${seen.slice(0, 8).map(([p, n]) => `${p}%:${n}`).join(' ')}`);
  check('export: the whole film stays when the file is ready', frames === 8, `${frames} of 8 painted; ${end.ready}; ${end.facts}; ${took} s`);
  // After L5 v1.9.7: the state and what the file is stand above the held foot's 24 px fade, and «export again» is the
  // chevron before the sheet's name, on screen (it was under «Сохранить», seen only after a scroll). One look.
  const fit = await js(`const r = (s) => document.querySelector(s)?.getBoundingClientRect(), foot = r('.sheet .ck-panel-foot'), back = r('.sheet .ck-panel-back button');
    return { footTop: foot && Math.round(foot.top), ready: Math.round(r('.sheet .ck-work-ready').bottom), facts: r('.sheet .ck-work-facts') && Math.round(r('.sheet .ck-work-facts').bottom), back: back && [Math.round(back.left), Math.round(back.width), Math.round(back.bottom)], vh: innerHeight };`);
  check('export: «Файл готов» and what the file is stand above the fade of the held foot; the chevron back is on screen',
    fit.footTop !== null && fit.facts !== null && fit.facts <= fit.footTop - 24 && fit.ready <= fit.footTop - 24 && !!fit.back && fit.back[1] >= 44 && fit.back[2] <= fit.vh, JSON.stringify(fit));
  await shot('export-done');
  result.errors = await js('return window.__errs || []');
  check('no page errors', result.errors.length === 0, result.errors.join(' | '));

  // ---- release 12: the screens for support on the phone — ?diag and ?styles, on the system, nothing sideways ----
  const page = URL_.replace(/[?#].*$/, '');
  await part('diag', async () => {
    await call('POST', `${S}/url`, { url: `${page}?diag` });
    const d = await waitFor('?diag', () => js("const h = document.querySelector('.ck-diag h1'); return h && { title: h.textContent.trim(), sideways: document.documentElement.scrollWidth > innerWidth };"), 30_000);
    check('diag: the page is on the system, nothing scrolls sideways', !d.sideways, JSON.stringify(d));
    await shot('diag');
  });
  await part('styles', async () => {
    await call('POST', `${S}/url`, { url: `${page}?styles` });
    await waitFor('?styles', () => js("return document.querySelectorAll('.ck-thumbs canvas').length > 0"), 30_000);
    // The page adds its drawings as it makes them: count when the number has stopped growing, in one look.
    let last = -1;
    await waitFor('every drawing', async () => { const n = await js("return document.querySelectorAll('.ck-thumbs canvas').length"); const still = n === last; last = n; if (!still) await sleep(2000); return still; }, 120_000);
    const st = await js(`const all = [...document.querySelectorAll('.ck-thumbs canvas')];
      const drawn = all.filter((c) => { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 16) if (d[i]) return true; } catch { /* a WebGL canvas */ } return false; }).length;
      const pre = document.querySelector('[data-testid=styles-summary]');
      return { n: all.length, drawn, sideways: document.documentElement.scrollWidth > innerWidth, cut: pre ? pre.scrollWidth > pre.clientWidth + 1 : null };`);
    check('styles: the phone draws every template, nothing scrolls sideways', st.n > 0 && st.drawn === st.n && !st.sideways, `${st.drawn} of ${st.n} drawn; sideways ${st.sideways}`);
    check('styles: the report wraps inside the screen, no line is cut at its edge', st.cut === false, `cut ${st.cut}`);
    await shot('styles');
  });
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
