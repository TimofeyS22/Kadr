// L5 of lane A of the sweep (docs/21; reports/L5 — очередь.md, section A, with the rows of the lane-a-rc2 branch): storage
// and media on a real iPhone — a voice-over cut off by a reload comes back (SW-A-19), a project goes into a backup and
// back (Q-4, SW-A-4), camera takes in a row leave no error, empty strip or new lease (S-1-13, S-1-12), a reversed clip's
// sound against its picture (V-159), what «Stop» costs after a long take (М3), scrubbing and playback of the S1 project
// (Q-9, SW-A-2), the scrub of V-248, the phone's own takes for fixtures/real (V-161, V-201).
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-a.mjs [site URL]      (runner and env: scripts/l5-sweep.mjs)
//   Env: L5_CAMERA_RUNS (60), L5_STOP_TAKES (60,300 — seconds of the «Stop» takes).
// The first take asks for the camera, the first voice-over for the microphone: a person taps «Allow» on the phone.
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { avSync, make, packets, probe, rgb } from './l5-session.mjs';
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, cameraRuns, equals, holds, inSync, judge, meanAbsDiff, near, none, percentile, record, wholeFile } from './l5-verdict.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const REAL = join(import.meta.dirname, '..', 'fixtures', 'real');
const started = Date.now();
/** A camera take of `seconds`, then «Stop» and the take's clip, timed in the page in one call. */
async function take(c, seconds) {
  const before = await c.count('.tl-row.main .clip-video');
  await c.tool('Camera');
  await c.enabled('Start recording', 90_000);
  await c.tap('Start recording');
  await c.waitFor('recording (after the countdown)', () => c.has('Stop recording'), 20_000);
  await sleep(seconds * 1000);
  return c.jsAsync(`const done = arguments[arguments.length - 1], before = arguments[0];
    const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.getAttribute('aria-label') === 'Stop recording');
    if (!b) { done({ error: 'no Stop' }); return; }
    const t0 = performance.now(); b.click();
    const tick = () => { if (document.querySelectorAll('.tl-row.main .clip-video').length > before) done({ stopMs: Math.round(performance.now() - t0) });
      else if (performance.now() - t0 > 120000) done({ stopMs: null }); else setTimeout(tick, 25); }; tick();`, before);
}
/** The S1 project of docs/04: four 60 s 1080p videos (long_1–4.mp4). */
const S1 = ['long_1.mp4', 'long_2.mp4', 'long_3.mp4', 'long_4.mp4'];
/** One scrub step: the playhead moved by scrolling, then the first frame drawn at its time and the exact one (ms). */
const STEP = `const done = arguments[arguments.length - 1], x = arguments[0];
  (async () => {
    const P = window.__kadrPerf, el = document.querySelector('.tl-scroll'), t0 = performance.now();
    el.scrollLeft = x;
    let first = 0, t = NaN;
    while (performance.now() - t0 < 30000) {
      await new Promise((ok) => setTimeout(ok, 2));
      if (P.last.at <= t0) continue;
      if (Number.isNaN(t)) t = P.last.t;
      if (Math.abs(P.last.t - t) < 1e-3) { first ||= P.last.at - t0; if (P.last.exact) return { t, first, exact: P.last.at - t0 }; }
    }
    return { t, first: first || 30000, exact: 30000 };
  })().then(done, (e) => done({ error: String(e) }));`;

