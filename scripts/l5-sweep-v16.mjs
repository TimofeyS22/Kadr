// L5 of the rows that come with v1.9.16, on a real iPhone: the copy of every project made in Safari (SW-A-22, the Safari
// side — the Home Screen app's restore is the owner's step), the bottom panel of Home under a finger (SW-A-3), the speech
// model's download stopped half way (SW-S-2), the timeline's jumps while it plays (SW-U-17).
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-v16.mjs [site URL]       (runner and env: scripts/l5-sweep.mjs)
//   L5_PW=1: a dry run in Playwright's WebKit on this Mac (does the scenario reach its steps; measures nothing of the phone).
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { strFromU8, unzipSync } from 'fflate';
import { sweep } from './l5-sweep.mjs';
import { atLeast, equals, holds, kOfN, none, percentile, record } from './l5-verdict.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** One step of the playhead by scrolling to `x`: the first frame drawn within 0.2 s of `want` (null: any), and the exact one. */
const STEP = `const done = arguments[arguments.length - 1], x = arguments[0], want = arguments[1];
  (async () => {
    const P = window.__kadrPerf, el = document.querySelector('.tl-scroll'), t0 = performance.now();
    el.scrollLeft = x;
    let first = 0;
    while (performance.now() - t0 < 30000) {
      await new Promise((ok) => setTimeout(ok, 2));
      if (P.last.at <= t0 || (want !== null && Math.abs(P.last.t - want) > 0.2)) continue;
      first ||= P.last.at - t0;
      if (P.last.exact) return { t: P.last.t, first, exact: P.last.at - t0 };
    }
    return { t: P.last.t, first: first || 30000, exact: 30000 };
  })().then(done, (e) => done({ error: String(e) }));`;
/** The download's words as the work's line shows them, read in the page every 100 ms: «N из 225 МБ» as it grows. */
const WATCH_MB = `window.__mb = { seen: [], t0: performance.now(), notes: window.__mb?.notes ?? [] }; clearInterval(window.__mbTimer);
  // The download's own note (captions.ts: «speech download ru: first byte…, store opfs…»): which store took the parts.
  if (!window.__mbInfo) { window.__mbInfo = true; const info = console.info; console.info = function (...a) { const t = a.map(String).join(' '); if (/speech download/.test(t)) window.__mb.notes.push(t.slice(0, 400)); return info.apply(this, a); }; }
  window.__mbTimer = setInterval(() => { const t = (document.querySelector('.ck-work-label')?.textContent ?? document.querySelector('.busy')?.textContent ?? '').replace(/\\s+/g, ' ').trim();
    // «N из 225 МБ» (v1.9.16), or the bar's share of «225 МБ» where the words give only the size (v1.9.15).
    let m = /(\\d+(?:[.,]\\d+)?) из (\\d+) МБ/.exec(t) || /(\\d+(?:[.,]\\d+)?) of (\\d+) MB/.exec(t);
    const total = /(\\d+) (МБ|MB)/.exec(t), pct = Number(document.querySelector('.sheet [role=progressbar]')?.getAttribute('aria-valuenow'));
    if (!m && total && /Скачиваем модель речи|Downloading the speech model/.test(t) && Number.isFinite(pct)) m = [null, String(Math.round((Number(total[1]) * pct) / 100)), total[1]];
    const S = window.__mb.seen; if (m) { const v = Number(String(m[1]).replace(',', '.')); if (!S.length || S[S.length - 1].mb !== v) S.push({ at: Math.round(performance.now() - window.__mb.t0), mb: v, of: Number(m[2]) }); }
    if (/остановилось|stopped/.test(t) && !window.__mb.stopped) window.__mb.stopped = t.slice(0, 160); }, 100);`;
