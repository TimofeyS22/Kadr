// L5 of lane C of the sweep (docs/21; reports/L5 — очередь.md, section C): video and canvas on a real iPhone — the
// preview, the photo and the video frame alike on Apple's GPU (Q-11), Reverse with its Cancel and twice over (Q-10), the
// person tools on a 30 s 1080p video and its export (Q-13, Q-14), Extract audio twice and a silent clip at 2× (SW-C-1,
// SW-C-4), WebGL contexts after twenty reopenings (SW-D-4).
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-c.mjs [site URL]      (runner and env: scripts/l5-sweep.mjs)
import { fixture, luma, make, probe, rgb } from './l5-session.mjs';
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, equals, glChecks, holds, meanAbsDiff, none, record, sameFrame, wholeFile } from './l5-verdict.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** Reverse of the selected clip: milliseconds until the work's veil is gone. */
async function reverse(c, ms = 300_000) {
  const t = Date.now();
  await c.tool('Reverse');
  await c.waitFor('the reverse to start', () => c.js("return !!document.querySelector('.busy')"), 10_000).catch(() => undefined);
  await c.idle(ms);
  return Date.now() - t;
}

/** The ends of every look tool, written into the stored project as the e2e reaches them through its sheets (Q-11). */
const PATCH = `const done = arguments[arguments.length - 1], id = arguments[0];
  const o = indexedDB.open('kadr'); o.onerror = () => done('no db');
  o.onsuccess = () => { const db = o.result, get = db.transaction('kv').objectStore('kv').get('p:' + id);
    get.onsuccess = () => {
      const p = get.result; if (!p) { done('no project'); return; }
      const clips = p.tracks.find((t) => t.kind === 'main').clips;
      const unsigned = ['fade', 'vignette', 'sharpen', 'grain'];
      const ends = (c, top) => { for (const k of Object.keys(c.adjust)) c.adjust[k] = top ? 1 : unsigned.includes(k) ? 0 : -1; };
      ends(clips[0], true);
      ends(clips[1], false);
      clips[2].filter = { id: 'cyber', intensity: 1 }; clips[2].effect = { id: 'glitch', amount: 1 };
      // 9:16 out of the 16:9 bars at 4×, in the bottom right corner; Blur at full strength.
      const w = (720 * 9 / 16) / 1280 / 4; clips[3].crop = { x: 1 - w, y: 0.75, w, h: 0.25 }; clips[3].effect = { id: 'blur', amount: 1 };
      p.rev = (p.rev ?? 0) + 1; p.updatedAt = Date.now();
      const put = db.transaction('kv', 'readwrite').objectStore('kv').put(p, 'p:' + id);
      put.onsuccess = () => { db.close(); localStorage.removeItem('kadr.journal'); done(true); };
      put.onerror = () => { db.close(); done(String(put.error)); };
    };
    get.onerror = () => done(String(get.error)); };`;

