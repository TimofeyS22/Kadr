// The release's main path on the real iPhone before it is published (V-234, V-249; docs/16 §4): import, preview with
// sound, split, text, a 1080p export and ffprobe on the release candidate — under 10 minutes, PASS or FAIL per row.
// The candidate is the `next` build (owner's choice, 2026-11-23): https://timofeys22.github.io/Kadr/next/, its own storage,
// its footer says «next · <sha>»; the first row holds that sha to the candidate's. No certificate on the phone.
//   L5_CANDIDATE=<sha> node scripts/l5-prerelease.mjs                     the `next` build (the release gate)
//   L5_CANDIDATE=<sha> node scripts/l5-prerelease.mjs https://<origin>/   any other HTTPS origin of the candidate
// Fallback, the build served from this Mac over HTTPS on the LAN — only with a certificate the phone already trusts:
//   L5_TLS_CERT=… L5_TLS_KEY=… node scripts/l5-prerelease.mjs --serve dist   (L5_SERVE_ONLY=1: only serve it)
// Env: L5_UDID, L5_OUT, L5_TLS_PORT (8443).
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:https';
import { networkInterfaces } from 'node:os';
import { extname, join, normalize, resolve } from 'node:path';
import { probe, volume } from './l5-session.mjs';
import { sweep } from './l5-sweep.mjs';
import { atLeast, atMost, candidateLabel, equals, holds, wholeFile } from './l5-verdict.mjs';

const NEXT = 'https://timofeys22.github.io/Kadr/next/';
const PORT = Number(process.env.L5_TLS_PORT ?? 8443);
const lanIp = () => Object.values(networkInterfaces()).flat().find((a) => a && a.family === 'IPv4' && !a.internal && /^(192\.168|10\.|172\.(1[6-9]|2\d|3[01]))/.test(a.address))?.address;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json',
  '.wasm': 'application/wasm', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg', '.txt': 'text/plain' };
/** The build over HTTPS on the LAN: files as they are, anything else is the app's page (its routes live in the hash). */
function serve(dir) {
  const root = resolve(dir);
  if (!existsSync(join(root, 'index.html'))) throw new Error(`no build in ${root} (npm run build first)`);
  const cert = process.env.L5_TLS_CERT, key = process.env.L5_TLS_KEY;
  if (!cert || !key) throw new Error('--serve needs L5_TLS_CERT and L5_TLS_KEY: a certificate the phone already trusts (without one the page has no WebCodecs)');
  // The base the build was made for (`KADR_BASE`: «/Kadr/» on Pages, «/» by default), read off its page.
  const base = /(?:src|href)="(\/[^"]*?)assets\//.exec(readFileSync(join(root, 'index.html'), 'utf8'))?.[1] ?? '/';
  const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (req, res) => {
    let asked = decodeURIComponent(new URL(req.url, 'https://x').pathname);
    if (asked.startsWith(base)) asked = '/' + asked.slice(base.length);
    const path = normalize(asked).replace(/^(\.\.[/\\])+/, '');
    let file = join(root, path);
    if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) file = join(root, 'index.html');
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-length': statSync(file).size, 'cache-control': 'no-cache' });
    createReadStream(file).pipe(res);
  });
  const ip = lanIp();
  return new Promise((ok) => server.listen(PORT, '0.0.0.0', () => ok({ server, url: `https://${ip}:${PORT}${base}` })));
}

const arg = process.argv[2];
let served = null;
if (arg === '--serve') {
  served = await serve(process.argv[3] ?? 'dist');
  console.log(`сборка ${resolve(process.argv[3] ?? 'dist')} — ${served.url}`);
  // L5_SERVE_ONLY=1: only serve (a person checks the build on the phone by hand); Ctrl-C ends it.
  if (process.env.L5_SERVE_ONLY) await new Promise(() => {});
}

