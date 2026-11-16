// L5 of lane L (docs/21 §3: «only the iPhone»): the device checklist of every release (reports/Чек-лист устройства.md)
// where a script can stand in for the person — D-1 the version, D-3 captions with one tap, D-4 the reel, D-5 the 1080p
// export (the file, not «Photos»), D-6 close and open — and V-169, canvases left to the collector. D-2, D-5's «Photos»,
// D-7 and the rows that need a finger or a calendar are printed at the end. Thresholds: reports/L5 — прогон v1.9.12.md.
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-l.mjs [site URL]      (runner and env: scripts/l5-sweep.mjs)
//   Env: L5_EXPECT (v1.9.12: the version the footer must show).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { avSync, probe } from './l5-session.mjs';
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, equals, glChecks, holds, inSync, judge, none, record, wer, wholeFile } from './l5-verdict.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const TEXTS = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'e2e', 'eval', 'texts.json'), 'utf8'));
const EXPECT = process.env.L5_EXPECT ?? 'v1.9.12';
/** What the project is made of, to compare before and after: each clip's kind, place and length on every track. */
const shape = (p) => p && p.tracks.map((t) => `${t.kind}:${t.clips.map((c) => `${c.kind}@${c.start.toFixed(3)}+${c.duration.toFixed(3)}`).join(',')}`).join(' | ');