await sweep({
  lane: 'c',
  title: 'участок C (видео и холст)',
  items: [
    {
      id: 'Q-11 (WYSIWYG на GPU iPhone)', price: 2,
      // Built as in qa-video-look «look tools at their ends»: the four clips through «Media», their looks written into
      // the stored project (the sheets' sliders are the e2e's business), without the e2e's LUT. Then each clip's middle:
      // the preview as the phone shows it, «Photo», and the frame of the exported video.
      run: async (c) => {
        await c.fresh(['walk.mp4', 'person.jpg', 'photo.png', 'landscape.mp4']);
        await c.waitFor('four clips', async () => (await c.count('.tl-row.main .clip')) === 4, 60_000);
        const id = await c.projectId();
        const middles = await c.js("const els = [...document.querySelectorAll('.tl-row.main .clip')]; return els.map((e) => (e.offsetLeft - els[0].offsetLeft + e.offsetWidth / 2) / 60);");
        await c.leave();
        const patched = await c.jsAsync(PATCH, id);
        if (patched !== true) throw new Error(`the looks did not go into the project: ${patched}`);
        await c.openFirst();
        const kept = await c.stored();
        if (kept?.tracks.find((t) => t.kind === 'main').clips[2].filter?.id !== 'cyber') throw new Error('the editor wrote the project back without the looks');
        const { file: video } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'q-11-video.mp4' });
        const names = ['видео, Adjust в верх', 'фото, Adjust в низ', 'фото, Cyber 100% + Glitch', 'полосы 9:16 ×4 в углу + Blur'];
        const points = [];
        for (const [k, at] of middles.entries()) {
          const t = Math.round(at * 30) / 30;
          await c.exactAt(t);
          const preview = await c.previewShot(`q-11-preview-${k + 1}`);
          const { file: photo } = await c.exportAs({ format: 'Photo', file: `q-11-photo-${k + 1}.jpg` });
          points.push({ name: names[k], t, cast: k === 3 ? 2 : 0.8, preview: rgb(preview), photo: rgb(photo), frame: rgb(video, Math.round(t * 30)) });
        }
        return { points: points.map((p) => ({ ...p, checks: sameFrame(p.name, p.preview, p.photo, p.frame, p.cast) })).map(({ preview: _a, photo: _b, frame: _c, ...p }) => p), video: probe(video) };
      },
      judge: (m) => ({ checks: [...m.points.flatMap((p) => p.checks), ...wholeFile(m.video, { audio: false })], look: 'снимки q-11-preview-*.png и q-11-photo-*.jpg — глазами, если цифры на границе' }),
    },
    {
      id: 'SW-C-1, SW-C-4', price: 2,
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.selectClip();
        await c.tool('Extract audio');
        await c.waitFor('the sound on its own track', async () => (await c.count('.tl-row.audio .clip')) >= 1, 30_000);
        await sleep(800);
        await c.selectClip();
        await c.tool('Extract audio');
        await sleep(1500);
        const tracks = await c.js("return { audioClips: document.querySelectorAll('.tl-row.audio .clip').length, audioRows: document.querySelectorAll('.tl-row.audio').length }");
        await c.closeTools();
        // A screen recording has no sound: silent.mp4 at 2×, exported and saved.
        await c.fresh(['silent.mp4']);
        await c.selectClip();
        await c.tool('Speed');
        await c.tap('2×');
        await sleep(1500);
        await c.waitFor('the sound processed', () => c.js("return !document.querySelector('.inline-progress')"), 120_000);
        await c.tap('Done');
        await c.closeTools();
        const length = await c.timelineLength();
        // The defect is the export failing with «This clip has no sound»: that is a verdict, not a broken scenario.
        const done = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'sw-c-4-silent-2x.mp4' }).catch((e) => ({ failed: e.message }));
        const notes = (await c.page()).notes;
        const noSound = [...notes, done.failed ?? ''].filter((n) => /has no sound|нет звука/i.test(n));
        return { tracks, length, file: done.file ? probe(done.file) : null, failed: done.failed ?? null, noSound };
      },
      judge: (m) => [equals('клипов звука после двух «Извлечь звук»', m.tracks.audioClips, 1), none('«This clip has no sound» при экспорте', m.noSound),
        ...(m.file ? wholeFile(m.file, { duration: m.length, audio: false }) : [holds('экспорт дошёл до файла', false, m.failed, 'да')])],
    },
    {
      id: 'Q-13, Q-14 на iPhone', price: 2,
      // 30 s 1080p with a person: walk.mp4 (5 s, a walking person) six times over, made on the Mac.
      run: async (c) => {
        const walk30 = make(c.out, 'walk-30s-1080p.mp4', ['-stream_loop', '5', '-i', fixture('walk.mp4'), '-vf', 'scale=1920:1080', '-t', '30', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-an']);
        await c.fresh([walk30]);
        const took = {};
        await c.selectClip();
        let t = Date.now();
        await c.tool('Cutout');
        await c.waitFor('the cutout', async () => (await c.toolOn('Cutout')) || (await c.js("return [...document.querySelectorAll('.toast')].some((e) => /Background removed|No person found/.test(e.textContent))")), 180_000);
        took.cutoutS = (Date.now() - t) / 1000;
        took.cutoutOn = await c.toolOn('Cutout'); // «No person found» also ends the wait, with the cutout off
        await c.selectClip();
        t = Date.now();
        await c.tool('Hide faces');
        await c.tap('Hide faces automatically');
        await c.waitFor('faces hidden', () => c.checked('Hide faces automatically'), 180_000);
        await c.idle(180_000);
        took.facesS = (Date.now() - t) / 1000;
        await c.tap('Done');
        await c.selectClip();
        t = Date.now();
        await c.tool('Auto reframe');
        await c.waitFor('reframed', () => c.js("return /Reframed/.test(document.body.innerText)"), 180_000);
        took.reframeS = (Date.now() - t) / 1000;
        await c.closeTools();
        const length = await c.timelineLength();
        await c.shot('q-13-editor');
        const { file, ms } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'q-13-export.mp4' });
        return { ...took, exportS: ms / 1000, length, file: probe(file) };
      },
      judge: (m) => [holds('вырез включён', m.cutoutOn, m.cutoutOn, 'да'), atMost('«Вырезать фон»', m.cutoutS, 60, ' с'), atMost('«Скрыть лица» (авто)', m.facesS, 60, ' с'), atMost('«Авторефрейм»', m.reframeS, 60, ' с'),
        atMost('экспорт', m.exportS, 3 * m.length, ' с'), ...wholeFile(m.file, { duration: m.length, audio: false, minHeight: 1080 })],
    },
    {
      id: 'Q-10 реверс', price: 4,
      run: async (c) => {
        await c.fresh(['long_1.mp4'], { aspect: '16:9' });
        await c.selectClip();
        await c.tool('Reverse');
        await c.waitFor('the reverse to start', () => c.js("return !!document.querySelector('.busy')"), 10_000);
        await sleep(2000);
        // Cancel and the veil's going, timed in the page: one call, no request between them.
        const cancelMs = await c.jsAsync(`const done = arguments[arguments.length - 1];
          const b = [...document.querySelectorAll('.busy button')].find((x) => x.textContent.trim() === 'Cancel'); if (!b) { done(-1); return; }
          const t0 = performance.now(); b.click();
          const tick = () => { if (!document.querySelector('.busy')) done(Math.round(performance.now() - t0)); else if (performance.now() - t0 > 60000) done(60000); else setTimeout(tick, 20); }; tick();`);
        await sleep(1000);
        await c.selectClip();
        const fullMs = await reverse(c, 300_000);
        // The veil goes before the reverse is committed; the save follows ~600 ms later.
        const on = await c.waitFor('the reverse saved', async () => !!(await c.stored())?.tracks.find((t) => t.kind === 'main').clips[0]?.reversedFrom, 15_000).catch(() => false);
        // Twice over on the counter: the frame at 2 s is the same as before the first reverse.
        await c.fresh(['counter.mp4'], { aspect: '16:9' });
        await c.exactAt(2);
        const before = rgb(await c.previewShot('q-10-counter-before'));
        await c.selectClip();
        await reverse(c, 120_000);
        await c.selectClip();
        await c.tool('Reverse'); // the second tap plays forward again
        await sleep(1500);
        await c.closeTools();
        await c.exactAt(2.5);
        await c.exactAt(2);
        const after = rgb(await c.previewShot('q-10-counter-after'));
        return { cancelMs, fullS: fullMs / 1000, reversedOn: on, sameFrame: meanAbsDiff(before, after) };
      },
      judge: (m) => [atMost('«Отмена» убирает оверлей', m.cancelMs, 3000, ' мс'), holds('«Отмена» нашлась', m.cancelMs >= 0, m.cancelMs, 'есть'), atMost('реверс 60 с 1080p', m.fullS, 60, ' с'),
        holds('реверс включён', m.reversedOn, m.reversedOn, 'да'), atMost('двойной реверс: разница кадра 2 с', m.sameFrame, 3), record('пик памяти вкладки', 'Web Inspector')],
    },
    {
      id: 'SW-D-4', price: 3,
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        for (let i = 0; i < 20; i++) {
          await c.leave();
          await c.openFirst();
          await sleep(600);
        }
        const before = await c.page();
        await c.tap('Play');
        await sleep(2000);
        const after = await c.page();
        await c.tap('Pause').catch(() => undefined);
        return { gl: after.gl, drawn: after.drawn - before.drawn, luma: luma(await c.previewShot('sw-d-4-preview')) };
      },
      judge: (m) => [...glChecks(m.gl), atLeast('кадров превью за 2 с воспроизведения', m.drawn, 20), atLeast('яркость превью', m.luma, 10)],
    },
  ],
  manual: [
    { id: 'Q-10 (память)', steps: 'Web Inspector по кабелю → Timelines → Memory: «Реверс» видео 60 с 1080p до конца, затем «Реверс» ещё раз.', limit: 'вкладка жива; пик памяти вкладки — записать' },
    { id: 'Q-8 пальцем', steps: 'Выбрать 3 клипа на двух дорожках касаниями, «Дублировать», «Удалить», «Отменить».', limit: 'ни одного случайного сдвига клипа; выбор — 1 касание на клип; отмена — одним касанием' },
    { id: 'Q-12, Q-16', steps: 'Проекты `qa-video-keys` «…at their ends…» и `qa-video-canvas` собрать на телефоне вручную; снимок превью, «Фото», кадр видео в середине каждого; сравнить на Mac (`rgb`/`sameFrame` из scripts/l5-verdict.mjs).', limit: 'средняя разница ≤ 4 (фото) / ≤ 6 (видео), блок 15×15 ≤ 20, цветовой сдвиг ≤ 0,8 (≤ 2 для ярких во весь кадр)' },
    { id: 'SW-D-4 (консоль)', steps: 'Web Inspector по кабелю, вкладка Console, пока скрипт открывает проект 20 раз.', limit: 'нет «too many active WebGL contexts»' },
  ],
});