/** GigaAM picked under «Распознавание» and asked for; every question about a model answered yes (as l5-tools gigaamSpeech). */
async function askGigaam(c) {
  await c.tap('Субтитры');
  await c.tap(['Не сейчас', 'Настройки'], 60_000);
  await c.waitFor('the GigaAM chip', () => c.js("const x = [...document.querySelectorAll('.sheet [role=radio]')].find((e) => /^Русская речь, (\\d+ МБ|на устройстве)$/.test(e.textContent.trim())); if (!x) return false; x.scrollIntoView({ block: 'center' }); x.click(); return true;"), 20_000);
  await c.js(WATCH_MB);
  await c.tap('Создать субтитры');
  await c.waitFor('the download to start', () => c.js(`const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && /^Скачать и сделать субтитры$/.test(e.textContent.trim())); if (b) b.click();
    return window.__mb.seen.length > 0 || document.querySelectorAll('.caption-row').length > 0;`), 120_000);
}

/**
 * One part (4 MB) of the model from this Mac: from the site under test's own mirror (<url>models/…parts/0, where the
 * worker looks first), from Hugging Face and from github.io.
 */
async function netSpeed(site) {
  const parts = [
    ['зеркало сайта', `${site}models/istupakov/gigaam-v3-onnx/resolve/322c3b29492673eb7d0b434bfa9dfb8653e34d02/v3_e2e_ctc.int8.onnx.parts/0`],
    ['huggingface.co', 'https://huggingface.co/istupakov/gigaam-v3-onnx/resolve/322c3b29492673eb7d0b434bfa9dfb8653e34d02/v3_e2e_ctc.int8.onnx'],
    ['github.io', process.env.L5_S2_PAGES_URL ?? 'https://timofeys22.github.io/Kadr/assets/vision_wasm_internal-DuEsUYlF.wasm'],
  ];
  const out = [];
  for (const [host, url] of parts) {
    const t = Date.now();
    try {
      const res = await fetch(url, { headers: { range: 'bytes=0-4194303' }, signal: AbortSignal.timeout(90_000) });
      const bytes = (await res.arrayBuffer()).byteLength;
      out.push({ host, kbps: res.ok ? Math.round(bytes / 1024 / ((Date.now() - t) / 1000)) : null, error: res.ok ? null : `HTTP ${res.status}` });
    } catch (e) { out.push({ host, kbps: null, error: e.name }); }
  }
  return out;
}
/**
 * Follows the download once a second until `until` holds, the captions come, or the deadline: the values of «N из 225 МБ»
 * in order, and the longest time nothing on screen changed with no words of a stop.
 */
async function follow(c, until, deadline) {
  const values = [];
  let last = '', since = Date.now(), silentMs = 0, stopped = null, of = null;
  for (;;) {
    const now = await c.js("const S = window.__mb.seen, l = S[S.length - 1]; return { l: l ?? null, words: (document.querySelector('.ck-work-label')?.textContent ?? document.querySelector('.busy')?.textContent ?? '').replace(/\\s+/g, ' ').trim().slice(0, 140), stopped: window.__mb.stopped ?? null, lines: document.querySelectorAll('.caption-row').length };");
    if (now.l && values.at(-1) !== now.l.mb) values.push(now.l.mb);
    if (now.l) of = now.l.of;
    if (now.stopped) stopped = now.stopped;
    const key = `${now.l?.mb}|${now.words}|${now.lines}`;
    if (key !== last || now.stopped) { last = key; since = Date.now(); } else silentMs = Math.max(silentMs, Date.now() - since);
    if (until(now) || now.lines > 0) return { reached: true, values, of, silentMs, stopped, lines: now.lines };
    if (Date.now() > deadline) return { reached: false, values, of, silentMs, stopped, lines: 0 };
    await sleep(1000);
  }
}

