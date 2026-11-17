// L5 of lane B of the sweep (docs/21; reports/L5 — очередь.md, section B of the sweep-perf branch): speed and memory on a
// real iPhone — the person tools run in a worker (MediaPipe not in the page) and answer in time, the interface keeps up
// while they work during playback (V-167, F-07).
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-b.mjs [site URL]      (runner and env: scripts/l5-sweep.mjs)
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, holds, none, record } from './l5-verdict.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** MediaPipe's own script in the page: with V-167 it lives in a worker and the page has none. */
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
  ],
  manual: [
    { id: 'V-167 (отклик, пальцем)', steps: '`?perf`, walk.mp4 16:9, «Скрыть лица» и «Вырез», воспроизведение 10 с, во время него тап «Скорость» пальцем; видео экрана 60 fps, кадры от касания до листа.', limit: 'касание → лист ≤ 100 мс; кадров превью ≥ 15 в секунду' },
  ],
});
