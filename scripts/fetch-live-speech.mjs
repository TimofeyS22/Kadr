// Live speech for the caption eval (v1.3.1): TTS is easier than people, so the eval also runs on real Russian
// speech recorded on phones — SOVA RuDevices (bond005/sova_rudevices, CC BY 4.0), test split. Picks utterances of
// 6–25 words without numbers (references spell them out, recognizers write digits) and without profanity, joins
// them with short pauses into fixtures/eval_ru_live.mp4 (+ _music under the same bed as eval_ru_music), and stores
// the reference as "ru_live" in e2e/eval/texts.json. Run once: node scripts/fetch-live-speech.mjs (needs ffmpeg).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.join(import.meta.dirname, '..');
const fx = path.join(root, 'fixtures');
const tmp = path.join(fx, 'live_tmp');
const WANT = 18;
const NUM = /(^| )(ноль|один|одна|два|две|три|четыр|пять|шест|семь|восем|девят|десят|сорок|сто|двест|трист|тысяч|миллион|перв|втор|трет)/;
const RUDE = /(ху[йеия]|пизд|бля|еба|ёба|еб[ау]|сук[аи]|муда|залуп|хер)/;

async function rows(offset) {
  const url = `https://datasets-server.huggingface.co/rows?dataset=bond005/sova_rudevices&config=default&split=test&offset=${offset}&length=100`;
  for (let i = 0; i < 4; i++) {
    const r = await fetch(url);
    if (r.ok) return (await r.json()).rows.map((x) => x.row);
    await new Promise((res) => setTimeout(res, 2000));
  }
  throw new Error(`rows ${offset}: HTTP error`);
}

fs.mkdirSync(tmp, { recursive: true });
const picked = [];
for (let offset = 0; picked.length < WANT && offset < 2000; offset += 100) {
  for (const row of await rows(offset)) {
    const text = row.transcription.trim();
    const n = text.split(/\s+/).length;
    if (n < 6 || n > 25 || NUM.test(text) || RUDE.test(text)) continue;
    const file = path.join(tmp, `${picked.length}.wav`);
    const r = await fetch(row.audio[0].src);
    if (!r.ok) continue;
    fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
    picked.push({ file, text });
    if (picked.length === WANT) break;
  }
}
// Each utterance resampled to 48 kHz mono, followed by 0.6 s of silence.
const list = picked.flatMap((p, i) => {
  const out = path.join(tmp, `n${i}.wav`);
  execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-i', p.file, '-af', 'aresample=48000,apad=pad_dur=0.6', '-ac', '1', out]);
  return [`file '${out}'`];
});
fs.writeFileSync(path.join(tmp, 'list.txt'), list.join('\n'));
const speech = path.join(tmp, 'speech.wav');
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(tmp, 'list.txt'), speech]);
const d = execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', speech]).toString().trim();
const bed = path.join(root, 'public/music/tracks', fs.readdirSync(path.join(root, 'public/music/tracks')).filter((f) => f.endsWith('.m4a')).sort()[0]);
const video = ['-f', 'lavfi', '-i', `color=c=0x223344:s=720x1280:r=30:d=${d}`];
const enc = ['-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-ar', '48000', '-shortest'];
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...video, '-i', speech, ...enc, path.join(fx, 'eval_ru_live.mp4')]);
execFileSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', ...video, '-i', speech, '-stream_loop', '-1', '-i', bed,
  '-filter_complex', '[1:a]aresample=48000[s];[2:a]aresample=48000,volume=0.35[m];[s][m]amix=inputs=2:duration=first:normalize=0[a]',
  '-map', '0:v', '-map', '[a]', ...enc, path.join(fx, 'eval_ru_live_music.mp4')]);
fs.rmSync(tmp, { recursive: true, force: true });

const textsFile = path.join(root, 'e2e/eval/texts.json');
const texts = JSON.parse(fs.readFileSync(textsFile, 'utf8'));
texts.ru_live = picked.map((p) => p.text).join(' ');
fs.writeFileSync(textsFile, `${JSON.stringify(texts, null, 2)}\n`);
console.log(`live speech: ${picked.length} utterances, ${Number(d).toFixed(1)} s, ${texts.ru_live.split(' ').length} words`);
