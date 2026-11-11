// A backup is a file from outside: its project.json may be damaged or made up (docs/11 §3.6, §3.15). A clip that
// does not have the fields every part of the app relies on is left out, so the rest of the project opens and exports
// instead of failing later with an error nobody can act on ("length cannot be 0", "atob … not correctly encoded").
import { ASPECTS } from './defaults';
import { MAX_LUT_SIZE, fromBase64 } from './lut';
import { migrateProject } from './migrate';
import { ADJUST_KEYS, CAPTION_EMPHASES, CAPTION_MOTIONS, EFFECT_IDS, TEXT_ANIM_TYPES, TEXT_LOOP_TYPES, TRANSITION_TYPES, type AspectId, type Project } from './types';

const CLIP_KINDS = ['video', 'image', 'audio', 'text', 'caption'];
const TRACK_KINDS = ['main', 'overlay', 'audio'];
const TRANSFORM_KEYS = ['x', 'y', 'scale', 'rotation', 'opacity'];
const ASSET_KINDS = ['video', 'audio', 'image'];
const FPS = [24, 25, 30, 60];

type Loose = Record<string, unknown>;
const isObj = (x: unknown): x is Loose => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isAnim = (x: unknown) => isObj(x) && isNum(x.v);
const isStyle = (x: unknown) => isObj(x) && typeof x.font === 'string' && isNum(x.size) && x.size > 0 && typeof x.color === 'string';
const isStr = (x: unknown): x is string => typeof x === 'string';
const isBool = (x: unknown): x is boolean => typeof x === 'boolean';
const among = (list: readonly string[]) => (x: unknown) => typeof x === 'string' && list.includes(x);
const EASINGS = ['linear', 'in', 'out', 'inOut', 'hold'];
const BLENDS = ['normal', 'screen', 'multiply', 'add'];
const MASK_NUMBERS = ['x', 'y', 'w', 'h', 'rotation', 'feather', 'roundness'];
const colorWidth = (x: unknown) => isObj(x) && isStr(x.color) && isNum(x.width);

/** An optional part that is not what the app reads is left out: the clip keeps the rest. */
function optional(o: Loose, key: string, ok: (x: unknown) => boolean): void {
  if (o[key] !== undefined && !ok(o[key])) delete o[key];
}

/** A list keeps the items that are whole; the same array stays when nothing was left out (a whole project is unchanged). */
function keepWhole<T>(o: Loose, key: string, ok: (x: unknown) => boolean): T[] {
  const list = o[key] as unknown[];
  const kept = list.filter(ok);
  if (kept.length !== list.length) o[key] = kept;
  return kept as T[];
}

/** An animation: its value a number, its keyframes {t, v} numbers in time order. */
function fixAnim(a: unknown): boolean {
  if (!isAnim(a)) return false;
  const x = a as Loose;
  if (x.k === undefined) return true;
  if (!Array.isArray(x.k)) { delete x.k; return true; }
  const keys = keepWhole<Loose>(x, 'k', (k) => isObj(k) && isNum(k.t) && isNum(k.v));
  for (const k of keys) optional(k, 'e', among(EASINGS));
  if (keys.some((k, i) => i > 0 && (k.t as number) < (keys[i - 1].t as number))) keys.sort((a1, b1) => (a1.t as number) - (b1.t as number));
  return true;
}