await sweep({
  lane: 'pre',
  title: 'основной путь до выпуска',
  url: served?.url ?? (arg && !arg.startsWith('--') ? arg : NEXT),
  items: [
    {
      id: 'Кандидат и среда: «next · <sha>», HTTPS, WebCodecs, OPFS', price: 1, page: false,
      // First: the build on the phone is the candidate (a wrong one, or the live site's service worker answering for
      // /next/, makes the rest about another build); then what the app needs of the page.
      run: async (c) => {
        await c.home();
        return c.js("return { footer: document.querySelector('.home-foot')?.textContent.replace(/\\s+/g, ' ').trim() ?? null, secure: isSecureContext, encoder: typeof VideoEncoder === 'function', decoder: typeof VideoDecoder === 'function', opfs: !!navigator.storage?.getDirectory }");
      },
      judge: (m) => {
        const label = candidateLabel(m.footer, process.env.L5_CANDIDATE);
        return [holds('метка «next · <sha>» = кандидат', label.ok, label.seen ?? m.footer?.slice(-60) ?? 'подвала нет', process.env.L5_CANDIDATE ? `next · ${process.env.L5_CANDIDATE}` : 'L5_CANDIDATE не задан'),
          holds('защищённая страница (HTTPS)', m.secure, m.secure, 'да'), holds('WebCodecs: кодировщик и декодер', m.encoder && m.decoder, m.encoder && m.decoder, 'да'), holds('OPFS', m.opfs, m.opfs, 'да')];
      },
    },
    {
      id: 'Основной путь: импорт → превью со звуком → разрез → текст → экспорт 1080p', price: 1,
      run: async (c) => {
        const t = {};
        let t0 = Date.now();
        await c.fresh(['speech_ru.mp4']);
        t.importS = (Date.now() - t0) / 1000;
        // The sound: the audio context the preview plays through, caught as the app connects its nodes.
        await c.js("const k = AudioNode.prototype.connect; AudioNode.prototype.connect = function (...a) { window.__l5.ctx = this.context; return k.apply(this, a); };");
        await c.tap('Play');
        await sleep(2000);
        const played = await c.js("const x = window.__l5.ctx; return { drawn: window.__kadrPerf?.drawn ?? 0, audio: x ? x.state : null, audioTime: x ? x.currentTime : 0 };");
        await sleep(1000);
        const later = await c.js("const x = window.__l5.ctx; return { drawn: window.__kadrPerf?.drawn ?? 0, audioTime: x ? x.currentTime : 0 };");
        await c.tap('Pause').catch(() => undefined);
        t0 = Date.now();
        await c.selectClip();
        await c.seek(2);
        await sleep(500);
        await c.tool('Split');
        await c.waitFor('two pieces', async () => (await c.count('.tl-row.main .clip')) === 2, 15_000);
        await c.closeTools();
        await c.tool('Text');
        await c.waitFor('the text field', () => c.js(`const f = document.querySelector('textarea.ck-panel-text'); if (!f) return false;
          Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(f, 'Kadr до выпуска'); f.dispatchEvent(new Event('input', { bubbles: true })); return true;`), 15_000);
        await c.tap('Done');
        await c.closeTools();
        t.editS = (Date.now() - t0) / 1000;
        const p = await c.waitFor('the edits saved', async () => { const s = await c.stored(); const texts = s?.tracks.flatMap((x) => x.clips).filter((x) => x.kind === 'text') ?? [];
          return s && s.tracks.find((x) => x.kind === 'main').clips.length === 2 && texts.some((x) => x.text === 'Kadr до выпуска') ? s : null; }, 10_000).catch(() => null);
        const length = await c.timelineLength();
        const { file, ms } = await c.exportAs({ preset: 'TikTok, Reels, Shorts', file: 'prerelease-1080p.mp4' });
        return { ...t, played, later, saved: !!p, length, exportS: ms / 1000, file: probe(file), sound: volume(file) };
      },
      judge: (m) => [
        atMost('импорт до клипа', m.importS, 60, ' с'),
        atLeast('превью: кадров за 1 с', m.later.drawn - m.played.drawn, 20),
        equals('превью: звук играет (AudioContext)', m.played.audio, 'running'), atLeast('превью: звук идёт', Math.round((m.later.audioTime - m.played.audioTime) * 10) / 10, 0.8, ' с'),
        holds('разрез и текст сохранены', m.saved, m.saved, 'да'),
        ...wholeFile(m.file, { duration: m.length, tolerance: 0.1, minHeight: 1080 }), atLeast('звук в файле слышен (пик)', m.sound.max, -30, ' дБ'),
        atMost('экспорт', m.exportS, 60, ' с'),
      ],
    },
  ],
  manual: [],
});
served?.server.close();
