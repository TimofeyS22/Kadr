// L5 of lane D of the sweep (docs/21; reports/L5 — очередь.md, section D, with SW-A-13 and SW-A-14 of the qa-sound branch):
// text, sound, export, platform on a real iPhone — the slideshow template to a whole file, sound against picture after
// Even loudness, Echo and 0.5×, the loudness of a 1080p export, WebGL contexts after renames and reopenings.
//   L5_UDID=… L5_OUT=… node scripts/l5-sweep-d.mjs [site URL]      (runner and env: scripts/l5-sweep.mjs)
import { execFileSync } from 'node:child_process';
import { avSync, loudness, luma, make, packets, probe, volume } from './l5-session.mjs';
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, glChecks, inSync, near, none, record, wholeFile } from './l5-verdict.mjs';

const audioSeconds = (file) => Number(execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim());
/** The sound's codec, bitrate (kbit/s) and sample rate, as ffprobe reads the file (Q-31: AAC 160k/128k from 39e0c77). */
const audioStream = (file) => { const [codec, rate, bits] = execFileSync('ffprobe', ['-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name,sample_rate,bit_rate', '-of', 'csv=p=0', file], { encoding: 'utf8' }).trim().split(','); return { codec, sampleRate: Number(rate), kbps: Math.round(Number(bits) / 1000) }; };
/** The sound sheets show «Processing the sound on this device…» for a while after a change: Done waits for it. */
async function soundSettled(c) {
  await c.waitFor('the sound processed', () => c.js("return !document.querySelector('.inline-progress')"), 180_000);
}