/** The text style the canvas draws with (TextStyle in types.ts). */
function fixStyle(st: Loose): void {
  if (![400, 700, 900].includes(st.weight as number)) st.weight = 700;
  if (!isBool(st.italic)) st.italic = false;
  if (!among(['left', 'center', 'right'])(st.align)) st.align = 'center';
  if (st.stroke !== null && !colorWidth(st.stroke)) st.stroke = null;
  if (st.background !== null && !(isObj(st.background) && isStr(st.background.color) && isNum(st.background.opacity))) st.background = null;
  if (isObj(st.background)) { optional(st.background, 'padding', isNum); optional(st.background, 'radius', isNum); optional(st.background, 'lines', isBool); }
  if (!isBool(st.shadow)) st.shadow = false;
  optional(st, 'uppercase', isBool);
  optional(st, 'shadowColor', isStr);
  optional(st, 'gradient', isStr);
  optional(st, 'letterSpacing', isNum);
  optional(st, 'lineHeight', (x) => isNum(x) && x > 0);
  optional(st, 'outline2', colorWidth);
  optional(st, 'copies', Array.isArray);
  if (Array.isArray(st.copies)) for (const c of keepWhole<Loose>(st, 'copies', (c) => isObj(c) && isStr(c.color) && isNum(c.x) && isNum(c.y))) optional(c, 'depth', isBool);
}

/** Hidden areas: each with a place that animates and a size; the style and the face switch known values. */
function fixPrivacy(v: unknown): boolean {
  if (!isObj(v) || !Array.isArray(v.areas)) return false;
  keepWhole(v, 'areas', (a) => isObj(a) && fixAnim(a.x) && fixAnim(a.y) && isNum(a.w) && a.w > 0 && isNum(a.h) && a.h > 0);
  if (!among(['blur', 'pixelate'])(v.style)) v.style = 'blur';
  if (!isBool(v.faces)) v.faces = false;
  return true;
}

/**
 * The parts of a clip `damaged` does not judge, made what the app reads (S-1-3): a damaged optional part goes or takes
 * its default; a clip whose own content is gone (a caption without a single whole word) is left out. False: leave it out.
 */
function repairClip(c: Loose): boolean {
  const k = c.kind;
  if (k !== 'audio') {
    if (!TRANSFORM_KEYS.every((f) => fixAnim((c.transform as Loose)[f]))) return false;
    if (!among(BLENDS)(c.blend)) c.blend = 'normal';
    optional(c, 'transitionIn', (x) => isObj(x) && among(TRANSITION_TYPES)(x.type) && isNum(x.duration) && x.duration > 0);
  }
  if (k === 'video' || k === 'image') {
    const adjust = c.adjust as Loose;
    for (const key of Object.keys(adjust)) if (!(ADJUST_KEYS as readonly string[]).includes(key)) delete adjust[key];
    if (c.filter !== null && !(isObj(c.filter) && isStr(c.filter.id) && isNum(c.filter.intensity))) c.filter = null;
    const ch = c.chroma as Loose;
    if (!isBool(ch.enabled)) ch.enabled = false;
    if (!isStr(ch.color)) ch.color = '#00ff00';
    if (!isNum(ch.similarity)) ch.similarity = 0.3;
    if (!isNum(ch.smoothness)) ch.smoothness = 0.1;
    optional(c, 'crop', (r) => isObj(r) && ['x', 'y', 'w', 'h'].every((f) => isNum(r[f])) && (r.w as number) > 0 && (r.h as number) > 0);
    optional(c, 'mask', (m) => isObj(m) && among(['circle', 'rect', 'linear'])(m.shape) && MASK_NUMBERS.every((f) => isNum(m[f])) && isBool(m.invert));
    optional(c, 'effect', (e) => isObj(e) && among(EFFECT_IDS)(e.id) && isNum(e.amount));
    optional(c, 'privacy', fixPrivacy);
    for (const f of ['removeBg', 'flipX', 'flipY']) optional(c, f, isBool);
  }
  if (k === 'video' || k === 'audio') {
    optional(c, 'curve', (cv) => Array.isArray(cv) && cv.length >= 2 && cv.every((n) => isNum(n) && n > 0));
    optional(c, 'reversedFrom', (r) => isObj(r) && isStr(r.assetId) && isNum(r.in) && r.in >= 0);
    if (!isBool(c.muted)) c.muted = false;
    for (const f of ['audioAssetId', 'audioKey', 'voice']) optional(c, f, isStr);
    for (const f of ['denoise', 'enhance', 'keepPitch', 'guide']) optional(c, f, isBool);
    optional(c, 'duck', (d) => isNum(d) && d >= 0 && d <= 1);
  }
  if (k === 'text') {
    for (const f of ['animIn', 'animOut']) {
      const a = c[f];
      if (!(isObj(a) && among(TEXT_ANIM_TYPES)(a.type) && isNum(a.duration) && a.duration >= 0)) c[f] = { type: 'none', duration: 0.3 };
    }
    optional(c, 'loop', (l) => isObj(l) && among(TEXT_LOOP_TYPES)(l.type) && isNum(l.period) && l.period > 0);
  }
  if (k === 'text' || k === 'caption') fixStyle(c.style as Loose);
  if (k === 'caption') {
    const words = keepWhole<Loose>(c, 'words', (w) => isObj(w) && isNum(w.t0) && isNum(w.t1) && w.t1 >= w.t0 && isStr(w.text));
    if (!words.length) return false;
    for (const w of words) optional(w, 'cue', Number.isInteger);
    if ((c.wordsPerPage as number) < 1) c.wordsPerPage = 4;
    if (c.highlight !== null && !isStr(c.highlight)) c.highlight = null;
    optional(c, 'emphasis', among(CAPTION_EMPHASES));
    optional(c, 'motion', among(CAPTION_MOTIONS));
    optional(c, 'preset', isStr);
    for (const f of ['reveal', 'lowerStart']) optional(c, f, isBool);
  }
  return true;
}

