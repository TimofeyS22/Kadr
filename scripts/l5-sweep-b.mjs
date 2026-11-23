// L5 of lane B of the sweep (docs/21; reports/L5 — очередь.md, section B of the sweep-perf branch): speed and memory on a
// real iPhone — the person tools run in a worker (MediaPipe not in the page) and answer in time, the interface keeps up
// while they work during playback (V-167, F-07).
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-b.mjs [site URL]      (runner and env: scripts/l5-sweep.mjs)
import { make } from './l5-session.mjs';
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, holds, kOfN, none, record } from './l5-verdict.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** MediaPipe's own script in the page: with V-167 it lives in a worker and the page has none. */
/** The work's veil read in the page every 50 ms: each new text with its time (the download's «x of 3.5 MB» as it grows). */
const SAMPLER = `window.__l3 = { seen: [], t0: performance.now() };
  clearInterval(window.__l3timer);
  window.__l3timer = setInterval(() => { const b = document.querySelector('.busy'); const t = b ? b.textContent.replace(/\\s+/g, ' ').trim().slice(0, 160) : '';
    const S = window.__l3.seen; if (t && (S.length === 0 || S[S.length - 1].t !== t)) S.push({ at: Math.round(performance.now() - window.__l3.t0), t }); }, 50);`;
/**
 * SW-L-3: the first Cutout in a fresh cache. The ribbon is scrolled to «Cutout» and the tap comes 3 s later (the load
 * starts as the tool comes into sight). `underWorker`: the page is reloaded once first, so the service worker serves it.
 */
async function firstCutout(c, underWorker) {
  await c.fresh(['person.jpg']);
  if (underWorker) {
    await c.call('POST', `${c.S}/refresh`, {});
    await c.waitFor('the editor again', () => c.js("return !!document.querySelector('.preview-canvas')"), 60_000);
    await c.watch();
  }
  const controlled = await c.js('return !!navigator.serviceWorker?.controller');
  await c.selectClip();
  await c.js("const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => (e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? '').trim() === 'Cutout'); t?.scrollIntoView({ inline: 'nearest', block: 'nearest' });");
  await sleep(3000);
  await c.js(SAMPLER);
  const t = Date.now();
  await c.tool('Cutout');
  const end = await c.waitFor('the cutout or its words', () => c.js(`const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => (e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? '').trim() === 'Cutout');
    const said = [...document.querySelectorAll('.toast')].map((e) => e.textContent).find((x) => /Background removed|did not load|did not finish|No person found/.test(x));
    return t?.getAttribute('aria-pressed') === 'true' || said ? { on: t?.getAttribute('aria-pressed') === 'true', said: said ?? null } : null;`), 300_000);
  const seconds = (Date.now() - t) / 1000;
  const seen = await c.js('clearInterval(window.__l3timer); return window.__l3.seen');
  const xs = seen.map((s) => /([\d.]+) of ([\d.]+) MB/.exec(s.t)).filter(Boolean).map((m) => Number(m[1]));
  return { controlled, seconds, on: end.on, said: end.said, veil: seen.slice(0, 6).map((s) => `${s.at} мс: ${s.t}`), values: new Set(xs).size, first: xs[0] ?? null, last: xs.at(-1) ?? null,
    grows: xs.every((x, i) => i === 0 || x >= xs[i - 1]), silentAfterMs: seen.length ? null : Math.round(seconds * 1000) };
}
const judgeFirstCutout = (m) => [holds('вырез сделан', m.on, m.said ?? m.on, 'да'), none('«server did not answer» и прочие отказы', m.said && !/Background removed/.test(m.said) ? [m.said] : []),
  holds('x растёт, не скачет назад', m.grows, m.grows, 'да'), record('значений x за загрузку', m.values), record('x: первое и последнее', `${m.first} → ${m.last}`),
  record('секунд от касания до выреза', m.seconds), record('страница под service worker', m.controlled), record('окно', m.veil.join(' / ') || 'окна не было: модель успела до касания')];

/** G-6: a marker that a reload (a tab the system killed) wipes, set when the scenario starts. */
const MARK = "window.__g6 = (window.__g6 ?? 0) + 1; return window.__g6;";

const INPAGE = "return [...document.scripts].map((s) => s.src).filter((s) => /vision_wasm_internal|vision_bundle/.test(s))";