await sweep({
  lane: 'l',
  title: 'участок L (чек-лист устройства и строки «только iPhone»)',
  items: [
    {
      id: 'D-1', price: 3,
      // First: the served version. A wrong one makes the rest of the run about another release.
      // That the owner's own Safari takes it by itself on the home screen is D-1's manual half.
      run: async (c) => {
        await c.home();
        return { version: await c.js("return (document.querySelector('.home-foot')?.textContent.match(/v\\d+\\.\\d+\\.\\d+/) ?? [null])[0]") };
      },
      judge: (m) => [equals('версия в подвале', m.version, EXPECT)],
      page: false,
    },
    {
      id: 'D-6', price: 1,
      // «Close the tab, open again»: a new page of the site (the session's own tab), the project opened from home.
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.selectClip();
        await c.seek(2);
        await sleep(600);
        await c.tool('Split');
        await c.waitFor('the split', async () => (await c.count('.tl-row.main .clip')) === 2, 15_000);
        await c.closeTools();
        await sleep(3000);
        const before = shape(await c.stored());
        await c.call('POST', `${c.S}/url`, { url: `${c.url}?l5reopen=1` });
        await c.watch();
        await c.openFirst();
        return { before, after: shape(await c.stored()), clips: await c.count('.tl-row.main .clip') };
      },
      judge: (m) => [equals('клипов после закрыть-открыть', m.clips, 2), holds('проект тот же (дорожки, места, длины)', m.before === m.after && !!m.before, m.after ?? 'нет', m.before ?? '—')],
    },
    {
      id: 'D-3', price: 2,
      // One tap on «Субтитры» in the Russian interface; every question about a model answered yes (the first run downloads it).
      run: async (c) => {
        await c.fresh(['eval_ru.mp4'], { ru: true });
        const t = Date.now();
        await c.tap('Субтитры');
        await c.waitFor('the caption lines', async () => {
          await c.js("const b = [...document.querySelectorAll('button')].find((e) => e.offsetParent !== null && ['Скачать и сделать субтитры', 'Download and make captions'].includes(e.textContent.trim())); if (b) b.click();");
          return (await c.count('.caption-row')) >= 1;
        }, 600_000);
        const seconds = (Date.now() - t) / 1000;
        await c.idle(60_000);
        const lines = await c.js("return [...document.querySelectorAll('.caption-row input')].map((i) => i.value)");
        return { seconds, lines: lines.length, werPercent: wer(TEXTS.ru, lines.join(' ')), punctuation: /[.,!?…]/.test(lines.join(' ')), text: lines.join(' ').slice(0, 200) };
      },
      judge: (m) => [atLeast('строк субтитров', m.lines, 1), atMost('слов неверно (WER)', m.werPercent, 12, ' %'), holds('пунктуация есть', m.punctuation, m.punctuation, 'да'), record('от тапа до строк (со скачиванием модели, если её не было)', m.seconds, ' с')],
    },
    {
      ids: ['D-4'], price: 2,
      tools: { name: 'tools-reel', scenarios: ['reel'] },
      judge: (rows) => {
        const r = rows[0];
        return [judge('D-4', [holds('рилс собран', r?.ok && !!r.note?.done, r?.note?.done ?? r?.error ?? 'нет', 'есть'), none('тосты и ошибки', [...(r?.toasts ?? []), ...(r?.errors ?? [])])], r?.note?.done ? { look: `«${r.note.done}»: паузы убраны, субтитры, заголовок — по снимкам l5-tools` } : {})];
      },
    },
    {
      id: 'D-5 (файл)', price: 2,
      run: async (c) => {
        await c.fresh(['avsync.mp4']);
        const length = await c.timelineLength();
        const { file } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'd-5-1080p.mp4' });
        return { length, file: probe(file), sync: avSync(file) };
      },
      judge: (m) => [...wholeFile(m.file, { duration: m.length, tolerance: 0.1, minHeight: 1080 }), ...inSync(m.sync, 2)],
    },
    {
      id: 'V-169', price: 3,
      // Scrubbing, freeze frames and reverses make canvases the page leaves to the collector: Safari refuses a canvas past
      // its canvas memory. The page counts every refusal (2D and WebGL) and every context lost against its will.
      run: async (c) => {
        await c.fresh(['phone_1080_h264.mp4']);
        for (let k = 0; k < 40; k++) { await c.seek((k * 7.3) % 29); await sleep(150); }
        // Each freeze 2 s into the last clip, which stays a video (the rest of the source): never on a freeze frame.
        for (let k = 0; k < 5; k++) {
          const n = await c.count('.tl-row.main .clip');
          const start = await c.js("const els = [...document.querySelectorAll('.tl-row.main .clip')]; return (els.at(-1).offsetLeft - els[0].offsetLeft) / 60;");
          await c.selectClip(n - 1);
          await c.exactAt(Math.round((start + 2) * 30) / 30);
          await c.tool('Freeze');
          await c.waitFor('the freeze frame', async () => (await c.count('.tl-row.main .clip-image')) === k + 1, 20_000);
        }
        await c.closeTools();
        for (let k = 0; k < 2; k++) {
          await c.selectClip(0);
          await c.tool('Reverse');
          await c.waitFor('the reverse to start', () => c.js("return !!document.querySelector('.busy')"), 10_000).catch(() => undefined);
          await c.idle(180_000);
          await c.selectClip(0);
          await c.tool('Reverse'); // forward again
          await sleep(1500);
        }
        await c.closeTools();
        for (let k = 0; k < 20; k++) { await c.seek((k * 11.1) % 50); await sleep(150); }
        const p = await c.page();
        return { gl: p.gl, images: await c.count('.tl-row.main .clip-image') };
      },
      judge: (m) => [...glChecks(m.gl), equals('отказов в 2D-холсте', m.gl.nulls2d, 0), equals('стоп-кадров на таймлайне', m.images, 5)],
    },
  ],
  manual: [
    { id: 'D-1 (свой Safari)', steps: 'Свой Safari владельца (не скрипт): открыть сайт, футер главной; если старая — полностью закрыть Kadr и открыть снова.', limit: `в футере ${EXPECT}; обновление само на главном экране, не посреди работы` },
    { id: 'D-2', steps: 'Новый проект 9:16 → «Медиа» → видео из «Фото», где вы говорите.', limit: 'клип на таймлайне, превью играет со звуком' },
    { id: 'D-3, D-4 (своё видео)', steps: 'На том же видео: «Субтитры» одним тапом, затем «Рилс в 1 тап».', limit: 'субтитры верны, с пунктуацией, время записать; рилс собран: паузы убраны, субтитры, заголовок' },
    { id: 'D-5 («Фото»)', steps: '«Экспорт» 1080p → «Сохранить» → в «Фото»; посмотреть ролик.', limit: 'файл в «Фото», звук синхронен, длительность как в Kadr' },
    { id: 'D-6 (свой Safari)', steps: 'Закрыть вкладку Kadr (смахнуть), открыть снова.', limit: 'проект на месте, тот же' },
    { id: 'D-7 · C-C5', steps: 'Не закрывая Kadr, дождаться следующей выкладки, открыть проект, «Рилс в 1 тап»; затем выйти на главную.', limit: 'рилс без ошибок; на главной страница сама переходит на новую версию, проект на месте' },
    { id: 'V-138', steps: 'Экспорт → одно касание пальцем «Сохранить / Поделиться». 5 раз.', limit: 'лист «Поделиться» открывается с первого касания, 5 из 5' },
    { id: 'V-148', steps: '«Фото» → видео → «Поделиться»: есть ли Kadr в списке.', limit: 'записать (ждём «нет» — кандидат §8); сайт говорит, как добавить видео иначе' },
    { id: 'V-233', steps: 'Готовый экспорт → опубликовать черновик в TikTok и в Instagram; считать касания от «Готово» до черновика.', limit: 'записать число касаний и есть ли TikTok/Instagram в листе «Поделиться»' },
    { id: 'V-223', steps: 'Проект не открывать 8 дней (календарь; G5), затем открыть Kadr.', limit: 'проект на месте' },
    { id: 'V-105', steps: 'Нужен iPhone на iOS 26.0–26.3: на стенде нет — пропуск с пометкой.', limit: '—' },
    { id: 'V-169 (консоль)', steps: 'Web Inspector по кабелю во время V-169.', limit: 'нет «Total canvas memory use exceeds the maximum limit»' },
  ],
});
