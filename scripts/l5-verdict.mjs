// Pure logic of the L5 sweeps (docs/21 §9, reports/L5 — очередь.md): each row's thresholds, written before the run, judged
// on what the phone measured, and the file analyses that turn ffmpeg's words into numbers. No driver, no files, no
// clock: scripts/l5-verdict.test.ts holds every rule to the queue's words.

export const PASS = 'PASS';
export const FAIL = 'FAIL';
/** The scenario broke before it measured (a button not found, the session lost): no verdict on the product. */
export const ERROR = 'ERROR';
/** The script gathered the evidence, a person compares it (pictures against a reference, a sound by ear). */
export const LOOK = 'LOOK';

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** A value as the reports write it: a decimal comma, at most two decimals, «—» for nothing. */
export function fmt(v) {
  if (num(v)) return String(Math.round(v * 100) / 100).replace('.', ',');
  if (v === null || v === undefined || (typeof v === 'number' && !Number.isFinite(v))) return '—';
  if (typeof v === 'boolean') return v ? 'да' : 'нет';
  if (Array.isArray(v)) return v.map(fmt).join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// ---------- one threshold ----------
/** `value ≤ limit`; a missing value fails (nothing measured is not a pass). */
export const atMost = (name, value, limit, unit = '') => ({ name, value, unit, limit: `≤ ${fmt(limit)}${unit}`, ok: num(value) && value <= limit });
export const atLeast = (name, value, limit, unit = '') => ({ name, value, unit, limit: `≥ ${fmt(limit)}${unit}`, ok: num(value) && value >= limit });
export const below = (name, value, limit, unit = '') => ({ name, value, unit, limit: `< ${fmt(limit)}${unit}`, ok: num(value) && value < limit });
/** `|value − target| ≤ tolerance`. */
export const near = (name, value, target, tolerance, unit = '') => ({ name, value, unit, limit: `${fmt(target)} ± ${fmt(tolerance)}${unit}`, ok: num(value) && Math.abs(value - target) <= tolerance + 1e-9 });
export const equals = (name, value, want, unit = '') => ({ name, value, unit, limit: `= ${fmt(want)}${unit}`, ok: value === want });
/** A yes-or-no condition with its own words for the limit. */
export const holds = (name, ok, value, limit) => ({ name, value, unit: '', limit, ok: !!ok });
/** A value the queue asks to write down, with no threshold («записать»): it never fails a row. */
export const record = (name, value, unit = '') => ({ name, value, unit, limit: 'записать', ok: true });
/** A list that must be empty (error toasts, page errors, engine words); the first items go into the report. */
export const none = (name, list) => ({ name, value: list.length, unit: '', limit: '= 0', ok: list.length === 0, detail: list.slice(0, 3) });

// ---------- one row ----------
/**
 * A row of the queue judged: FAIL when a threshold does not hold, LOOK when they all hold and a person still compares
 * what the script gathered, PASS when they hold and nothing is left to look at, ERROR when nothing was measured.
 */
export function judge(id, checks, extra = {}) {
  const list = checks.filter(Boolean);
  const status = extra.error || list.length === 0 ? ERROR : !list.every((c) => c.ok) ? FAIL : extra.look ? LOOK : PASS;
  return { id, status, checks: list, ...extra };
}

const said = (c) => `${c.ok ? '' : '✗ '}${c.name} ${fmt(c.value)}${c.unit ?? ''} (порог ${c.limit})${c.ok || !c.detail?.length ? '' : `: ${c.detail.map((d) => fmt(d).slice(0, 120)).join(' | ')}`}`;

/** The console line of a judged row: status, ID, then each measured value against its threshold. */
export function line(r) {
  const body = r.error ? `сценарий не дошёл до замера: ${r.error}` : r.checks.map(said).join('; ');
  return `${r.status.padEnd(5)} ${r.id} — ${body}${r.look ? ` · смотреть: ${r.look}` : ''}`;
}

const cell = (s) => String(s).replaceAll('|', '/').replaceAll('\n', ' ');
/** The row for the journal (`reports/L5 — журнал.md`): ID, outcome, measured values, thresholds. */
export function mdRow(r) {
  const outcome = { PASS: 'прошла', FAIL: '**не прошла**', ERROR: 'сбой сценария', LOOK: 'собрано, смотрит человек' }[r.status];
  const measured = r.error ? r.error : r.checks.map((c) => `${c.ok ? '' : '✗ '}${c.name} ${fmt(c.value)}${c.unit ?? ''}`).join('; ');
  const limits = r.checks.map((c) => `${c.name} ${c.limit}`).join('; ');
  return `| ${cell(r.id)} | ${outcome} | ${cell(measured + (r.look ? ` · ${r.look}` : ''))} | ${cell(limits)} |`;
}

/** Totals of a sweep: how many rows of each outcome. */
export function totals(rows) {
  const t = { PASS: 0, FAIL: 0, ERROR: 0, LOOK: 0 };
  for (const r of rows) t[r.status]++;
  return t;
}

// ---------- statistics ----------
/** Nearest-rank percentile (q in 0..1) of a non-empty list; NaN for an empty one. */
export function percentile(xs, q) {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(q * s.length) - 1))];
}
export const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
/** How many of the runs a condition held in («3 из 3»). */
export function kOfN(name, runs, okOf, need = runs.length) {
  const k = runs.filter(okOf).length;
  return { name, value: `${k} из ${runs.length}`, unit: '', limit: `${need} из ${need}`, ok: runs.length >= need && k >= need };
}