await sweep({
  lane: 'a',
  title: 'участок A (хранение и медиа)',
  items: [
    {
      id: 'SW-A-19', price: 1,
      // A voice-over of 10 s cut off by a reload of the page (iOS closing the tab is a manual step).
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.tool('Record');
        await c.enabled('Start recording', 90_000);
        await c.tap('Start recording');
        // The microphone is asked for on Start: a person taps «Allow» on the phone.
        await c.waitFor('recording (Allow the microphone on the phone)', () => c.has('Stop recording'), 90_000);
        const t0 = Date.now();
        await sleep(10_000);
        const recordedS = (Date.now() - t0) / 1000;
        // A reload (WebDriver «Refresh»): the same address with its #/p/… would be a move inside the page, not a new one.
        await c.call('POST', `${c.S}/refresh`, {});
        await c.waitFor('the editor again', () => c.js("return !!document.querySelector('.preview-canvas')"), 60_000);
        await c.watch();
        // The clip is committed first; the toast comes after the take's pieces are deleted (lane-a-rc2 Editor.tsx), and
        // the save ~600 ms after the commit. Both are waited for; the toasts are read off the page and off the watcher.
        const said = await c.waitFor('the voice-over and its toast', () => c.js("const t = [...new Set([...document.querySelectorAll('.toast')].map((e) => e.textContent).concat(window.__l5?.notes ?? []))]; return document.querySelectorAll('.tl-row.audio .clip').length > 0 && t.some((x) => /voice/i.test(x)) ? { toasts: t } : null;"), 30_000)
          .catch(async () => ({ toasts: await c.js("return [...document.querySelectorAll('.toast')].map((e) => e.textContent).concat(window.__l5?.notes ?? [])") }));
        const voicesOf = (p) => p?.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips) ?? [];
        const voices = await c.waitFor('the voice-over saved', async () => { const v = voicesOf(await c.stored()); return v.length ? v : null; }, 10_000).catch(() => []);
        await c.call('POST', `${c.S}/refresh`, {});
        await c.waitFor('the editor a third time', () => c.js("return !!document.querySelector('.preview-canvas')"), 60_000);
        await sleep(3000);
        await c.watch();
        const again = voicesOf(await c.stored());
        return { recordedS, voices: voices.map((v) => v.duration), toasts: said.toasts, afterSecondReload: again.length };
      },
      judge: (m) => [equals('клипов озвучки после перезагрузки', m.voices.length, 1), atLeast('длина озвучки', m.voices[0], m.recordedS - 1.5, ' с'),
        holds('тост о вернувшейся озвучке', m.toasts.some((t) => /voice|голос/i.test(t)), m.toasts.join(' / ') || 'нет', 'есть'), equals('клипов после второй перезагрузки', m.afterSecondReload, 1)],
    },
    {
      id: 'Q-4, SW-A-4', price: 1,
      // «Save to Files» and the pick from «Files» are replaced: the backup's bytes come to the Mac and go back into the page.
      run: async (c) => {
        const photos = Array.from({ length: 10 }, (_, i) => make(c.out, `q4-photo-${i + 1}.jpg`, ['-f', 'lavfi', '-i', `testsrc2=s=1600x1200:r=1:d=1,hue=h=${i * 36}`, '-frames:v', '1']));
        await c.fresh(['long_1.mp4', ...photos], { aspect: '16:9' });
        await c.waitFor('eleven clips', async () => (await c.count('.tl-row.main .clip')) === 11, 120_000);
        const length = await c.timelineLength();
        await c.exactAt(45);
        const frameBefore = rgb(await c.previewShot('q-4-before-45s'));
        await c.leave();
        const t1 = Date.now();
        await c.waitFor('Save a backup', () => c.js("const b = [...document.querySelectorAll('button')].find((x) => /^Save a backup of /.test(x.getAttribute('aria-label') || '')); if (!b) return false; b.click(); return true;"), 15_000);
        await c.waitFor('the backup', () => c.js('return !!window.__l5.blob'), 120_000);
        const backupS = (Date.now() - t1) / 1000;
        const file = await c.pull('q-4-backup.kadr');
        await c.cleanup();
        await c.home();
        await c.push(file);
        const t2 = Date.now();
        await c.tap('Restore backup');
        await c.waitFor('the restored project', async () => (await c.count('.tl-row.main .clip')) === 11, 120_000);
        const restoreS = (Date.now() - t2) / 1000;
        await c.watch();
        await c.projectId();
        const restored = await c.timelineLength();
        // A restored project that draws nothing is SW-A-4 itself (v1.9.11: the restored files are the whole backup):
        // a verdict, not a broken scenario. So is an export of it that fails.
        const drawn = await c.exactAt(45).then(() => true, () => false);
        const frameAfter = rgb(await c.previewShot('q-4-after-45s'));
        const done = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'q-4-restored.mp4' }).catch((e) => ({ failed: e.message }));
        return { length, restored, backupS, restoreS, backupMb: Math.round(statSync(file).size / 1e5) / 10, drawn, frame45: meanAbsDiff(frameBefore, frameAfter), file: done.file ? probe(done.file) : null, failed: done.failed ?? null };
      },
      judge: (m) => [near('длина восстановленного', m.restored, m.length, 0.05, ' с'), holds('восстановленный проект рисует кадр 0:45', m.drawn, m.drawn, 'да'), atMost('кадр 0:45 до и после', m.frame45, 3),
        atMost('копия', m.backupS, 15, ' с'), atMost('восстановление', m.restoreS, 15, ' с'), record('размер копии', m.backupMb, ' МБ'),
        ...(m.file ? wholeFile(m.file, { duration: m.length, tolerance: 0.1 }) : [holds('экспорт восстановленного дошёл до файла', false, m.failed, 'да')])],
    },
    {
      id: 'V-159', price: 2,
      run: async (c) => {
        const out = {};
        for (const [name, pairs] of [['avsync.mp4', 2], ['avsync_long.mp4', 8]]) {
          await c.fresh([name]);
          await c.selectClip();
          await c.tool('Reverse');
          await c.waitFor('the reverse to start', () => c.js("return !!document.querySelector('.busy')"), 10_000).catch(() => undefined);
          await c.idle(300_000);
          await c.closeTools();
          // The veil goes before the reverse is committed, and the save follows ~600 ms later (actions.ts, Editor.tsx).
          const clip = await c.waitFor(`${name}: the reverse saved`, async () => (await c.stored())?.tracks.find((t) => t.kind === 'main').clips[0]?.reversedFrom && (await c.stored()).tracks.find((t) => t.kind === 'main').clips[0], 15_000);
          const stored = await c.pullAsset(clip.assetId, `v-159-${name}-reversed-asset`);
          const { file } = await c.exportAs({ preset: 'Small file', loud: false, file: `v-159-${name}` });
          out[name] = { pairs, sync: avSync(file), packets: packets(stored) };
        }
        return out;
      },
      judge: (m) => Object.entries(m).flatMap(([k, r]) => [...inSync(r.sync, r.pairs).map((x) => ({ ...x, name: `${k}: ${x.name}` })), none(`${k}: пакеты перевёрнутого звука не по 1024`, r.packets.broken)]),
    },
    {
      ids: ['V-161, V-201 (дубли iPhone)'], price: 2,
      tools: { name: 'tools-v201', scenarios: ['s1-camera'], env: { S1_TAKES: '3', S1_TAKE_MS: '6000', S1_PULL: REAL } },
      judge: (rows) => {
        const made = (() => { try { return readdirSync(REAL).filter((f) => f.startsWith('iphone15_kadr_take_') && statSync(join(REAL, f)).mtimeMs >= started); } catch { return []; } })();
        return [judge('V-161, V-201 (дубли iPhone)', [holds('сценарий прошёл', rows[0]?.ok, rows[0]?.error ?? 'да', 'да'), atLeast('дублей в fixtures/real', made.length, 3)],
          made.length ? { look: `${made.join(', ')}: дописать README, затем npx playwright test e2e/qa-media-real.spec.ts (через scripts/e2e-slot.sh)` } : { error: 'дублей нет: в l5-tools нет S1_PULL (ветка lane-a-rc2 не слита?)' })];
      },
    },
    {
      id: 'М3, цена «Стоп»', price: 4,
      run: async (c) => {
        await c.fresh([]);
        const out = [];
        for (const s of (process.env.L5_STOP_TAKES ?? '60,300').split(',').map(Number)) {
          const r = await take(c, s);
          if (r.error) throw new Error(r.error);
          out.push({ seconds: s, stopMs: r.stopMs });
          await c.closeTools();
          await sleep(3000);
        }
        return out;
      },
      judge: (m) => [...m.map((r) => atMost(`«Стоп» после дубля ${r.seconds} с → клип`, r.stopMs, r.seconds >= 300 ? 15_000 : 3000, ' мс')), record('память вкладки до и после «Стоп»', 'Web Inspector, вручную')],
    },
    {
      id: 'Q-9, SW-A-2', price: 4,
      run: async (c) => {
        await c.fresh(S1, { aspect: '16:9' });
        await c.waitFor('four clips', async () => (await c.count('.tl-row.main .clip')) === 4, 180_000);
        await sleep(3000);
        const zoom = 600 / (await c.jsAsync(STEP, 600)).t;
        const steps = [];
        for (const s of [12, 187, 64, 221, 33, 150, 98, 239, 5, 171, 121, 45, 203, 77, 140, 18, 229, 109, 58, 196]) steps.push({ want: s, ...(await c.jsAsync(STEP, Math.round(s * zoom))) });
        // Playback 20 s from the start: frames drawn against 30 a second.
        await c.seek(0);
        await sleep(1500);
        const play = await c.jsAsync(`const done = arguments[arguments.length - 1], P = window.__kadrPerf;
          const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && e.getAttribute('aria-label') === 'Play'); if (!b) { done({ error: 'no Play' }); return; }
          b.click(); setTimeout(() => { const n0 = P.drawn, t0 = performance.now();
            setTimeout(() => { done({ fps: Math.round(((P.drawn - n0) / ((performance.now() - t0) / 1000)) * 10) / 10 }); }, 20000); }, 1000);`);
        // Three pauses: the frame on screen against «Photo».
        const pauses = [];
        for (let k = 0; k < 3; k++) {
          await sleep(1500 + k * 700);
          await c.tap('Pause');
          await sleep(1200);
          const shown = rgb(await c.previewShot(`q-9-pause-${k + 1}`));
          const { file } = await c.exportAs({ format: 'Photo', file: `q-9-photo-${k + 1}.jpg` });
          pauses.push(meanAbsDiff(shown, rgb(file)));
          await c.tap('Play');
        }
        await c.tap('Pause').catch(() => undefined);
        return { steps: steps.map((x) => ({ want: x.want, t: x.t, first: Math.round(x.first), exact: Math.round(x.exact) })), fps: play.fps, pauses };
      },
      judge: (m) => [atMost('отклик (первый кадр) p95', percentile(m.steps.map((x) => x.first), 0.95), 100, ' мс'), atMost('точный кадр после перемотки p95', percentile(m.steps.map((x) => x.exact), 0.95), 150, ' мс'),
        equals('перемоток мимо места', m.steps.filter((x) => Math.abs(x.t - x.want) > 0.1).length, 0), atLeast('воспроизведение', m.fps, 29, ' кадр/с'),
        atMost('пропуски кадров', Math.max(0, Math.round((1 - m.fps / 30) * 1000) / 10), 3, ' %'), atMost('после «Паузы» экран против «Фото» (худшая из 3)', Math.max(...m.pauses), 4)],
    },
    {
      ids: ['V-248'], price: 4,
      tools: { name: 'tools-v248', scenarios: ['scrub'] },
      judge: (rows) => {
        const r = rows[0], n = r?.note;
        if (!n) return [judge('V-248', [], { error: r?.error ?? 'нет строки scrub' })];
        return [judge('V-248', [atMost('p90 шага до первого кадра', n.firstP90, 100, ' мс'), atMost('декодеров на 40 шагов', n.decoders, 42), equals('шагов мимо места', n.missed, 0),
          none('тосты и ошибки', [...(r.toasts ?? []), ...(r.errors ?? [])]), record('худший шаг', n.firstMax, ' мс'), record('точный кадр p50', n.exactP50, ' мс')])];
      },
    },
    {
      ids: ['S-1-13, S-1-13-1 (М3)', 'S-1-12'], price: 1,
      // Last of the lane: an hour and more without a person (Auto-Lock «Never»). The runs' JSON is in L5_OUT/tools-camera.
      tools: { name: 'tools-camera', scenarios: Array(Number(process.env.L5_CAMERA_RUNS ?? 60)).fill('s1-camera'), env: { S1_TAKES: '5', S1_PAUSE: '1500' } },
      judge: (rows) => cameraRuns(rows, Number(process.env.L5_CAMERA_RUNS ?? 60)),
    },
  ],
  manual: [
    { id: 'М3, частная вкладка', steps: 'Частная вкладка Safari: дубль 20 с, закрыть вкладку посреди дубля, открыть проект.', limit: 'дубль вернулся, длительность ≥ записанной − 2 с' },
    { id: 'D-12', steps: 'Частная вкладка: проект 60 с 1080p, экспорт, «Сохранить»; затем 3 мин 1080p; Web Inspector → Timelines → Memory.', limit: 'пик памяти во время сборки файла — записать; правка нужна, если пик > 2× размера файла + 150 МБ или вкладка падает' },
    { id: 'М3, цена «Стоп» (память)', steps: 'Web Inspector → Memory во время дублей 60 с и 5 мин, которые снял скрипт (или повторить вручную).', limit: 'память вкладки не выше, чем до «Стоп», + 40 МБ' },
    { id: 'V-161, V-201 (набор владельца)', steps: 'Видео iPhone (HEVC HDR 4K60 из «Камеры», оригинал из «Фото») и Android → fixtures/real; затем `npx playwright test e2e/qa-media-real.spec.ts` через scripts/e2e-slot.sh.', limit: 'клип длиной файла ± 0,15 с; экспорт длиной таймлайна ± 0,15 с, звук где есть, середина кадра > 30 из 255' },
    { id: 'SW-A-10', steps: 'Два видео по 2,1+ ГиБ (или 4K60 10 мин): «Сохранить копию» → «Сохранить в Файлы», удалить проект, «Восстановить копию» из «Файлов».', limit: 'бэкап сохраняется; восстановленный проект целый, длительности как до; вкладка жива; если Safari не пишет 4+ ГиБ — человек слышит об этом' },
    { id: 'Q-4 (копия 1 ГБ)', steps: 'Пять видео 4K по 60 с: сохранить копию в «Файлы» и восстановить; Web Inspector → Memory.', limit: 'без падения вкладки; пик памяти не выше, чем до восстановления, + 150 МБ' },
    { id: 'SW-A-11', steps: 'Камера, дубль 10 с, посреди записи свайп от левого края; озвучка 5 с, посреди записи свайп назад; перезагрузить страницу.', limit: 'дубль — клип на главной, озвучка — на дорожке звука, каждая ≥ снятого − 1,5 с; после перезагрузки на месте; индикатор камеры и микрофона гаснет' },
    { id: 'SW-A-19 (частная вкладка, переключатель)', steps: 'Озвучка 10 с, закрыть вкладку из переключателя вкладок; то же в частной вкладке.', limit: 'озвучка на месте, ≥ записанного − 1,5 с; тост «Закадровый голос… вернулся в проект»; после второй перезагрузки клип один' },
    { id: 'SW-A-17', steps: 'Камера, дубль; посреди записи открыть ссылку того же проекта во второй вкладке, 6 с, вернуться, «Стоп»; то же с озвучкой; затем дубль 10 с, закрыть вкладку посреди записи, открыть проект в двух вкладках.', limit: 'вторая вкладка клипа не получает; записывающая получает весь дубль; во втором — дубль ровно в одной вкладке' },
    { id: 'SW-A-3', steps: 'Главная с тремя проектами, пальцем: середина «Новый проект», затем «Пример», «Восстановить копию».', limit: 'каждое касание делает своё; ни переименования, ни копии, ни удаления' },
    { id: 'Q-6', steps: 'Снять 10 с HDR (Dolby Vision): разрезать на 1 с, первую часть «Реверс», остальное 2×; экспорт; «Фото» в середине частей; ffmpeg на Mac.', limit: 'файл не тусклый (Y > 30, насыщенность > 60), длина = таймлайн ± 0,1 с, стерео > −30 дБ; превью = фото = кадр: ≤ 4 / ≤ 6, сдвиг ≤ 0,8' },
    { id: 'Q-27', steps: 'Фронтальная камера, суфлёр 200 слов, дубль 10 с; задняя, дубль 0,5 с; два дубля подряд; затем владелец запрещает камеру в настройках сайта и жмёт «Камера».', limit: 'дубли по порядку, длина ± 0,3 с; звук ± 1 кадр; фронтальная зеркально; запрет — слова Kadr, «Закрыть» работает, индикатор гаснет' },
    { id: 'Q-5', steps: '`node scripts/l5-import.mjs` + выбор в «Фото»: три HEVC 4K по 20 с («Текущий») и 12 фото одним выбором; «Файлы»: .mov и .mp4; двойной тап «Медиа»; экспорт.', limit: 'клипы ≤ 2 с после выбора; 12 фото по порядку, одна «Отмена» убирает все; двойной тап — один выбор; тостов 0; экспорт целый' },
    { id: 'Q-9 (палец)', steps: 'S1-проект: 20 перемоток пальцем по таймлайну.', limit: 'палец не листает страницу' },
  ],
});