function damaged(c: unknown): boolean {
  if (!isObj(c) || typeof c.kind !== 'string' || !CLIP_KINDS.includes(c.kind) || typeof c.id !== 'string') return true;
  if (!isNum(c.start) || c.start < 0 || !isNum(c.duration) || c.duration <= 0) return true;
  const k = c.kind;
  if (k !== 'audio' && !(isObj(c.transform) && TRANSFORM_KEYS.every((f) => isAnim((c.transform as Loose)[f])))) return true;
  if ((k === 'video' || k === 'image') && typeof c.assetId !== 'string') return true;
  if (k === 'video' || k === 'audio') {
    if (typeof c.assetId !== 'string' || !isNum(c.in) || c.in < 0 || !isNum(c.speed) || c.speed <= 0) return true;
    if (!isNum(c.volume) || !isNum(c.fadeIn) || !isNum(c.fadeOut)) return true;
  }
  if ((k === 'video' || k === 'image') && !(isObj(c.adjust) && ADJUST_KEYS.every((a) => isNum((c.adjust as Loose)[a])) && isObj(c.chroma))) return true;
  if (k === 'text' && (typeof c.text !== 'string' || !isStyle(c.style) || !isObj(c.animIn) || !isObj(c.animOut))) return true;
  if (k === 'caption' && (!Array.isArray(c.words) || !isStyle(c.style) || !isNum(c.wordsPerPage))) return true;
  return false;
}

/** Leaves out tracks and clips a restored project cannot use; returns how many clips were left out. */
export function dropDamagedClips(p: Project): number {
  let dropped = 0;
  const tracks = (p.tracks as unknown[]).filter((t) => {
    const ok = isObj(t) && typeof t.kind === 'string' && TRACK_KINDS.includes(t.kind) && Array.isArray(t.clips);
    if (!ok && isObj(t) && Array.isArray(t.clips)) dropped += t.clips.length;
    return ok;
  }) as Project['tracks'];
  for (const t of tracks) {
    const kept = t.clips.filter((c) => !damaged(c) && repairClip(c as unknown as Loose));
    if (t.muted !== undefined && !isBool(t.muted)) delete t.muted;
    if (t.hidden !== undefined && !isBool(t.hidden)) delete t.hidden;
    dropped += t.clips.length - kept.length;
    t.clips = kept;
  }
  p.tracks = tracks;
  return dropped;
}

function goodAsset(a: unknown, id: string): boolean {
  if (!isObj(a) || a.id !== id || typeof a.kind !== 'string' || !ASSET_KINDS.includes(a.kind) || typeof a.name !== 'string' || typeof a.mime !== 'string') return false;
  if (!isNum(a.duration) || a.duration < 0 || !isNum(a.width) || a.width < 0 || !isNum(a.height) || a.height < 0) return false;
  if (a.kind !== 'image' && a.duration === 0) return false;
  return a.kind === 'audio' || (a.width > 0 && a.height > 0);
}