// ---------- rows of l5-tools (its stdout, one JSON line a scenario) ----------
/** The JSON lines `scripts/l5-tools.mjs` prints, one a scenario: `{ name, ok, note, error, toasts, errors, crashed, s }`. */
export function toolsRows(stdout) {
  const rows = [];
  for (const text of stdout.split('\n')) {
    if (!text.startsWith('{"name":')) continue;
    try { rows.push(JSON.parse(text)); } catch { /* a line cut by a killed process */ }
  }
  return rows;
}
/** A run lost to the link with the phone (the cable, a session the phone dropped), not to Kadr: it is not counted. */
export const lostToLink = (row) => /fetch failed|ECONNREFUSED|ECONNRESET|socket hang up|invalid session id|operation was aborted|no session/i.test(row.error ?? '');
const shownOnScreen = (row) => (row.toasts?.length ?? 0) > 0 || (row.note?.takes ?? []).some((t) => (t.said ?? []).length > 0);

/**
 * S-1-13, S-1-13-1 and S-1-12 on the same runs of `s1-camera` (five takes, 1.5 s apart). Thresholds of the queue: error
 * messages on screen in 0 of the runs; empty film strips in 0; new leases (`leases.renewed`) 0 in at least 58 of 60; no
 * take that failed to land. Runs lost to the link are not counted, and at most 2 of the planned may be lost.
 */
export function cameraRuns(rows, planned) {
  const counted = rows.filter((r) => !lostToLink(r));
  const n = counted.length;
  const empty = counted.filter((r) => r.note?.strips && r.note.strips.thumbs < r.note.strips.clips);
  const quiet = counted.filter((r) => r.note?.leases && r.note.leases.renewed === 0);
  const unlanded = counted.filter((r) => /takes that did not land|no clip in 40 s/.test(r.error ?? ''));
  const takes = counted.reduce((sum, r) => sum + (r.note?.takes?.length ?? 0), 0) + unlanded.length * 5;
  const s113 = judge('S-1-13, S-1-13-1 (М3)', [
    atLeast('засчитано прогонов', n, planned - 2),
    none('прогонов с ошибкой на экране', counted.filter(shownOnScreen).map((r) => (r.toasts ?? []).join(' / ') || 'тост в дубле')),
    none('прогонов с пустой полосой кадров', empty.map((r) => r.note.strips)),
    atLeast('прогонов без новых аренд', quiet.length, n - Math.floor((n * 2) / 60)),
    none('прогонов, где вкладка умерла', counted.filter((r) => r.crashed).map((r) => r.crashed)),
  ]);
  const s112 = judge('S-1-12', [
    atLeast('дублей снято', takes, 100),
    none('прогонов с дублем, который не лёг', unlanded.map((r) => r.error)),
  ], { note: 'фонового экспорта в сценарии нет: дубли подряд с паузой 1,5 с' });
  return [s113, s112];
}

// ---------- ffprobe and ffmpeg, as text ----------
/** ffprobe's JSON (`-show_entries stream=…:format=duration -count_frames`) as the facts a row checks. */
export function probeSummary(p) {
  const v = p.streams.find((s) => s.codec_type === 'video'), a = p.streams.find((s) => s.codec_type === 'audio');
  const duration = Number(p.format?.duration), frames = Number(v?.nb_read_frames ?? v?.nb_frames);
  return { codec: v?.codec_name ?? null, profile: v?.profile ?? null, width: v?.width ?? null, height: v?.height ?? null, frames: Number.isFinite(frames) ? frames : null,
    duration, fps: Number.isFinite(frames) && duration > 0 ? Math.round((frames / duration) * 10) / 10 : null, audio: a?.codec_name ?? null };
}
/**
 * ebur128's summary (`-af ebur128=peak=sample+true -f null -`): integrated loudness (LUFS), sample peak and true peak
 * (dBFS). The e2e of Q-31 holds the sample peak to −0.9 dBFS (e2e/qa-platform-kit.ts `loudnessOf`); the true peak is
 * written beside it.
 */