await sweep({
  lane: 'd',
  title: 'участок D (текст, звук, экспорт, платформа)',
  items: [
    {
      id: 'C-H1', price: 2,
      // Photos and a track from «Files» are pushed into the template's own picker (one selection, as on the phone).
      run: async (c) => {
        await c.home();
        const shots = [make(c.out, 'slide-1.jpg', ['-f', 'lavfi', '-i', 'testsrc2=s=1600x1200', '-frames:v', '1']), make(c.out, 'slide-2.jpg', ['-f', 'lavfi', '-i', 'smptehdbars=s=1600x1200', '-frames:v', '1']), 'photo.png'];
        for (const f of [...shots, 'music.m4a']) await c.push(f);
        await c.waitFor('the Slideshow template', () => c.js("const b = [...document.querySelectorAll('button.template-card')].find((e) => e.textContent.includes('Slideshow')); if (!b) return false; b.scrollIntoView({ block: 'center' }); b.click(); return true;"), 20_000);
        await c.waitFor('the slideshow built', () => c.js("return document.querySelectorAll('.tl-row.main .clip').length >= 3 && document.querySelectorAll('.tl-row.audio .clip').length >= 1"), 120_000);
        await c.watch();
        await c.projectId();
        await c.closeTools();
        const length = await c.timelineLength();
        const { file, ms } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'c-h1-slideshow.mp4' });
        return { length, ms, file: probe(file), sound: volume(file) };
      },
      judge: (m) => [...wholeFile(m.file, { duration: m.length, tolerance: 0.1, minHeight: 1080 }), atLeast('громкость музыки (пик)', m.sound.max, -30, ' дБ')],
    },
    {
      id: 'SW-A-14', price: 2,
      run: async (c) => {
        await c.fresh(['avsync_long.mp4']);
        const files = {};
        files.plain = (await c.exportAs({ preset: 'Small file', loud: false, file: 'sw-a-14-plain.mp4' })).file;
        files.even = (await c.exportAs({ preset: 'Small file', loud: true, file: 'sw-a-14-even.mp4' })).file;
        await c.selectClip();
        await c.tool('Voice');
        await c.tap('Echo');
        await c.waitFor('Echo on', () => c.checked('Echo'), 120_000);
        await soundSettled(c);
        await c.tap('Done');
        await c.closeTools();
        files.echo = (await c.exportAs({ preset: 'Small file', loud: false, file: 'sw-a-14-echo.mp4' })).file;
        return Object.fromEntries(Object.entries(files).map(([k, f]) => [k, { sync: avSync(f), packets: packets(f) }]));
      },
      judge: (m) => Object.entries(m).flatMap(([k, r]) => [...inSync(r.sync, 8).map((x) => ({ ...x, name: `${k}: ${x.name}` })), none(`${k}: пакеты звука не по 1024`, r.packets.broken)]),
    },
    {
      id: 'SW-A-13', price: 2,
      run: async (c) => {
        await c.fresh(['avsync_long.mp4']);
        await c.selectClip();
        await c.tool('Speed');
        await c.tap('0.5×');
        await new Promise((r) => setTimeout(r, 1500)); // the processing starts ~800 ms after the change
        await soundSettled(c);
        await c.tap('Done');
        await c.closeTools();
        const { file } = await c.exportAs({ preset: 'Small file', loud: false, file: 'sw-a-13-half.mp4' });
        return { sync: avSync(file), file: probe(file) };
      },
      judge: (m) => [...inSync(m.sync, 8), near('длина файла 0,5×', m.file.duration, 60, 0.15, ' с')],
    },
    {
      id: 'Q-31', price: 2,
      // 87 s of live speech under music (eval_ru_live_music.mp4) stands for «60 s with speech and music».
      run: async (c) => {
        await c.fresh(['eval_ru_live_music.mp4']);
        const length = await c.timelineLength();
        const { file } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', loud: true, file: 'q-31-even.mp4' });
        return { length, loud: loudness(file), audioS: audioSeconds(file), sound: audioStream(file), file: probe(file) };
      },
      judge: (m) => [near('громкость', m.loud.lufs, -14, 1, ' LUFS'), atMost('пик (сэмпл)', m.loud.samplePeak, -0.9, ' dBFS'), atMost('истинный пик', m.loud.truePeak, -1, ' dBTP'),
        record('звук', `${m.sound.codec} ${m.sound.kbps} кбит/с, ${m.sound.sampleRate} Гц`),
        near('звук до конца: длина звука', m.audioS, m.file.duration, 0.1, ' с'), ...wholeFile(m.file, { duration: m.length, tolerance: 0.1 })],
    },
    {
      id: 'SW-D-3', price: 3,
      // The counters of WebGL contexts are set at home before the project opens, and stay: the app moves by its address.
      run: async (c) => {
        await c.fresh(['landscape.mp4']);
        await c.leave();
        for (let i = 1; i <= 10; i++) {
          await c.waitFor('Rename', () => c.js("const b = [...document.querySelectorAll('button')].find((x) => /^Rename /.test(x.getAttribute('aria-label') || '')); if (!b) return false; b.click(); return true;"), 15_000);
          await c.waitFor('the name field', () => c.js(`const i = document.querySelector('.ck-home-form input'); if (!i) return false;
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'L5 rename ' + arguments[0]); i.dispatchEvent(new Event('input', { bubbles: true })); return true;`, i), 10_000);
          await c.tap('Save');
          await c.waitFor('the new name', () => c.js("return [...document.querySelectorAll('.project-open')].some((b) => (b.getAttribute('aria-label') || '').endsWith('L5 rename ' + arguments[0]))", i), 10_000);
        }
        for (let i = 0; i < 5; i++) {
          await c.openFirst();
          await new Promise((r) => setTimeout(r, 1200));
          await c.leave();
        }
        await c.openFirst();
        await new Promise((r) => setTimeout(r, 1500));
        const before = await c.page();
        await c.tap('Play');
        await new Promise((r) => setTimeout(r, 2000));
        const after = await c.page();
        await c.tap('Pause').catch(() => undefined);
        return { gl: after.gl, drawn: after.drawn - before.drawn, luma: luma(await c.previewShot('sw-d-3-preview')) };
      },
      judge: (m) => [...glChecks(m.gl), atLeast('кадров превью за 2 с воспроизведения', m.drawn, 20), atLeast('яркость превью', m.luma, 10)],
    },
  ],
  manual: [
    { id: 'C-H1 (часть «Фото»)', steps: 'Главная → «Слайд-шоу»: 3 фото и трек из «Фото»/«Файлов» → экспорт 1080p → «Сохранить» → в «Фото»; файл по AirDrop на Mac, ffprobe.', limit: 'файл в «Фото», длина = таймлайн ± 0,1 с, музыка слышна, ни одного тоста ошибки' },
    { id: 'Q-24 / Q-22', steps: '«Звуки» → Whoosh, запись голоса 3 с, «Улучшить голос», эффект «Deep»; экспорт; запись экрана iPhone со звуком во время превью; ffmpeg на Mac: превью против файла.', limit: 'сдвиг ≤ 1 кадра, уровень ± 1 дБ' },
    { id: 'Q-20', steps: 'Стикер щипком двумя пальцами: увеличить, уменьшить до предела, повернуть; «Отменить».', limit: 'щипок не листает страницу, размер в пределах, отмена одним шагом' },
  ],
});