await sweep({
  lane: 'v16',
  title: 'строки v1.9.16 (SW-A-22, SW-A-3, SW-S-2, SW-U-17)',
  items: [
    {
      id: 'SW-A-22 (копия всех проектов, сторона Safari)', price: 1,
      // Three projects, two of them sharing a file; «Save a copy of every project» on Home; the file read on the Mac; the same
      // Safari reads it back with «Restore backup». The Home Screen app's restore is the owner's step (manual list).
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.fresh(['landscape.mp4', 'speech_ru.mp4'], { keepPage: true });
        await c.fresh(['speech_ru.mp4'], { keepPage: true });
        await c.leave();
        const before = await c.count('.project-open');
        const t = Date.now();
        await c.tap(['Save a copy of every project', 'Сохранить копию всех проектов'], 30_000);
        await c.waitFor('the copy', () => c.js('return !!window.__l5.blob'), 300_000);
        const copyS = (Date.now() - t) / 1000;
        const file = await c.pull('sw-a-22-every-project.kadr');
        const z = unzipSync(readFileSync(file));
        const projects = Object.keys(z).filter((k) => /^projects\/[^/]+\/project\.json$/.test(k));
        const media = Object.keys(z).filter((k) => k.startsWith('media/') && z[k].length);
        const hashes = media.map((k) => createHash('sha256').update(z[k]).digest('hex'));
        const missing = projects.flatMap((k) => Object.keys(JSON.parse(strFromU8(z[k])).assets ?? {}).filter((id) => !z[`media/${id}`]).map((id) => `${k}: ${id}`));
        await c.push(file);
        await c.tap(['Restore backup', 'Восстановить копию']);
        const after = await c.waitFor('the projects back', async () => { await c.leave(); const n = await c.count('.project-open'); return n >= before * 2 ? n : null; }, 180_000).catch(async () => c.count('.project-open'));
        return { before, copyS, mb: Math.round(readFileSync(file).length / 1e5) / 10, projects: projects.length, media: media.length, duplicates: hashes.length - new Set(hashes).size, missing, after };
      },
      judge: (m) => [equals('проектов в файле', m.projects, m.before), none('медиа проектов, которых нет в файле', m.missing), equals('одинаковых медиа в файле', m.duplicates, 0),
        equals('проектов на главной после «Восстановить копию»', m.after, m.before * 2), record('копия', `${m.copyS} с, ${m.mb} МБ, медиа ${m.media}`)],
    },
    {
      id: 'SW-A-3 (нижняя панель главной)', price: 1,
      // Three projects on Home; each button of the bottom panel at a fifth, the middle and four fifths of its width: what a
      // finger there touches (the page's own hit test), then the middle of «New project» pressed — the format sheet, not a rename.
      run: async (c) => {
        for (let k = 0; k < 3; k++) await c.fresh(['landscape.mp4'], { keepPage: k > 0 });
        await c.leave();
        await c.waitFor('three projects', async () => (await c.count('.project-open')) >= 3, 20_000);
        const hits = await c.js(`const out = [];
          for (const names of arguments[0]) {
            const n = names[0], b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && names.includes((e.getAttribute('aria-label') || e.textContent).trim()));
            if (!b) { out.push({ n, missing: true }); continue; }
            const r = b.getBoundingClientRect();
            for (const fx of [0.2, 0.5, 0.8]) {
              const h = document.elementFromPoint(r.left + r.width * fx, r.top + r.height / 2), hb = h && h.closest('button');
              out.push({ n, fx, ok: !!h && (h === b || b.contains(h)), hit: hb ? (hb.getAttribute('aria-label') || hb.textContent).trim().slice(0, 40) : h && h.tagName, h: Math.round(r.height) });
            }
          }
          return out;`, [['New project', 'Новый проект'], ['Try a sample', 'Открыть пример'], ['Restore backup', 'Восстановить копию']]);
        const press = await c.js(`const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && ['New project', 'Новый проект'].includes((e.getAttribute('aria-label') || e.textContent).trim()));
          const r = b.getBoundingClientRect(), h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); (h.closest('button') || h).click(); return true;`);
        await sleep(1200);
        const opened = await c.js("return { format: [...document.querySelectorAll('.aspect-card')].some((e) => e.offsetParent !== null && e.getBoundingClientRect().height > 0), rename: !!document.querySelector('.ck-home-form input') }");
        return { hits, pressed: press, opened };
      },
      judge: (m) => [kOfN('точка кнопки попадает в свою кнопку', m.hits, (x) => x.ok, 9), atLeast('высота кнопок панели (меньшая)', Math.min(...m.hits.filter((x) => x.h).map((x) => x.h)), 44, ' px'),
        holds('середина «Новый проект» открыла выбор формата', m.opened.format && !m.opened.rename, JSON.stringify(m.opened), 'формат, не «Переименовать»'),
        record('мимо', m.hits.filter((x) => !x.ok).map((x) => `${x.n} @${x.fx}: ${x.hit ?? 'нет кнопки'}`).join('; ') || 'нет')],
    },
    {
      id: 'SW-S-2 (загрузка модели речи, остановка посередине)', price: 2,
      // GigaAM (225 MB) in the Russian interface; at a third the page is reloaded (a killed tab), asked for again it goes
      // on from the saved parts. Judged (S, 2026-11-23) by «N из 225 МБ» growing and no 45 s without words — not by the
      // time to captions: the network goes first, and a download out of time is «a slow network: N MB in T s», not a FAIL.
      run: async (c) => {
        const speed = await netSpeed(c.url);
        console.log(`  сеть Mac: ${speed.map((x) => `${x.host} ${x.kbps ?? x.error} КБ/с`).join(', ')}`);
        const t0 = Date.now(), deadline = t0 + Number(process.env.L5_S2_MS ?? 1_200_000);
        await c.fresh(['eval_ru_live.mp4'], { ru: true });
        await askGigaam(c);
        const one = await follow(c, (now) => now.l && now.l.mb >= now.l.of / 3, deadline);
        let two = null;
        if (one.reached && !one.lines) {
          await c.call('POST', `${c.S}/refresh`, {});
          await c.waitFor('the editor again', () => c.js("return !!document.querySelector('.preview-canvas')"), 60_000);
          await c.watch();
          await askGigaam(c);
          two = await follow(c, (now) => now.lines > 0, deadline);
        }
        const notes = await c.js('clearInterval(window.__mbTimer); return window.__mb?.notes ?? []').catch(() => []);
        // Kadr's error log keeps the note when a store gave way or the start was slow (lib/errorLog, database kadr-log).
        const logged = await c.jsAsync(`const done = arguments[arguments.length - 1]; const o = indexedDB.open('kadr-log');
          o.onsuccess = () => { try { const r = o.result.transaction('log').objectStore('log').getAll(); r.onsuccess = () => done(JSON.stringify(r.result).match(/speech download[^"]*/g) ?? []); r.onerror = () => done([]); } catch (e) { done([]); } };
          o.onerror = () => done([]);`).catch(() => []);
        const all = [...new Set([...notes, ...logged])];
        const store = [...new Set(all.map((t) => /store (\w+)/.exec(t)?.[1]).filter(Boolean))].join(', ') || null;
        return { speed, one, two, seconds: Math.round((Date.now() - t0) / 1000), lines: await c.count('.caption-row'), notes: all.slice(0, 4), store };
      },
      judge: (m) => {
        const values = [...m.one.values, ...(m.two?.values ?? [])];
        const grows = (v) => v.length >= 2 && v.every((x, i) => i === 0 || x >= v[i - 1]) && v.at(-1) > v[0];
        const silent = Math.max(m.one.silentMs, m.two?.silentMs ?? 0);
        const last = (m.two ?? m.one).values.at(-1) ?? 0;
        return [
          holds('«N из M МБ» растёт', grows(m.one.values) && (!m.two || m.two.values.length < 2 || grows(m.two.values)), values.slice(0, 3).concat(values.length > 3 ? ['…', values.at(-1)] : []).join(' → ') || 'чисел нет', 'растёт'),
          holds('нигде 45 с без слов', silent <= 45_000, `${Math.round(silent / 1000)} с`, '≤ 45 с, или слова «остановилось»'),
          // «N из M МБ» counts only what this load fetches: M is the missing bytes (captions.ts missingBytes), so after the
          // reload M = 225 − the kept parts and N starts from 0 (integration-7 + 05a0555, 2026-11-23: «из 158» after 75 MB —
          // 4 whole parts of 16.8 MB kept, the 5th lost half-way). Kept = M before − M after; a part may be lost, not more.
          m.two ? holds('после перезагрузки — с сохранённого', m.one.of != null && m.two.of != null && m.one.of - m.two.of >= m.one.values.at(-1) - 17,
            `просит ${m.two.of ?? '—'} МБ из ${m.one.of ?? '—'}: сохранено ${m.one.of != null && m.two.of != null ? m.one.of - m.two.of : '—'} МБ из скачанных ${m.one.values.at(-1)}`, 'теряется не больше одной части (16,8 МБ)') : null,
          m.two ? record('счётчик после перезагрузки', `${m.two.values[0] ?? '—'} → ${m.two.values.at(-1) ?? '—'} из ${m.two.of ?? '—'} МБ`) : null,
          m.lines > 0 ? record('дошла до субтитров', `${m.seconds} с, строк ${m.lines}`) : record('медленная сеть', `${last} МБ за ${m.seconds} с — загрузка не дошла за отведённое время`),
          record('сеть Mac (часть 4 МБ)', m.speed.map((x) => `${x.host} ${x.kbps ?? x.error} КБ/с`).join(', ')),
          record('слова об остановке', m.one.stopped ?? m.two?.stopped ?? 'не было'), record('хранилище частей', m.store ?? 'заметки нет'), record('заметка загрузки', m.notes.join(' / ') || 'нет'),
        ];
      },
    },
    {
      id: 'SW-U-17 (скраб во время воспроизведения)', price: 4,
      // Ten jumps of the timeline while Kadr plays: each answered by a frame near the asked time (v1.9.14: 3 of 10 after 2.4–3.5 s).
      run: async (c) => {
        await c.fresh(['long_1.mp4'], { aspect: '16:9' });
        await sleep(2000);
        const zoom = 600 / (await c.jsAsync(STEP, 600, null)).t;
        await c.seek(0);
        await sleep(800);
        await c.tap('Play');
        await sleep(1500);
        const jumps = [];
        for (const s of [40, 12, 50, 25, 5, 33, 45, 18, 55, 28]) {
          jumps.push(await c.jsAsync(`const done = arguments[arguments.length - 1], x = arguments[0], want = arguments[1], P = window.__kadrPerf, el = document.querySelector('.tl-scroll'), t0 = performance.now();
            el.scrollLeft = x;
            const tick = () => { if (P.last.at > t0 && Math.abs(P.last.t - want) < 0.6) done({ want, ms: Math.round(P.last.at - t0) }); else if (performance.now() - t0 > 6000) done({ want, ms: 6000 }); else setTimeout(tick, 2); }; tick();`, Math.round(s * zoom), s));
          await sleep(1200);
        }
        await c.tap('Pause').catch(() => undefined);
        return { jumps };
      },
      judge: (m) => [kOfN('прыжок ответил кадром у места ≤ 300 мс', m.jumps, (j) => j.ms <= 300, 10), record('мс по прыжкам', m.jumps.map((j) => j.ms).join(', ')), record('p90', percentile(m.jumps.map((j) => j.ms), 0.9), ' мс')],
    },
  ],
  manual: [
    { id: 'SW-A-22 (приложение с экрана «Домой»)', steps: 'Шаги 20–22 ручного списка: «Сохранить копию всех проектов» в Safari → «Восстановить копию» в приложении с экрана «Домой».', limit: 'в приложении все проекты из Safari, открываются и играют' },
    { id: 'SW-S-2 (приложение с экрана «Домой»)', steps: 'В приложении с экрана «Домой»: «Субтитры» с моделью 225 МБ; посреди загрузки погасить экран на 1 мин, включить.', limit: 'загрузка идёт дальше или Kadr говорит «остановилось» и продолжает с того же места по касанию' },
  ],
});