export function parseEbur128(stderr) {
  const tail = stderr.slice(stderr.lastIndexOf('Summary:'));
  const n = (re) => { const m = re.exec(tail); return m ? (m[1] === '-inf' ? -Infinity : Number(m[1])) : NaN; };
  return { lufs: n(/I:\s+(-?[\d.]+|-inf) LUFS/), samplePeak: n(/Sample peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/), truePeak: n(/True peak:\s+Peak:\s+(-?[\d.]+|-inf) dBFS/) };
}
/** volumedetect's mean and max (dB). */
export function parseVolume(stderr) {
  const m = stderr.match(/mean_volume: (-?[\d.]+|-inf) dB/), x = stderr.match(/max_volume: (-?[\d.]+|-inf) dB/);
  const n = (r) => (r ? (r[1] === '-inf' ? -Infinity : Number(r[1])) : NaN);
  return { mean: n(m), max: n(x) };
}
/** signalstats' YAVG of each frame (`-vf signalstats,metadata=print:key=lavfi.signalstats.YAVG`). */
export const parseLuma = (stderr) => [...stderr.matchAll(/YAVG=([\d.]+)/g)].map((m) => Number(m[1]));
/** blackdetect's spans as [start, end] seconds. */
export const parseBlack = (stderr) => [...stderr.matchAll(/black_start:([\d.]+) black_end:([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);

/** A file exported by the phone: whole, of its length, with its streams (the queue's «ffprobe целый»). */
export function wholeFile(p, { duration, tolerance = 0.1, audio = true, minHeight } = {}) {
  return [
    holds('видео в файле', !!p.codec, p.codec, 'есть'),
    p.frames !== null && p.fps ? atMost('потеряно кадров', Math.abs(p.frames - p.duration * Math.round(p.fps)), 3) : holds('кадры прочитаны', false, p.frames, 'есть'),
    duration !== undefined ? near('длительность', p.duration, duration, tolerance, ' с') : null,
    audio ? holds('звук в файле', !!p.audio, p.audio, 'есть') : null,
    minHeight ? atLeast('меньшая сторона', Math.min(p.width ?? 0, p.height ?? 0), minHeight, ' px') : null,
  ].filter(Boolean);
}

// ---------- sound against picture (e2e/qa-media-reverse-sync.spec.ts, qa-export-frames.spec.ts) ----------
/** One video frame at 30 fps, ms: the bound for sound against picture (docs/16 §0). */
export const FRAME_MS = 1000 / 30;
/**
 * Sound minus picture, ms, at each white frame: `luma` is ffmpeg's signalstats output (pts_time and YAVG lines), `quiet`
 * its silencedetect output. A white frame is a frame over 128 after one at or under it; its beep is the first end of
 * silence from 200 ms before it on; none within 1 s counts as infinitely far.
 */
export function avOffsets(luma, quiet) {
  const frames = [...luma.matchAll(/pts_time:([\d.]+)[^\n]*\n[^\n]*YAVG=([\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
  const flashes = frames.filter(([, y], i) => y > 128 && (i === 0 || frames[i - 1][1] <= 128)).map(([t]) => t);
  const beeps = [...quiet.matchAll(/silence_end: ([\d.]+)/g)].map((m) => Number(m[1]));
  const offsets = flashes.map((f) => { const b = beeps.find((t) => t > f - 0.2); return b === undefined || b > f + 1 ? Infinity : Math.round((b - f) * 1000); });
  return { flashes, offsets };
}
/** The pairs of white frame and beep: as many as the fixture has, each within a frame (±33 ms). */
export function inSync({ flashes, offsets }, pairs, limit = FRAME_MS) {
  const worst = offsets.length ? Math.max(...offsets.map(Math.abs)) : NaN;
  return [equals('пар «белый кадр + писк»', flashes.length, pairs), atMost('худший сдвиг звука', worst, Math.round(limit), ' мс')];
}
/** Audio packets but the last that are not one whole AAC frame (1024 samples): `csv` is ffprobe's `packet=pts,duration`. */
export function brokenPackets(csv, rate) {
  const rows = csv.trim().split('\n').filter(Boolean).map((l) => l.split(',').map(Number));
  return rows.slice(0, -1).filter(([, d]) => d !== 1024).map(([pts, d]) => `${(pts / rate).toFixed(3)} s: ${d}`);
}

// ---------- V-153: the 2 s mixing windows of the export meet without a dip or a click (e2e/editor.spec.ts) ----------
/**
 * Mono 48 kHz samples of tone1k's export: at each join (2, 4, 6, 8, 10 s) the 10 ms level within ±1 dB of the median
 * level (1–11 s), and the largest sample-to-sample step under 1.3× the calm one (1–1.5 s).
 */
export function joins(x, rate = 48000, at = [2, 4, 6, 8, 10]) {
  const W = Math.round(rate / 100);
  const rms = (a, b) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / Math.max(1, b - a)); };
  const levels = [];
  for (let i = rate; i + W < 11 * rate && i + W <= x.length; i += W) levels.push(rms(i, i + W));
  const median = [...levels].sort((a, b) => a - b)[levels.length >> 1];
  const db = (v) => 20 * Math.log10(v / median);
  const step = (a, b) => { let m = 0; for (let i = Math.max(1, a + 1); i < Math.min(b, x.length); i++) m = Math.max(m, Math.abs(x[i] - x[i - 1])); return m; };
  const calm = step(rate, 1.5 * rate);
  return at.map((sec) => {
    const c = sec * rate;
    let lo = Infinity, hi = -Infinity;
    for (let i = c - 3 * W; i < c + 3 * W; i += W / 4) { const d = db(rms(i, i + W)); lo = Math.min(lo, d); hi = Math.max(hi, d); }
    return { at: sec, lo, hi, jump: step(c - 2 * W, c + 2 * W) / calm };
  });
}
export function joinChecks(rows) {
  if (!rows.length) return [holds('стыки измерены', false, 0, 'есть')];
  return [
    atMost('провал уровня у стыка', -Math.min(...rows.map((r) => r.lo)), 1, ' дБ'),
    atMost('подъём уровня у стыка', Math.max(...rows.map((r) => r.hi)), 1, ' дБ'),
    below('скачок сэмпла у стыка', Math.max(...rows.map((r) => r.jump)), 1.3, '×'),
  ];
}

// ---------- WYSIWYG: preview, photo and video frame (e2e/qa-video-kit.ts) ----------
/** Mean |difference| of two RGB pictures of the same size, 0–255. */
export const meanAbsDiff = (a, b) => { let s = 0; for (let i = 0; i < a.length; i++) s += Math.abs(a[i] - b[i]); return s / a.length; };
/** The largest mean signed R, G or B difference of two RGB pictures. */
export function colourCast(a, b) {
  const sum = [0, 0, 0];
  for (let i = 0; i < a.length; i++) sum[i % 3] += a[i] - b[i];
  return Math.max(...sum.map((v) => Math.abs(v) / (a.length / 3)));
}
/** The largest mean signed channel difference of any 15×15 block of two RGB pictures `w`×`h` (135×240 in the e2e). */
export function worstBlockCast(a, b, w = 135, h = 240) {
  let worst = 0;
  for (let by = 0; by + 15 <= h; by += 15) for (let bx = 0; bx + 15 <= w; bx += 15) {
    const sum = [0, 0, 0];
    for (let y = by; y < by + 15; y++) for (let x = bx; x < bx + 15; x++) for (let c = 0; c < 3; c++) { const i = (y * w + x) * 3 + c; sum[c] += a[i] - b[i]; }
    worst = Math.max(worst, ...sum.map((v) => Math.abs(v) / 225));
  }
  return worst;
}
/** Q-11: the preview against the photo (mean ≤ 4) and the video frame (≤ 6), worst block ≤ 20, colour cast ≤ `cast`. */
export function sameFrame(name, preview, photo, frame, cast = 0.8) {
  return [
    atMost(`${name}: превью−фото, средняя разница`, meanAbsDiff(preview, photo), 4),
    atMost(`${name}: превью−кадр видео, средняя разница`, meanAbsDiff(preview, frame), 6),
    atMost(`${name}: худший блок 15×15`, Math.max(worstBlockCast(preview, photo), worstBlockCast(preview, frame)), 20),
    atMost(`${name}: цветовой сдвиг`, Math.max(colourCast(preview, photo), colourCast(preview, frame)), cast),
  ];
}

// ---------- the phone's own counters ----------
/** V-171: open VideoDecoders of the page at rest and at most during an export (the e2e's bounds: 2 and 3). */
export const decoderChecks = (idle, exporting) => [atMost('декодеров открыто в покое', idle, 2), atMost('декодеров открыто в экспорте', exporting, 3)];
/** WebGL contexts: none lost against the page's will (too many at once), none refused. */
export const glChecks = (gl) => [equals('контекстов WebGL потеряно не по воле страницы', gl.lost, 0), equals('отказов в контексте', gl.nulls, 0)];

// ---------- captions ----------
const wordsOf = (s) => s.toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
/** Share of the reference's words the captions got wrong, % (word-level Levenshtein, as captions-eval and l5-tools count). */
export function wer(reference, captions) {
  const ref = wordsOf(reference), hyp = wordsOf(captions);
  let row = hyp.map((_, j) => j + 1);
  row.unshift(0);
  for (let i = 1; i <= ref.length; i++) {
    const next = [i];
    for (let j = 1; j <= hyp.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (ref[i - 1] === hyp[j - 1] ? 0 : 1));
    row = next;
  }
  return Math.round((row[hyp.length] / ref.length) * 1000) / 10;
}
