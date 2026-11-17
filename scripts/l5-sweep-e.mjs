// L5 of the verifying lanes E1–E4 of the sweep (docs/21; reports/L5 — очередь.md, sections E1 and E2): what only Safari on
// a real iPhone can say about rows closed on the Mac — two tabs of one project, the edit journal, exports at 1080p and 4K
// without the Baseline restart, the 2 s mixing windows, decoders kept open, a lost WebGL context, a cold start, and the
// smaller rows of P2–P3. Rows that need a finger, a system window, the network or another phone are printed at the end.
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-e.mjs [site URL]      (runner and env: scripts/l5-sweep.mjs)
//   Env: L5_REPS (3: rows «3 из 3»), L5_V258_WAIT (300 s in the background), L5_COLD_LOADS (5).
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { joinsOf, luma, make, probe } from './l5-session.mjs';
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, below, decoderChecks, equals, holds, joinChecks, judge, kOfN, none, record, wholeFile } from './l5-verdict.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REPS = Number(process.env.L5_REPS ?? 3);
/** Rows of l5-tools judged by a rule on each run's note, «k из k». */
const allRuns = (id, name, okOf) => (rows) => [judge(id, [kOfN(name, rows, (r) => r.ok && okOf(r.note ?? {}), rows.length), none('тосты и ошибки', rows.flatMap((r) => [...(r.toasts ?? []), ...(r.errors ?? []), ...(r.error ? [r.error] : [])]))])];
/** The Baseline restart of the exporter (exporter.ts: «starting the export again with H.264 Baseline»). */
const baseline = (warns) => warns.filter((w) => /Baseline/.test(w));
/** The green of the middle row of a picture at a fraction of its width (V-232, as e2e/editor.spec.ts reads the file). */
function greenAt(file, from, fracs) {
  const [w, h] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'v', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(',').map(Number);
  const raw = execFileSync('ffmpeg', ['-v', 'error', ...from, '-i', file, '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], { maxBuffer: 256 << 20 });
  return fracs.map((f) => raw[3 * (Math.floor(h / 2) * w + Math.floor(f * w)) + 1]);
}

await sweep({
  lane: 'e',
  title: 'строки E1–E4 (проверка P0–P3)',
  items: [
    {
      id: 'V-258', price: 1,
      // A edits, B (the same project, another tab) sleeps in the background, then B edits: B must say the project
      // changed elsewhere, and A's edit must stay in the stored project. «Kill and reopen» stays a manual step.
      run: async (c) => {
        const runs = [];
        for (let k = 0; k < REPS; k++) {
          await c.fresh(['landscape.mp4']);
          const id = await c.projectId();
          const a = await c.call('GET', `${c.S}/window`);
          const { handle: b } = await c.call('POST', `${c.S}/window/new`, { type: 'tab' });
          let seen;
          try {
            await c.call('POST', `${c.S}/window`, { handle: b });
            await c.call('POST', `${c.S}/url`, { url: `${c.url}#/p/${encodeURIComponent(id)}` });
            await c.waitFor('the project in tab B', () => c.js("return document.querySelectorAll('.tl-row.main .clip').length === 1"), 60_000);
            await c.watch();
            await c.call('POST', `${c.S}/window`, { handle: a });
            await c.selectClip();
            await c.seek(2);
            await sleep(600);
            await c.tool('Split');
            await c.waitFor('the split in A', async () => (await c.count('.tl-row.main .clip')) === 2, 15_000);
            await sleep(3000); // A's save lands
            await sleep(Number(process.env.L5_V258_WAIT ?? 300) * 1000);
            await c.call('POST', `${c.S}/window`, { handle: b });
            await sleep(2000);
            await c.selectClip().catch(() => undefined);
            await c.tool('Speed').then(() => c.tap('2×')).then(() => c.tap('Done')).catch(() => undefined);
            await sleep(3000);
            seen = await c.js("const d = [...document.querySelectorAll('[role=alertdialog], dialog')].find((x) => /changed in another tab/.test(x.textContent)); return { told: !!d, words: d ? d.textContent.slice(0, 120) : null };");
          } finally {
            await c.call('DELETE', `${c.S}/window`).catch(() => undefined);
            await c.call('POST', `${c.S}/window`, { handle: a });
          }
          const p = await c.stored();
          runs.push({ ...seen, clipsStored: p?.tracks.find((t) => t.kind === 'main').clips.length ?? 0 });
          await c.cleanup();
        }
        return runs;
      },
      judge: (m) => [kOfN('B говорит «changed in another tab»', m, (r) => r.told, REPS), kOfN('правка A на месте (2 клипа)', m, (r) => r.clipsStored === 2, REPS)],
    },
    {
      ids: ['V-120 · C-D1 (журнал)'], price: 1,
      tools: { name: 'tools-journal', scenarios: Array(5).fill('s1-journal') },
      // The script's share of the row (its threshold, written before the run): each edit is in the journal within 1 s,
      // so a tab iOS kills a moment later keeps it. The background of 10 min and the kill are manual.
      judge: allRuns('V-120 · C-D1 (журнал)', 'разрез в журнале ≤ 1000 мс', (n) => n.journaledWithinMs <= 1000),
    },
    {
      id: 'V-259 · C-B2', price: 2,
      run: async (c) => {
        const runs = [];
        for (let k = 1; k <= REPS; k++) {
          for (const [src, preset, tag] of [['phone_1080_h264.mp4', 'TikTok, Reels, Shorts', '1080p'], ['phone_4k_hevc.mov', 'Best quality', '4k']]) {
            await c.fresh([src], { aspect: '16:9' });
            const length = await c.timelineLength();
            const { file } = await c.exportAs({ preset, file: `v-259-${tag}-${k}.mp4` });
            const p = probe(file);
            runs.push({ tag, k, length, ...p, baseline: baseline((await c.page()).warns) });
            await c.cleanup();
          }
        }
        return runs;
      },
      judge: (m) => [
        kOfN('файл целый (ffprobe, длина ± 0,1 с, звук)', m, (r) => wholeFile(r, { duration: r.length }).every((x) => x.ok), 2 * REPS),
        kOfN('кодек H.264', m, (r) => r.codec === 'h264', 2 * REPS),
        atLeast('меньшая сторона 4K', Math.min(...m.filter((r) => r.tag === '4k').map((r) => Math.min(r.width, r.height))), 2160, ' px'),
        none('перезапуски «Baseline»', m.flatMap((r) => r.baseline)),
        record('профили', [...new Set(m.map((r) => `${r.tag} ${r.profile}`))].join(', ')),
      ],
    },
    {
      id: 'V-153', price: 2,
      run: async (c) => {
        await c.fresh(['tone1k.mp4']);
        const { file } = await c.exportAs({ preset: 'Small file', file: 'v-153-tone1k.mp4' });
        return { joins: joinsOf(file) };
      },
      judge: (m) => [...joinChecks(m.joins), record('стыки', m.joins.map((j) => `${j.at} с: ${j.lo.toFixed(2)}..${j.hi.toFixed(2)} дБ, ×${j.jump.toFixed(2)}`).join('; '))],
    },
    {
      id: 'V-116', price: 2,
      run: async (c) => {
        const runs = [];
        for (let k = 1; k <= REPS; k++) {
          await c.fresh(['phone_1080_h264.mp4']);
          await c.selectClip();
          await c.tool('Reverse');
          const at = await c.jsAsync(`const done = arguments[arguments.length - 1], t0 = performance.now();
            const tick = () => { const bar = document.querySelector('.busy [role=progressbar]'), v = Number(bar?.getAttribute('aria-valuenow') ?? 0);
              if (v >= 30) { const b = [...document.querySelectorAll('.busy button')].find((x) => x.textContent.trim() === 'Cancel'); if (b) b.click(); done(v); }
              else if (performance.now() - t0 > 120000) done(-1); else setTimeout(tick, 30); }; tick();`);
          await c.idle(30_000);
          await c.closeTools();
          const { file } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: `v-116-${k}.mp4` });
          runs.push({ cancelledAt: at, ...probe(file), baseline: baseline((await c.page()).warns) });
          await c.cleanup();
        }
        return runs;
      },
      judge: (m) => [kOfN('«Отмена» на 30 %', m, (r) => r.cancelledAt >= 30, REPS), kOfN('экспорт дошёл до файла H.264', m, (r) => r.codec === 'h264' && r.frames > 0, REPS), none('перезапуски «Baseline» (запасной путь)', m.flatMap((r) => r.baseline))],
    },
    {
      id: 'V-170', price: 2,
      // Five exports in a row, then captions, then one more export. The UI runs one job at a time: «at once» is a row
      // of jobs here, not two together.
      run: async (c) => {
        await c.fresh(['speech_en.mp4']);
        const files = [];
        for (let k = 1; k <= 5; k++) files.push(probe((await c.exportAs({ preset: 'Small file', file: `v-170-${k}.mp4` })).file));
        await c.tap('Captions');
        await c.waitFor('captions', async () => {
          await c.js("const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.textContent.trim() === 'Download and make captions'); if (b) b.click();");
          return (await c.count('.clip-caption')) >= 1;
        }, 600_000);
        await c.idle(120_000);
        await c.closeTools();
        files.push(probe((await c.exportAs({ preset: 'Small file', file: 'v-170-after-captions.mp4' })).file));
        const page = await c.page();
        return { frames: files.map((f) => f.frames), advice: page.notes.filter((n) => /Delete old projects|free up space|decoder of this device stopped/.test(n)), luma: luma(await c.previewShot('v-170-preview')) };
      },
      judge: (m) => [none('совет «удалите проекты» / «декодер остановился»', m.advice), kOfN('экспорт дошёл до файла', m.frames, (n) => n > 0, 6), atLeast('яркость превью', m.luma, 10)],
    },
    {
      id: 'V-190', price: 2,
      run: async (c) => {
        const photos = Array.from({ length: 40 }, (_, i) => make(c.out, `v-190-${String(i + 1).padStart(2, '0')}.jpg`, ['-f', 'lavfi', '-i', `testsrc2=s=4000x3000:r=1:d=1,hue=h=${i * 9}`, '-frames:v', '1', '-q:v', '3']));
        const runs = [];
        for (let k = 1; k <= REPS; k++) {
          await c.fresh(photos, { aspect: '16:9' });
          await c.waitFor('forty photos', async () => (await c.count('.tl-row.main .clip')) === 40, 300_000);
          const length = await c.timelineLength();
          const { file } = await c.exportAs({ preset: 'Best quality', file: `v-190-4k-${k}.mp4`, ms: 1_200_000 });
          runs.push({ length, ...probe(file) });
          await c.cleanup();
        }
        return runs;
      },
      judge: (m) => [kOfN('файл 4K целый (длина ± 0,1 с)', m, (r) => r.height >= 2160 && Math.abs(r.duration - r.length) <= 0.1 && r.frames > 0, REPS)],
    },
    {
      id: 'C-C3 (холодный старт, iPhone 15)', price: 3, newSession: true,
      // Each WebDriver session starts with empty site data: the first load is a cold one. The home screen is timed by the
      // page's own clock at the first look after the load event (an upper bound); the sample in the page, exactly.
      run: async (c) => {
        const loads = [];
        for (let k = 1; k <= Number(process.env.L5_COLD_LOADS ?? 5); k++) {
          // From the second load on: the service worker and its caches are taken away first. Safari's own HTTP cache
          // stays (a page cannot clear it): these loads are «without the app's cache», the first one is the cold one.
          if (k > 1) await c.jsAsync("const done = arguments[arguments.length - 1]; (async () => { for (const r of await navigator.serviceWorker?.getRegistrations?.() ?? []) await r.unregister(); for (const k of await caches.keys()) await caches.delete(k); })().then(() => done(true), (e) => done(String(e)));");
          await c.call('POST', `${c.S}/url`, { url: `${c.url}?l5cold=${k}` });
          const home = await c.waitFor('home', () => c.js("const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && ['New project', 'Новый проект'].includes((e.getAttribute('aria-label') || e.textContent).trim())); return b ? Math.round(performance.now()) : null;"), 30_000);
          const sample = await c.jsAsync(`const done = arguments[arguments.length - 1];
            const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && ['Try a sample', 'Открыть пример'].includes((e.getAttribute('aria-label') || e.textContent).trim())); if (!b) { done(-1); return; }
            const t0 = performance.now(); b.click();
            const tick = () => { if (document.querySelectorAll('.tl-row.main .clip').length && (window.__kadrPerf?.drawn ?? 0) > 0) done(Math.round(performance.now() - t0)); else if (performance.now() - t0 > 60000) done(60000); else setTimeout(tick, 20); }; tick();`);
          loads.push({ k, home, sample });
          await c.watch();
          await c.cleanup();
        }
        return loads;
      },
      judge: (m) => [atMost('холодный запуск: главная (не позже)', m[0]?.home, 3000, ' мс'), atMost('холодный запуск: пример', m[0]?.sample, 5000, ' мс'),
        kOfN('без кэша приложения: главная ≤ 3000 мс', m.slice(1), (r) => r.home <= 3000, m.length - 1), kOfN('без кэша приложения: пример ≤ 5000 мс', m.slice(1), (r) => r.sample >= 0 && r.sample <= 5000, m.length - 1),
        record('главная, мс', m.map((r) => r.home).join(', ')), record('пример, мс', m.map((r) => r.sample).join(', '))],
      page: false,
    },
    {
      id: 'V-171 · V-160 · V-257 · C-C1', price: 3,
      run: async (c) => {
        await c.fresh(['long_1.mp4'], { aspect: '16:9' });
        for (let k = 1; k <= 7; k++) {
          await c.selectClip(k - 1);
          await c.seek(3 * k);
          await sleep(300);
          await c.tool('Split');
          await c.waitFor(`${k + 1} pieces`, async () => (await c.count('.tl-row.main .clip')) === k + 1, 15_000);
        }
        await c.closeTools();
        for (const t of [1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5, 40]) await c.exactAt(t);
        await sleep(3000);
        const idle = (await c.page()).dec.open;
        await c.js('window.__l5.dec.peak = window.__l5.dec.open;');
        const { file } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'v-171-pieces.mp4' });
        const exporting = (await c.page()).dec.peak;
        // Silent clips from four files, played across their joins: the frames keep coming.
        const silent = [0, 1, 2, 3].map((i) => make(c.out, `v-171-silent-${i + 1}.mp4`, ['-f', 'lavfi', '-i', `testsrc2=s=1280x720:r=30:d=3,hue=h=${i * 90}`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an']));
        await c.fresh(silent, { aspect: '16:9' });
        await c.seek(0);
        await sleep(1000);
        const gaps = await c.jsAsync(`const done = arguments[arguments.length - 1], P = window.__kadrPerf;
          const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.getAttribute('aria-label') === 'Play'); if (!b) { done({ error: 'no Play' }); return; }
          b.click(); let last = performance.now(), n = P.drawn, worst = 0; const t0 = last;
          const tick = () => { const now = performance.now(); if (P.drawn !== n) { worst = Math.max(worst, now - last); last = now; n = P.drawn; }
            if (now - t0 < 11000) setTimeout(tick, 10); else done({ worstGapMs: Math.round(Math.max(worst, now - last)) }); }; tick();`);
        await c.tap('Pause').catch(() => undefined);
        return { idle, exporting, file: probe(file), ...gaps };
      },
      judge: (m) => [...decoderChecks(m.idle, m.exporting), ...wholeFile(m.file, { duration: 60, tolerance: 0.15 }), atMost('превью не замерзает: худший промежуток между кадрами', m.worstGapMs, 1000, ' мс'), record('счётчик', 'декодеры страницы (воркеры не видны), как в e2e')],
    },
    {
      id: 'V-228', price: 3,
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.exactAt(2);
        // Lost and given back after 3 s: from the restore to the next frame drawn, in the page.
        const restored = await c.jsAsync(`const done = arguments[arguments.length - 1], P = window.__kadrPerf;
          const gl = document.querySelector('.preview-canvas').getContext('webgl2'), ext = gl && gl.getExtension('WEBGL_lose_context'); if (!ext) { done({ error: 'no WEBGL_lose_context' }); return; }
          ext.loseContext();
          setTimeout(() => { const n = P.drawn, t0 = performance.now(); ext.restoreContext();
            const tick = () => { if (P.drawn > n) done({ ms: Math.round(performance.now() - t0) }); else if (performance.now() - t0 > 10000) done({ ms: null }); else setTimeout(tick, 20); }; tick(); }, 3000);`);
        await sleep(1000);
        const first = luma(await c.previewShot('v-228-restored'));
        // Lost for good: the app makes a new canvas after 2.5 s; from the loss to a frame drawn on it.
        const gone = await c.jsAsync(`const done = arguments[arguments.length - 1], P = window.__kadrPerf, old = document.querySelector('.preview-canvas');
          const gl = old.getContext('webgl2'), ext = gl && gl.getExtension('WEBGL_lose_context'); if (!ext) { done({ error: 'no WEBGL_lose_context' }); return; }
          const n = P.drawn, t0 = performance.now(); ext.loseContext();
          const tick = () => { const now = document.querySelector('.preview-canvas'); if (now && now !== old && P.drawn > n) done({ ms: Math.round(performance.now() - t0) }); else if (performance.now() - t0 > 15000) done({ ms: null }); else setTimeout(tick, 20); }; tick();`);
        await sleep(1000);
        return { restoredMs: restored.ms, goneMs: gone.ms, error: restored.error ?? gone.error, first, second: luma(await c.previewShot('v-228-new-canvas')) };
      },
      judge: (m) => [holds('потеря контекста вызвана', !m.error, m.error ?? 'да', 'да'), atMost('восстановлен: картинка вернулась', m.restoredMs, 3000, ' мс'), atMost('не восстановлен: картинка на новом холсте', m.goneMs, 3000, ' мс'),
        atLeast('яркость превью после первого', m.first, 10), atLeast('яркость превью после второго', m.second, 10)],
    },
    {
      id: 'D-19', price: 3,
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.tool('Text');
        await c.waitFor('the text field', () => c.js(`const f = document.querySelector('textarea.ck-panel-text'); if (!f) return false;
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(f, 'Привет, Чётко 2026'); f.dispatchEvent(new Event('input', { bubbles: true })); return true;`), 15_000);
        const looks = [];
        const pick = (group, name) => c.waitFor(`${group} ${name}`, () => c.js("const e = document.querySelector('[role=radiogroup][aria-label=\"' + arguments[0] + '\"] [aria-label=\"' + arguments[1] + '\"]'); if (!e) return false; e.scrollIntoView({ block: 'nearest', inline: 'nearest' }); e.click(); return true;", group, name), 15_000);
        for (const [group, name] of [['Style', 'Outline'], ['Font', 'Anton'], ['Font', 'Bebas'], ['Style', 'Retro 80s']]) {
          await pick(group, name);
          await sleep(1500);
          await c.previewShot(`d-19-preview-${name.replace(/\W+/g, '')}`);
          looks.push(name);
        }
        await c.tap('Done');
        await c.closeTools();
        await c.exportAs({ format: 'Photo', file: 'd-19-photo-retro80s.jpg' });
        const fonts = await c.js("return [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/\"/g, '')).filter((v, i, a) => a.indexOf(v) === i)");
        return { looks, fonts };
      },
      judge: (m) => ({ checks: [equals('стилей и шрифтов снято', m.looks.length, 4), record('загружены шрифты', m.fonts.join(', '))], look: 'd-19-preview-*.png и d-19-photo-retro80s.jpg против слепка WebKit Mac: Oswald, не запасной шрифт' }),
    },
    {
      id: 'V-173', price: 4,
      run: async (c) => {
        const gop = make(c.out, 'v-173-gop10s.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-g', '300', '-keyint_min', '300', '-sc_threshold', '0', '-an']);
        await c.fresh([gop], { aspect: '16:9' });
        await sleep(3000);
        const steps = [];
        for (const [from, to] of [[1, 1.6], [3.2, 4], [5, 5.9], [7.1, 7.7], [11, 11.8], [13.3, 14], [16, 16.5], [18.4, 19.4], [22, 22.7], [25.5, 26.3]]) {
          await c.exactAt(from);
          steps.push(await c.jsAsync(`const done = arguments[arguments.length - 1], to = arguments[0], P = window.__kadrPerf, el = document.querySelector('.tl-scroll'), t0 = performance.now();
            el.scrollLeft = to * 60; let first = null;
            const tick = () => { if (P.last.at > t0 && Math.abs(P.last.t - to) < 0.05) { first ??= Math.round(P.last.at - t0); if (P.last.exact) { done({ to, first, exact: Math.round(P.last.at - t0) }); return; } }
              if (performance.now() - t0 > 10000) done({ to, first, exact: null }); else setTimeout(tick, 2); }; tick();`, to));
        }
        return steps;
      },
      judge: (m) => [kOfN('кадр после скраба ≤ 100 мс', m, (s) => s.first !== null && s.first <= 100, 10), record('первый кадр, мс', m.map((s) => s.first).join(', ')), record('точный кадр, мс', m.map((s) => s.exact).join(', '))],
    },
    {
      id: 'V-139', price: 4,
      // One 4K HEVC clip and two duplicates (three decoders of 4K HEVC); playback with a jump every 4 s for 2 minutes.
      run: async (c) => {
        await c.fresh(['phone_4k_hevc.mov'], { aspect: '16:9' });
        for (let k = 0; k < 2; k++) {
          await c.selectClip(0);
          await c.tool('Duplicate');
          await c.waitFor('a duplicate', async () => (await c.count('.tl-row.main .clip')) === k + 2, 30_000);
        }
        await c.closeTools();
        const r = await c.jsAsync(`const done = arguments[arguments.length - 1], P = window.__kadrPerf, el = document.querySelector('.tl-scroll');
          const play = () => [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.getAttribute('aria-label') === 'Play');
          play()?.click(); let last = performance.now(), n = P.drawn, worst = 0, jumps = 0; const t0 = last;
          const targets = [70, 12, 55, 88, 3, 40, 75, 21, 63, 9, 47, 81, 30, 59, 16, 85, 36, 68, 5, 52, 78, 25, 44, 90, 14, 61, 33, 72, 50, 7];
          const jump = setInterval(() => { el.scrollLeft = targets[jumps++ % targets.length] * 60; play()?.click(); }, 4000);
          const tick = () => { const now = performance.now(); if (P.drawn !== n) { worst = Math.max(worst, now - last); last = now; n = P.drawn; }
            if (now - t0 < 120000) setTimeout(tick, 20); else { clearInterval(jump); done({ worstGapMs: Math.round(worst), jumps }); } }; tick();`);
        await c.tap('Pause').catch(() => undefined);
        const page = await c.page();
        return { ...r, engine: page.notes.filter((n) => /WebCodecs|VideoDecoder|EncodingError|OperationError|NotSupportedError|Decoder failure/i.test(n)) };
      },
      judge: (m) => [none('сообщения со словами движка', m.engine), atMost('кадры вернулись (худший промежуток)', m.worstGapMs, 1500, ' мс'), record('прыжков', m.jumps)],
    },
    {
      id: 'V-103', price: 5,
      run: async (c) => {
        const sky = make(c.out, 'v-103-sky.jpg', ['-f', 'lavfi', '-i', 'gradients=s=1080x1350:c0=0x9ec9f0:c1=0x2f6db5:x0=0:y0=0:x1=0:y1=1350:d=1', '-frames:v', '1']);
        const runs = [];
        for (let k = 1; k <= REPS; k++) {
          for (const [file, kind] of [[sky, 'sky'], ['person.jpg', 'person']]) {
            await c.fresh([file]);
            await c.selectClip();
            await c.tool('Cutout');
            const said = await c.waitFor('the answer', () => c.js("return [...document.querySelectorAll('.toast')].map((e) => e.textContent).find((t) => /No person found|Background removed/.test(t)) ?? null"), 180_000).catch(() => null);
            runs.push({ kind, said, on: await c.toolOn('Cutout'), clips: await c.count('.tl-row.main .clip') });
            await c.cleanup();
          }
        }
        return runs;
      },
      judge: (m) => [kOfN('небо: «No person found», картинка цела', m.filter((r) => r.kind === 'sky'), (r) => /No person found/.test(r.said ?? '') && !r.on && r.clips === 1, REPS),
        kOfN('человек: фон убран', m.filter((r) => r.kind === 'person'), (r) => /Background removed/.test(r.said ?? '') && r.on, REPS)],
    },
    {
      id: 'V-232', price: 5,
      run: async (c) => {
        await c.fresh(['resize.webm']);
        await c.exactAt(3);
        const shot = await c.previewShot('v-232-preview-3s');
        const previewFile = `${c.out}/v-232-preview-3s.png`;
        const { file } = await c.exportAs({ preset: 'Small file', file: 'v-232.mp4' });
        const [pe, pc] = greenAt(previewFile, [], [0.04, 0.5]);
        const [fe, fc] = greenAt(file, ['-ss', '3'], [0.04, 0.5]);
        return { preview: { edge: pe, centre: pc }, file: { edge: fe, centre: fc }, bytes: shot.length };
      },
      judge: (m) => [atLeast('превью: квадрат в середине (зелёный)', m.preview.centre, 150), below('превью: край широкого места', m.preview.edge, 100), atLeast('файл: квадрат в середине', m.file.centre, 150), below('файл: край широкого места', m.file.edge, 100)],
    },
    {
      ids: ['V-243'], price: 5,
      tools: { name: 'tools-v243', scenarios: ['color-601'] },
      judge: (rows) => {
        const r = rows[0], off = r?.note?.levelsOff;
        if (!off) return [judge('V-243', [], { error: r?.error ?? 'нет строки color-601' })];
        return [judge('V-243', [atMost('превью', off.preview, 6, ' ур.'), atMost('фото', off.photo, 6, ' ур.'), atMost('видео', off.video, 6, ' ур.')])];
      },
    },
    {
      id: 'D-11', price: 5,
      // An HLG video of the phone (fixtures/iphone_hdr.mov): its frame at 1 s in the preview against a freeze of it, and
      // against the reversed clip at the mirrored time (4 − 1 = 3 s).
      run: async (c) => {
        await c.fresh(['iphone_hdr.mov'], { aspect: '16:9' });
        await c.exactAt(1);
        const shown = luma(await c.previewShot('d-11-frame-1s'));
        await c.selectClip();
        await c.exactAt(1);
        await c.tool('Freeze');
        await c.waitFor('the freeze', async () => (await c.count('.tl-row.main .clip-image')) === 1, 20_000);
        await c.closeTools();
        await c.exactAt(1.5);
        const frozen = luma(await c.previewShot('d-11-freeze'));
        await c.fresh(['iphone_hdr.mov'], { aspect: '16:9' });
        await c.selectClip();
        await c.tool('Reverse');
        await c.waitFor('the reverse to start', () => c.js("return !!document.querySelector('.busy')"), 10_000).catch(() => undefined);
        await c.idle(180_000);
        await c.closeTools();
        await c.exactAt(3);
        const reversed = luma(await c.previewShot('d-11-reversed-3s'));
        return { shown, frozen, reversed };
      },
      judge: (m) => [atMost('стоп-кадр против кадра', Math.abs(m.frozen - m.shown), 3, ' ур.'), atMost('реверс против кадра', Math.abs(m.reversed - m.shown), 3, ' ур.')],
    },
    {
      id: 'V-176', price: 5,
      // The import has no Cancel (the editor's import veil has none): a 200 MB import, then its project deleted; a project
      // left in the middle of a reverse (a new page) and deleted. A minute later the site's storage is where it began.
      run: async (c) => {
        await c.home();
        await c.settled();
        const base = await c.usage();
        const big = make(c.out, 'v-176-200mb.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=60', '-vf', 'noise=alls=30:allf=t', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-b:v', '26M', '-maxrate', '26M', '-bufsize', '52M', '-an']);
        await c.fresh([big], { aspect: '16:9' });
        await c.cleanup();
        await c.fresh(['landscape.mp4']);
        await c.selectClip();
        await c.tool('Reverse');
        await sleep(1500);
        await c.call('POST', `${c.S}/url`, { url: `${c.url}?l5away=1` });
        await sleep(3000);
        await c.watch();
        await c.cleanup();
        await sleep(60_000);
        const after = await c.usage();
        return { baseMb: Math.round(base / 1e5) / 10, afterMb: Math.round(after / 1e5) / 10, bigMb: Math.round(readFileSync(big).length / 1e5) / 10 };
      },
      judge: (m) => [atMost('хранилище через минуту сверх исходного', Math.round((m.afterMb - m.baseMb) * 10) / 10, 5, ' МБ'), record('импортировано', m.bigMb, ' МБ')],
    },
    {
      id: 'V-189', price: 5,
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.exportAs({ preset: 'Small file' });
        await c.js('window.__l5.blob = null;'); // the export's file, kept by the page: the backup's comes next
        await c.leave();
        await c.waitFor('Save a backup', () => c.js("const b = [...document.querySelectorAll('button')].find((x) => /^Save a backup of /.test(x.getAttribute('aria-label') || '')); if (!b) return false; b.click(); return true;"), 15_000);
        await c.waitFor('the backup', () => c.js('return !!window.__l5.blob'), 120_000);
        await c.js('window.__l5.blob = null;');
        await c.cleanup();
        await sleep(2000);
        return { files: await c.jsAsync("const done = arguments[arguments.length - 1]; (async () => { const d = await navigator.storage.getDirectory(); const names = []; for await (const k of d.keys()) names.push(k); return names; })().then(done, (e) => done(['error: ' + e])); ") };
      },
      judge: (m) => [none('в OPFS export-* и backup-*', m.files.filter((f) => /^(export|backup)-|^error/.test(f))), record('в OPFS', m.files.join(', ') || 'пусто')],
    },
    {
      ids: ['V-157 (без наушников)'], price: 5,
      tools: { name: 'tools-v157', scenarios: ['audio-latency'] },
      judge: (rows) => [judge('V-157 (без наушников)', [holds('замер', rows[0]?.ok, rows[0]?.error ?? 'есть', 'есть'), record('задержка выхода', rows[0]?.note?.outputLatency, ' с'), record('базовая', rows[0]?.note?.baseLatency, ' с')],
        { look: 'с наушниками Bluetooth — вручную (запись экрана с микрофоном), порог ≤ 80 мс' })],
    },
  ],
  manual: [
    { id: 'V-184 · C-C3', steps: 'Живой сайт онлайн, закрыть Safari, авиарежим, открыть снова, открыть проект, экспорт 1080p. 3 раза.', limit: 'главная и проект открываются, экспорт целый, 3 из 3' },
    { id: 'C-C3 (XR)', steps: 'Если XR будет (решение V-252): `L5_UDID=<XR> L5_ONLY=C-C3 node scripts/l5-sweep-e.mjs`.', limit: 'главная ≤ 3 с, пример ≤ 5 с, без белого экрана, 5 из 5' },
    { id: 'V-120 · C-D1 (фон)', steps: 'Правка, Safari в фон на 10 мин (другое приложение), вернуться, ещё правка, закрыть вкладку, открыть проект. 5 раз.', limit: 'видна последняя правка; ни одной потерянной, 5 из 5' },
    { id: 'C-D1 (убить вкладку)', steps: 'Убить вкладку посреди правок (закрыть из переключателя), открыть снова; 5 раз. Через 8 дней без открытия — проект на месте (V-223).', limit: '0 потерянных правок, 5 из 5; проект на месте через 8 дней' },
    { id: 'V-253 · V-250', steps: 'Частная вкладка: импорт видео 200 МБ, превью, перемотка, экспорт; дубль камеры 60 с, убить вкладку посреди записи; Web Inspector → Memory.', limit: 'вкладка жива; пик памяти < 2 кусков + экспорт; дубль восстановлен до последних секунд' },
    { id: 'V-151', steps: 'Настоящее HDR с iPhone (HLG, Dolby Vision): превью, «Фото» и экспорт против снимка в «Фото».', limit: 'белый, кожа, серый в пределах 20 уровней от SDR-версии «Фото»' },
    { id: 'V-206', steps: 'Восстановить бэкап 1 ГБ из «Файлов» (сохранённый и пережатый ZIP). 3 раза.', limit: 'вкладка жива, все клипы на месте, 3 из 3' },
    { id: 'V-225 · C-L3', steps: 'Идёт экспорт: свайп листа вниз пальцем, жест «Назад»; готовый несохранённый файл: свайп листа.', limit: 'первый жест только предупреждает, экспорт идёт; файл не теряется без второго жеста' },
    { id: 'C-L3', steps: 'Наложение, обрезка, разрез, текст, вырез фона, хромакей пальцем на 375 px; экспорт, ffmpeg.', limit: 'каждый с первого раза, результат в файле' },
    { id: 'D-10 · C-J2', steps: 'Импорт 4K HEVC 20 с из «Фото» с «Формат: Текущий» и «Наиболее совместимый».', limit: 'с «Текущий» до клипа ≤ 5 с; совет перед первым выбором показан' },
    { id: 'S-1-12', steps: 'Скриптом в `l5-sweep-a.mjs` (те же 60 прогонов камеры, что S-1-13); фоновый экспорт — вручную, если нужен.', limit: '0 пустых дублей из 100' },
    { id: 'V-217 (E4)', steps: 'Лист «Субтитры»: поправить строку 1 и, не убирая клавиатуру, смахнуть лист вниз; закрыть и открыть проект. 3 раза.', limit: 'правка на месте 3 из 3' },
    { id: 'V-261 (E4)', steps: 'Выбрать клип, быстрый свайп пальцем по превью далеко за край; экспорт. 3 раза.', limit: 'клип в кадре и в файле 3 из 3' },
    { id: 'SW-U-2', steps: 'Только с внешней клавиатурой (Кана/Пиньинь): Escape при наборе в «Текст» и «Переименовать». Без клавиатуры — пропуск с пометкой.', limit: 'после первого Escape лист открыт, набор снят; после второго закрыт; 3 из 3' },
    { id: 'SW-A-12, V-177, V-235, D-13', steps: 'Android (нет на стенде, V-125): пропуск с пометкой.', limit: '—' },
    { id: 'V-142', steps: 'GigaAM: снять 30 с речи с нарочными запинками, «Рилс в 1 тап». 2 раза.', limit: 'до «Рилса» запинки записаны; в ролике ни одной; «а», «и» на месте; 2 из 2' },
    { id: 'V-182 · F-03 на XR', steps: 'Если XR будет: `L5_UDID=<XR> node scripts/l5-tools.mjs captions-ru-long captions-live-ru`.', limit: 'вкладка жива, ≥ 95 с из 101; ≤ 43 с от тапа; 2 из 2' },
    { id: 'V-145', steps: 'Клип 1080p: размытие 0,5, пикселизация, резкость, VHS по очереди; снимок превью против кадра файла 1080p и 4K в той же точке; ffmpeg на Mac.', limit: 'размер блока и радиус в доле кадра расходятся не больше чем на 10 %' },
    { id: 'V-137', steps: 'Web Inspector → Memory: проект из 10 клипов, посмотреть, выйти, удалить; открыть второй проект.', limit: 'память возвращается к уровню до открытия ± 15 %' },
    { id: 'V-121, D-16, S-1-6, S-1-10', steps: 'Сеть: «Скрыть лица» после авиарежима; стили текста после авиарежима; Wi‑Fi без интернета → «Музыка» и «Субтитры».', limit: 'по строкам очереди E2: лица скрыты без слова о сети; 6 из 6 стилей своим шрифтом; «Сервер не ответил…», «Модель речи не загрузилась…»' },
    { id: 'V-157 (наушники)', steps: 'Bluetooth-наушники, avsync.mp4 в превью, запись экрана с микрофоном.', limit: 'расхождение ≤ 80 мс' },
    { id: 'V-156', steps: 'XR: экспорт 1080p сразу после возврата из фона.', limit: 'файл или «графика сброшена, начинаем снова», без «WebGL2 недоступен»' },
    { id: 'V-202, V-208, V-224, V-226, V-133', steps: 'Клавиатура над полем «Текст»; альбомная ориентация с листами; «Озвучка» и закрыть лист во время вопроса о микрофоне; свайп «назад» от края; звонок или блокировка во время воспроизведения.', limit: 'по строкам очереди E2' },
    { id: 'V-203, V-164', steps: 'Ссылка из Instagram, TikTok, Telegram; совет «на экран Домой» и приложение с экрана «Домой».', limit: 'по строкам очереди E2' },
    { id: 'S-1-2, D-15', steps: 'Разрез и 8–10 тяжёлых вкладок; переполненное хранилище (если удастся).', limit: 'разрез на месте 5 из 5; слова о хранилище ≤ 10 с' },
    { id: 'V-101, V-106', steps: 'Два пальца: щипок таймлайна 10 раз (`?perf`), второй палец на клипе и на обрезке.', limit: 'полосы растягиваются, перерисованы ≤ 0,5 с, FPS ≥ 30; порядок клипов и обрезка не меняются, 3 из 3' },
    { id: 'C-C5 · D-7', steps: 'Вместе с D-7 чек-листа: редактор открыт во время выпуска, 5 мин, затем главная.', limit: 'редактор не перезагружается, правка цела; на главной новая версия' },
    { id: 'V-105 (E4)', steps: 'Нужен iPhone на iOS 26.0–26.3: на стенде нет — пропуск с пометкой.', limit: 'шагов назад по кадрам нет' },
  ],
});