await sweep({
  lane: 'b',
  title: 'участок B (скорость и память)',
  items: [
    {
      id: 'V-167, F-07 (воркер)', price: 4,
      run: async (c) => {
        await c.fresh(['person.jpg']);
        await c.selectClip();
        let t = Date.now();
        await c.tool('Cutout');
        await c.waitFor('the cutout', async () => (await c.toolOn('Cutout')) || (await c.js("return [...document.querySelectorAll('.toast')].some((e) => /Background removed|No person found/.test(e.textContent))")), 120_000);
        const cutoutS = (Date.now() - t) / 1000;
        const cutoutOn = await c.toolOn('Cutout'); // «No person found» also ends the wait, with the cutout off
        const said = (await c.page()).notes.filter((n) => /No person found/.test(n)); // before the next page wipes them
        await c.closeTools();
        await sleep(1000);
        await c.shot('v-167-cutout-edge');
        const cutoutScripts = await c.js(INPAGE);
        await c.fresh(['walk.mp4'], { aspect: '16:9' });
        await c.selectClip();
        t = Date.now();
        await c.tool('Hide faces');
        await c.tap('Hide faces automatically');
        await c.waitFor('faces hidden', () => c.checked('Hide faces automatically'), 120_000);
        await c.idle(120_000);
        const facesS = (Date.now() - t) / 1000;
        await c.tap('Done');
        await c.closeTools();
        await c.tap('Play');
        await sleep(5000);
        await c.tap('Pause').catch(() => undefined);
        return { cutoutS, cutoutOn, facesS, scripts: [...cutoutScripts, ...(await c.js(INPAGE))], said };
      },
      judge: (m) => ({ checks: [holds('вырез включён', m.cutoutOn, m.cutoutOn, 'да'), atMost('«Вырез» включился', m.cutoutS, 30, ' с'), atMost('«Скрыть лица» включились', m.facesS, 30, ' с'), none('MediaPipe в странице (script)', m.scripts), none('«No person found» на человеке', m.said)], look: 'край выреза — снимок v-167-cutout-edge.png против Mac' }),
    },
    {
      id: 'V-167 (отклик)', price: 4,
      // During playback with both person tools on, «Speed» is tapped (click() in the page — a finger's own delay is not
      // in it); the tap to its sheet painted and the preview's frames in the same 3 s are read in one call.
      run: async (c) => {
        await c.fresh(['walk.mp4'], { aspect: '16:9' });
        await c.selectClip();
        await c.tool('Hide faces');
        await c.tap('Hide faces automatically');
        await c.waitFor('faces hidden', () => c.checked('Hide faces automatically'), 120_000);
        await c.idle(120_000);
        await c.tap('Done');
        await c.selectClip();
        await c.tool('Cutout');
        await c.waitFor('the cutout', () => c.toolOn('Cutout'), 120_000);
        await c.tap('Play');
        await sleep(2000);
        const r = await c.jsAsync(`const done = arguments[arguments.length - 1], P = window.__kadrPerf, n0 = P.drawn, t0 = performance.now();
          const tool = [...document.querySelectorAll('.toolbar .tool')].find((e) => (e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? '').trim() === 'Speed');
          if (!tool) { done({ error: 'no Speed tool' }); return; }
          tool.click();
          let sheetMs = null, seen = false;
          const tick = () => {
            // The sheet is in the page: the frame after this one is the first that shows it.
            if (!seen && document.querySelector('.sheet')) { seen = true; requestAnimationFrame(() => { sheetMs = Math.round(performance.now() - t0); }); }
            if (performance.now() - t0 < 3000) requestAnimationFrame(tick); else done({ sheetMs, fps: Math.round(((P.drawn - n0) / ((performance.now() - t0) / 1000)) * 10) / 10 });
          };
          requestAnimationFrame(tick);`);
        await c.tap('Pause').catch(() => undefined);
        if (r.error) throw new Error(r.error);
        return r;
      },
      judge: (m) => [atMost('касание «Скорость» → лист нарисован', m.sheetMs, 100, ' мс'), atLeast('кадров превью в секунду', m.fps, 15), holds('лист открылся', m.sheetMs !== null, m.sheetMs, 'да'), record('касание', 'click() в странице, без задержки пальца')],
    },
    {
      id: 'SW-L-3 (а) первая загрузка, без service worker', price: 4, newSession: true,
      run: (c) => firstCutout(c, false),
      judge: judgeFirstCutout,
    },
    {
      id: 'SW-L-3 (б) первая загрузка под service worker', price: 4, newSession: true,
      // The queue's rule: fewer than 5 values of x here means WebKit's service worker hands the answer over whole.
      run: (c) => firstCutout(c, true),
      judge: (m) => ({ checks: judgeFirstCutout(m), look: m.values < 5 && m.veil.length ? 'значений x меньше 5: service worker WebKit отдаёт ответ целиком (очередь, строка SW-L-3)' : undefined }),
    },
    {
      id: 'G-6 (память)', price: 4,
      // Four scenarios three times; a tab the system killed loses the page's marker. Peak memory: Web Inspector, by hand.
      run: async (c) => {
        const long = make(c.out, 'long_15m.mp4', ['-f', 'lavfi', '-i', 'testsrc2=s=1920x1080:r=30:d=900', '-f', 'lavfi', '-i', 'sine=f=330:d=900', '-c:v', 'libx264', '-preset', 'ultrafast', '-b:v', '1M', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest']);
        const runs = [];
        const alive = async (mark) => (await c.js('return window.__g6 ?? null').catch(() => null)) === mark;
        for (let k = 1; k <= 3; k++) {
          let t = Date.now(), mark;
          await c.fresh(['walk.mp4'], { aspect: '16:9' }); mark = await c.js(MARK);
          await c.selectClip(); await c.tool('Hide faces'); await c.tap('Hide faces automatically');
          await c.waitFor('faces hidden', () => c.checked('Hide faces automatically'), 300_000); await c.idle(120_000); await c.tap('Done');
          await c.selectClip(); await c.tool('Cutout'); await c.waitFor('the cutout', () => c.toolOn('Cutout'), 300_000); await c.closeTools();
          await c.tap('Play'); await sleep(30_000); await c.tap('Pause').catch(() => undefined);
          runs.push({ k, what: 'лица + вырез, 30 с', alive: await alive(mark), s: (Date.now() - t) / 1000 });
          t = Date.now();
          await c.fresh(['speech_en.mp4']); mark = await c.js(MARK);
          await c.selectClip(); await c.tool('Volume'); await c.tap('Reduce background noise');
          await c.waitFor('noise reduced', () => c.checked('Reduce background noise'), 300_000);
          await c.waitFor('the sound processed', () => c.js("return !document.querySelector('.inline-progress')"), 300_000); await c.tap('Done');
          await c.closeTools(); await c.tap('Play'); await sleep(8000); await c.tap('Pause').catch(() => undefined);
          runs.push({ k, what: 'шумоподавление', alive: await alive(mark), s: (Date.now() - t) / 1000 });
          t = Date.now();
          await c.fresh(['phone_4k_hevc.mov'], { aspect: '16:9' }); mark = await c.js(MARK);
          await c.tap('Play'); await sleep(30_000); await c.tap('Pause').catch(() => undefined);
          const four = await c.exportAs({ preset: 'TikTok, Reels, Shorts' }).catch((e) => ({ failed: e.message }));
          runs.push({ k, what: '4K HEVC: 30 с и экспорт 1080p', alive: await alive(mark), exported: !four.failed, failed: four.failed ?? null, s: (Date.now() - t) / 1000 });
          t = Date.now();
          await c.fresh([long], { aspect: '16:9' }); mark = await c.js(MARK);
          for (const at of [700, 120, 455, 30, 860, 310, 610, 75, 520, 240]) { await c.seek(at); await sleep(400); }
          await c.selectClip(0); await c.seek(60); await sleep(500); await c.tool('Split');
          await c.waitFor('two pieces', async () => (await c.count('.tl-row.main .clip')) === 2, 20_000);
          await c.selectClip(1); await c.tool('Delete');
          await c.waitFor('one piece', async () => (await c.count('.tl-row.main .clip')) === 1, 20_000); await c.closeTools();
          const fifteen = await c.exportAs({ preset: 'TikTok, Reels, Shorts' }).catch((e) => ({ failed: e.message }));
          runs.push({ k, what: '15 мин: перемотки, экспорт 60 с', alive: await alive(mark), exported: !fifteen.failed, failed: fifteen.failed ?? null, s: (Date.now() - t) / 1000 });
          await c.js('window.__l5.blob = null;').catch(() => undefined);
          await c.cleanup();
          console.log(`  круг ${k}: ${runs.slice(-4).map((r) => `${r.what} ${r.alive ? 'жива' : 'ПЕРЕЗАГРУЖЕНА'}${r.exported === false ? ', экспорт НЕТ' : ''} ${Math.round(r.s)} с`).join('; ')}`);
        }
        return runs;
      },
      judge: (m) => [kOfN('вкладка не перезагружена', m, (r) => r.alive, 12), kOfN('экспорт готов', m.filter((r) => 'exported' in r), (r) => r.exported, 6),
        none('сбои экспорта', m.filter((r) => r.failed).map((r) => `${r.k} ${r.what}: ${r.failed.slice(0, 200)}`)),
        record('секунд по сценариям', m.map((r) => `${r.k}/${r.what.split(':')[0]} ${Math.round(r.s)}`).join('; ')), record('пик памяти вкладки', 'Web Inspector → Timelines → Memory, вручную')],
    },
  ],
  manual: [
    { id: 'V-167 (отклик, пальцем)', steps: '`?perf`, walk.mp4 16:9, «Скрыть лица» и «Вырез», воспроизведение 10 с, во время него тап «Скорость» пальцем; видео экрана 60 fps, кадры от касания до листа.', limit: 'касание → лист ≤ 100 мс; кадров превью ≥ 15 в секунду' },
  ],
});
