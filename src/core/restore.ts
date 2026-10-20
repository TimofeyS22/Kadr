// A backup is a file from outside: its project.json may be damaged or made up (docs/11 §3.6, §3.15). A clip that
// does not have the fields every part of the app relies on is left out, so the rest of the project opens and exports
// instead of failing later with an error nobody can act on ("length cannot be 0", "atob … not correctly encoded").
import { ASPECTS } from './defaults';
import { MAX_LUT_SIZE, fromBase64 } from './lut';
import { ADJUST_KEYS, type AspectId, type Project } from './types';

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
    const kept = t.clips.filter((c) => !damaged(c));
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
  const s = p.settings as unknown as Loose;
  const aspect = (typeof s.aspect === 'string' && Object.keys(ASPECTS).includes(s.aspect) ? s.aspect : '9:16') as AspectId;
  const bg = isObj(s.background) ? s.background : {};
  Object.assign(s, {
    aspect, width: ASPECTS[aspect][0], height: ASPECTS[aspect][1], fps: FPS.includes(s.fps as number) ? s.fps : 30,
    background: { mode: bg.mode === 'blur' ? 'blur' : 'color', color: typeof bg.color === 'string' && /^#[0-9a-f]{3,8}$/i.test(bg.color) ? bg.color : '#000000' },
  });
  if (typeof p.name !== 'string') p.name = 'Kadr';
  for (const k of ['createdAt', 'updatedAt'] as const) if (!isNum(p[k])) p[k] = Date.now();
  for (const [id, a] of Object.entries(p.assets)) if (!goodAsset(a, id)) delete p.assets[id];
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