/** What a feature reads from a file's record: a damaged one goes (the beat grid is found again, the sound made again). */
function repairAsset(a: Loose): void {
  if (!isBool(a.hasAudio)) a.hasAudio = a.kind !== 'image';
  optional(a, 'fps', (x) => isNum(x) && x > 0);
  for (const f of ['codec', 'script']) optional(a, f, isStr);
  optional(a, 'beats', (b) => isObj(b) && isNum(b.bpm) && b.bpm > 0 && Array.isArray(b.times) && b.times.every(isNum));
  const strings = (x: unknown) => isObj(x) && Object.values(x).every(isStr);
  optional(a, 'derived', (d) => isObj(d) && Object.entries(d).every(([k, v]) => (k === 'sync' ? isNum(v) : k === 'pitch' || k === 'voice' ? strings(v) : isStr(v))));
  optional(a, 'library', (l) => isObj(l) && ['id', 'title', 'artist', 'license', 'licenseUrl', 'source'].every((f) => isStr(l[f])));
}

function goodLut(l: unknown): boolean {
  if (!isObj(l) || typeof l.name !== 'string' || typeof l.data !== 'string') return false;
  const size = l.size;
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 2 || size > MAX_LUT_SIZE) return false;
  if (l.data.length !== 4 * size ** 3) return false; // base64 of size³ RGB triples, checked before decoding
  try {
    return fromBase64(l.data).length === size ** 3 * 3;
  } catch {
    return false;
  }
}

/**
 * Makes a restored project safe to open: the canvas is one the app can make, media with impossible numbers, LUTs that
 * do not decode, fonts without a file and damaged clips are left out. Returns how many clips and LUTs were left out;
 * clips of media left out go later, when `normalizeProject` drops clips without their media.
 */
export function repairBackup(p: Project): number {
  migrateProject(p); // what an older version did not write is not damage
  const s = p.settings as unknown as Loose;
  const aspect = (typeof s.aspect === 'string' && Object.keys(ASPECTS).includes(s.aspect) ? s.aspect : '9:16') as AspectId;
  const bg = isObj(s.background) ? s.background : {};
  Object.assign(s, {
    aspect, width: ASPECTS[aspect][0], height: ASPECTS[aspect][1], fps: FPS.includes(s.fps as number) ? s.fps : 30,
    background: { mode: bg.mode === 'blur' ? 'blur' : 'color', color: typeof bg.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(bg.color) ? bg.color : '#000000' },
  });
  if (typeof p.name !== 'string') p.name = 'Kadr';
  for (const k of ['createdAt', 'updatedAt'] as const) if (!isNum(p[k])) p[k] = Date.now();
  for (const [id, a] of Object.entries(p.assets)) if (!goodAsset(a, id)) delete p.assets[id]; else repairAsset(a as unknown as Loose);
  if (p.fonts !== undefined && !isObj(p.fonts)) delete p.fonts;
  for (const [id, f] of Object.entries(p.fonts ?? {})) if (!(isObj(f) && typeof f.name === 'string' && typeof f.blobId === 'string')) delete p.fonts![id];
  let dropped = 0;
  if (p.luts !== undefined && !isObj(p.luts)) delete p.luts;
  for (const [id, l] of Object.entries(p.luts ?? {})) if (!goodLut(l)) { delete p.luts![id]; dropped++; }
  dropped += dropDamagedClips(p);
  for (const t of p.tracks) {
    for (const c of t.clips) {
      const lut = (c as { lut?: unknown }).lut;
      if (lut !== undefined && !(isObj(lut) && typeof lut.id === 'string' && p.luts?.[lut.id] && isNum(lut.intensity))) delete (c as { lut?: unknown }).lut;
    }
  }
  return dropped;
}
