// Timeline operations. All functions mutate a draft Project (use inside immer `produce`)
// and keep the invariants: main track packed, free tracks sorted and non-overlapping.
import { evalAnim as evalAnimAt, mapAnimTime, splitAnim } from './anim';
import { splitWords } from './captions';
import { RESAMPLE_POINTS, curveAt, curveIntegral, subCurve, timeFractionToU, uToTimeFraction } from './speed';
import { anim, createImageClip, uid } from './defaults';
import type {
  Asset, AudioClip, Clip, MediaClip, Project, SoundClip, Track, TrackKind, Transform, Transition, VisualClip,
} from './types';

export const MIN_CLIP = 0.1;
export const MIN_TRANSITION = 0.1;
export const MAX_STILL = 3600;
const EPS = 1e-6;

export const r6 = (x: number): number => Math.round(x * 1e6) / 1e6;
export const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));
export const clipEnd = (c: Clip): number => c.start + c.duration;
export const isMedia = (c: Clip): c is MediaClip => c.kind === 'video' || c.kind === 'audio';
export const isVisual = (c: Clip): c is VisualClip => c.kind !== 'audio';
export const isSound = (c: Clip): c is SoundClip => c.kind === 'video' || c.kind === 'audio';
export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

/** Seconds of source a media clip plays. */
export const sourceSpan = (c: MediaClip): number => (c.curve ? (c.duration * c.speed) / curveIntegral(c.curve) : c.duration * c.speed);

/** Source time shown at timeline time t (speed curves included). */
export function sourceTime(c: MediaClip, t: number): number {
  if (!c.curve) return c.in + (t - c.start) * c.speed;
  return c.in + sourceSpan(c) * timeFractionToU(c.curve, (t - c.start) / c.duration);
}

/** Timeline time at which source time s plays (inverse of sourceTime). */
export function timelineTimeOf(c: MediaClip, s: number): number {
  if (!c.curve) return c.start + (s - c.in) / c.speed;
  const L = sourceSpan(c);
  const u = (s - c.in) / L;
  if (u <= 0) return c.start + (s - c.in) / (c.speed * c.curve[0]);
  if (u >= 1) return c.start + c.duration + (s - c.in - L) / (c.speed * c.curve[c.curve.length - 1]);
  return c.start + c.duration * uToTimeFraction(c.curve, u);
}

/** Playback rate at timeline time t. */
export const rateAt = (c: MediaClip, t: number): number =>
  c.curve ? c.speed * curveAt(c.curve, timeFractionToU(c.curve, (t - c.start) / c.duration)) : c.speed;

/** What the clip's processed sound must contain: d = noise-reduced, p<speed> = pitch-compensated. */
export const expectedAudioKey = (c: SoundClip): string =>
  `${c.enhance ? 'e' : c.denoise ? 'd' : ''}${c.keepPitch && c.speed !== 1 && !c.curve ? `p${c.speed}` : ''}`;

/** Asset to play for a clip's sound: the processed one if it matches the clip's settings, else the source. */
export function soundAssetId(c: SoundClip): string {
  const key = c.audioKey ?? (c.denoise ? 'd' : '');
  return c.audioAssetId && key === expectedAudioKey(c) && key !== '' ? c.audioAssetId : c.assetId;
}

export function mainTrack(p: Project): Track {
  const t = p.tracks.find((x) => x.kind === 'main');
  if (!t) throw new Error('Project has no main track');
  return t;
}

export function findClip(p: Project, id: string): { track: Track; clip: Clip; index: number } | null {
  for (const track of p.tracks) {
    const index = track.clips.findIndex((c) => c.id === id);
    if (index >= 0) return { track, clip: track.clips[index], index };
  }
  return null;
}

export function projectDuration(p: Project): number {
  let d = 0;
  for (const t of p.tracks) for (const c of t.clips) d = Math.max(d, clipEnd(c));
  return r6(d);
}

/** Longest timeline duration a clip may have given its source. */
export function maxDuration(c: Clip, asset: Asset | undefined): number {
  if (isMedia(c)) {
    if (!asset) return c.duration;
    if (!c.curve) return Math.max(MIN_CLIP, (asset.duration - c.in) / c.speed);
    const rest = asset.duration - c.in - sourceSpan(c); // source left after the current range, played at the end rate
    return Math.max(MIN_CLIP, c.duration + rest / (c.speed * c.curve[c.curve.length - 1]));
  }
  return MAX_STILL;
}

function transform(c: Clip): Transform | null {
  return isVisual(c) ? c.transform : null;
}

function mapClipAnims(c: Clip, fn: (t: number) => number): void {
  const tf = transform(c);
  if (tf) for (const a of Object.values(tf)) mapAnimTime(a, fn);
}

/** Lays main-track clips end to end; a clip's transitionIn overlaps it with the previous clip. */
export function packMain(track: Track): void {
  let t = 0;
  let prevTail = Infinity; // time of the previous clip not used by its own incoming transition
  track.clips.forEach((c, i) => {
    let overlap = 0;
    if (isVisual(c) && c.transitionIn) {
      const prev = track.clips[i - 1];
      const maxD = prev ? Math.min(prevTail, prev.duration / 2, c.duration / 2) : 0;
      if (maxD < MIN_TRANSITION) delete c.transitionIn;
      else overlap = c.transitionIn.duration = r6(clamp(c.transitionIn.duration, MIN_TRANSITION, maxD));
    }
    c.start = r6(Math.max(0, t - overlap));
    t = c.start + c.duration;
    prevTail = c.duration - overlap;
  });
}

function sortTrack(track: Track): void {
  track.clips.sort((a, b) => a.start - b.start);
}

function overlaps(track: Track, start: number, end: number, ignoreId?: string): boolean {
  return track.clips.some((c) => c.id !== ignoreId && c.start < end - EPS && clipEnd(c) > start + EPS);
}

const freeKind = (c: Clip): TrackKind => (c.kind === 'audio' ? 'audio' : 'overlay');

function newTrack(p: Project, kind: TrackKind): Track {
  const track: Track = { id: uid(), kind, clips: [] };
  if (kind === 'audio') p.tracks.push(track);
  else {
    // Overlays go above the main track and other overlays, below audio tracks.
    let at = 0;
    p.tracks.forEach((t, i) => { if (t.kind !== 'audio') at = i + 1; });
    p.tracks.splice(at, 0, track);
  }
  return track;
}

/** Places a clip on a free track: the preferred one if it fits, else the first that fits, else a new track. */
export function placeClip(p: Project, clip: Clip, preferredTrackId?: string): Track {
  const kind = freeKind(clip);
  const end = clipEnd(clip);
  const candidates = p.tracks.filter((t) => t.kind === kind);
  const preferred = candidates.find((t) => t.id === preferredTrackId);
  const track = (preferred && !overlaps(preferred, clip.start, end, clip.id) ? preferred : undefined)
    ?? candidates.find((t) => !overlaps(t, clip.start, end, clip.id))
    ?? newTrack(p, kind);
  track.clips.push(clip);
  sortTrack(track);
  return track;
}

function removeEmptyTracks(p: Project): void {
  p.tracks = p.tracks.filter((t) => t.kind === 'main' || t.clips.length > 0);
}

function afterEdit(p: Project, track: Track): void {
  if (track.kind === 'main') packMain(track);
  else sortTrack(track);
  removeEmptyTracks(p);
}

/** Inserts a visual clip into the main track at the clip boundary closest to `t`. */
export function insertMain(p: Project, clip: VisualClip, t: number): void {
  const main = mainTrack(p);
  const i = main.clips.findIndex((c) => c.start + c.duration / 2 > t);
  main.clips.splice(i < 0 ? main.clips.length : i, 0, clip);
  packMain(main);
}

export function splitClip(p: Project, id: string, t: number, minPiece = MIN_CLIP): string | null {
  const f = findClip(p, id);
  if (!f) return null;
  const c = f.clip;
  const local = r6(t - c.start);
  if (local < minPiece - EPS || c.duration - local < minPiece - EPS) return null;
  const right = clone(c);
  right.id = uid();
  right.start = r6(c.start + local);
  right.duration = r6(c.duration - local);
  c.duration = local;
  if (isMedia(c) && isMedia(right)) {
    if (c.curve) {
      // Cut in source space; each part's duration follows from its exact source span, so the picture
      // is continuous at the cut even though the re-sampled curves differ slightly from the original.
      const L = (c.duration + right.duration) * c.speed / curveIntegral(c.curve);
      const us = timeFractionToU(c.curve, local / (c.duration + right.duration));
      right.in = r6(c.in + L * us);
      right.curve = subCurve(c.curve, us, 1, RESAMPLE_POINTS);
      c.curve = subCurve(c.curve, 0, us, RESAMPLE_POINTS);
      c.duration = r6((L * us * curveIntegral(c.curve)) / c.speed);
      right.duration = r6((L * (1 - us) * curveIntegral(right.curve)) / c.speed);
      right.start = r6(c.start + c.duration);
    } else right.in = r6(c.in + local * c.speed);
  }
  if (isVisual(c) && isVisual(right)) {
    for (const key of Object.keys(c.transform) as (keyof Transform)[]) {
      [c.transform[key], right.transform[key]] = splitAnim(c.transform[key], local);
    }
    delete right.transitionIn;
  }
  if (isSound(c) && isSound(right)) { c.fadeOut = 0; right.fadeIn = 0; }
  if (c.kind === 'caption' && right.kind === 'caption') [c.words, right.words] = splitWords(c.words, local);
  if (c.kind === 'text' && right.kind === 'text') {
    c.animOut = { ...c.animOut, type: 'none' };
    right.animIn = { ...right.animIn, type: 'none' };
  }
  f.track.clips.splice(f.index + 1, 0, right);
  afterEdit(p, f.track);
  return right.id;
}

/** Moves one edge of a clip to timeline time `t` (for main-track clips, `t` is relative to the current layout). */
export function trimClip(p: Project, id: string, edge: 'start' | 'end', t: number): void {
  const f = findClip(p, id);
  if (!f) return;
  const { clip: c, track } = f;
  const free = track.kind !== 'main';
  if (isMedia(c) && c.curve) { trimCurved(p, c, edge, t, free, track, f.index); afterEdit(p, track); return; }
  const prevEnd = free && f.index > 0 ? clipEnd(track.clips[f.index - 1]) : 0;
  const nextStart = free && f.index < track.clips.length - 1 ? track.clips[f.index + 1].start : Infinity;
  if (edge === 'start') {
    let lo = c.duration - MAX_STILL; // stills may grow leftwards up to MAX_STILL
    if (isMedia(c)) lo = Math.max(lo, -c.in / c.speed); // not before the source start
    if (free) lo = Math.max(lo, prevEnd - c.start); // not over the previous clip or below 0
    const delta = r6(clamp(t - c.start, lo, c.duration - MIN_CLIP));
    if (isMedia(c)) c.in = r6(Math.max(0, c.in + delta * c.speed));
    c.start = r6(c.start + delta);
    c.duration = r6(c.duration - delta);
    mapClipAnims(c, (k) => k - delta);
    if (c.kind === 'caption') c.words = c.words.map((w) => ({ ...w, t0: w.t0 - delta, t1: w.t1 - delta }));
  } else {
    const limit = Math.min(maxDuration(c, isMedia(c) || c.kind === 'image' ? p.assets[c.assetId] : undefined), nextStart - c.start);
    c.duration = r6(clamp(t - c.start, MIN_CLIP, limit));
  }
  afterEdit(p, track);
}

/** Moves a free (overlay/audio) clip in time and optionally to another track of the same kind. */
export function moveClip(p: Project, id: string, start: number, trackId?: string): void {
  const f = findClip(p, id);
  if (!f || f.track.kind === 'main') return;
  f.track.clips.splice(f.index, 1);
  f.clip.start = r6(Math.max(0, start));
  placeClip(p, f.clip, trackId ?? f.track.id);
  removeEmptyTracks(p);
}

export function reorderMain(p: Project, id: string, toIndex: number): void {
  const main = mainTrack(p);
  const from = main.clips.findIndex((c) => c.id === id);
  if (from < 0) return;
  const [c] = main.clips.splice(from, 1);
  main.clips.splice(clamp(toIndex, 0, main.clips.length), 0, c);
  packMain(main);
}

export function deleteClip(p: Project, id: string): void {
  const f = findClip(p, id);
  if (!f) return;
  f.track.clips.splice(f.index, 1);
  afterEdit(p, f.track);
}

export function duplicateClip(p: Project, id: string): string | null {
  const f = findClip(p, id);
  if (!f) return null;
  const copy = clone(f.clip);
  copy.id = uid();
  if (f.track.kind === 'main') {
    f.track.clips.splice(f.index + 1, 0, copy);
    packMain(f.track);
  } else {
    copy.start = clipEnd(f.clip);
    placeClip(p, copy, f.track.id);
  }
  return copy.id;
}

// ---- Group operations (multi-select, v0.6): one call = one undo step. ----

type Found = NonNullable<ReturnType<typeof findClip>>;
const foundAll = (p: Project, ids: string[]): Found[] => ids.map((id) => findClip(p, id)).filter((f): f is Found => !!f);

export function deleteClips(p: Project, ids: string[]): void {
  for (const id of ids) deleteClip(p, id);
}

/**
 * Duplicates a group. Main-track copies go, in order, right after the last selected main clip; free clips keep
 * their relative offsets and land after the group's end. Returns the new ids.
 */
export function duplicateClips(p: Project, ids: string[]): string[] {
  const found = foundAll(p, ids);
  const out: string[] = [];
  const main = found.filter((f) => f.track.kind === 'main').sort((a, b) => a.index - b.index);
  if (main.length) {
    const copies = main.map((f) => ({ ...clone(f.clip), id: uid() }));
    main[0].track.clips.splice(main.at(-1)!.index + 1, 0, ...copies);
    packMain(main[0].track);
    out.push(...copies.map((c) => c.id));
  }
  const free = found.filter((f) => f.track.kind !== 'main');
  if (free.length) {
    const span = Math.max(...free.map((f) => clipEnd(f.clip))) - Math.min(...free.map((f) => f.clip.start));
    for (const f of free) {
      const c = { ...clone(f.clip), id: uid() };
      c.start = r6(c.start + span);
      placeClip(p, c, f.track.id);
      out.push(c.id);
    }
  }
  return out;
}

/** Moves free (non-main) clips together by `delta` seconds, keeping their offsets; never before 0. */
export function moveClipsBy(p: Project, ids: string[], delta: number): void {
  const free = foundAll(p, ids).filter((f) => f.track.kind !== 'main');
  if (!free.length) return;
  const d = Math.max(-Math.min(...free.map((f) => f.clip.start)), delta);
  // Move the clip that travels into the others' space last, so the group does not collide with itself.
  const order = free.map((f) => ({ id: f.clip.id, start: f.clip.start, track: f.track.id })).sort((a, b) => (d > 0 ? b.start - a.start : a.start - b.start));
  for (const c of order) moveClip(p, c.id, c.start + d, c.track);
}

/** Keeps the source in-point; timeline duration scales by old/new speed, capped by the source length. */
export function setSpeed(p: Project, id: string, speed: number): void {
  const f = findClip(p, id);
  if (!f || !isMedia(f.clip)) return;
  const c = f.clip;
  const next = clamp(speed, 0.1, 10);
  const ratio = c.speed / next;
  c.speed = next;
  c.duration = r6(clamp(c.duration * ratio, MIN_CLIP, maxDuration(c, p.assets[c.assetId])));
  mapClipAnims(c, (k) => k * ratio);
  if (f.track.kind === 'main') packMain(f.track);
  else resolveOverlap(p, c.id);
}

/** Moves a free clip to another track if it now overlaps a neighbour. */
export function resolveOverlap(p: Project, id: string): void {
  const f = findClip(p, id);
  if (!f || f.track.kind === 'main') return;
  if (!overlaps(f.track, f.clip.start, clipEnd(f.clip), id)) return;
  f.track.clips.splice(f.index, 1);
  placeClip(p, f.clip);
  removeEmptyTracks(p);
}

export function setTransition(p: Project, id: string, tr: Transition | null): void {
  const f = findClip(p, id);
  if (!f || f.track.kind !== 'main' || !isVisual(f.clip)) return;
  if (tr) f.clip.transitionIn = { ...tr };
  else delete f.clip.transitionIn;
  packMain(f.track);
}

/** Copies a video clip's sound to an audio track and mutes the video clip. Returns the audio clip id. */
export function detachAudio(p: Project, id: string): string | null {
  const f = findClip(p, id);
  if (!f || f.clip.kind !== 'video' || !p.assets[f.clip.assetId]?.hasAudio) return null;
  const c = f.clip;
  const a: AudioClip = {
    kind: 'audio', id: uid(), assetId: c.assetId, start: c.start, duration: c.duration, in: c.in, speed: c.speed,
    volume: c.volume, muted: false, fadeIn: c.fadeIn, fadeOut: c.fadeOut, audioAssetId: c.audioAssetId, denoise: c.denoise, curve: c.curve,
  };
  c.muted = true;
  placeClip(p, a);
  return a.id;
}

/** Repairs invariants after load (older schema, interrupted writes). */
export function normalizeProject(p: Project): void {
  if (!p.tracks.some((t) => t.kind === 'main')) p.tracks.unshift({ id: uid(), kind: 'main', clips: [] });
  for (const t of p.tracks) t.clips = t.clips.filter((c) => !('assetId' in c) || !!p.assets[c.assetId]);
  for (const t of p.tracks) for (const c of t.clips) if (isSound(c) && c.audioAssetId && !p.assets[c.audioAssetId]) { delete c.audioAssetId; delete c.denoise; }
  for (const t of p.tracks) if (t.kind === 'main') packMain(t); else sortTrack(t);
  removeEmptyTracks(p);
}

/**
 * Inserts a still image (a captured frame) at `t`. On the main track the clip under `t` is split and the
 * still goes in between; on an overlay it is placed at `t` on a free overlay track. The still copies the look.
 */
export function insertFreezeFrame(p: Project, clipId: string, t: number, still: Asset, duration = 2): string | null {
  const f = findClip(p, clipId);
  if (!f || (f.clip.kind !== 'video' && f.clip.kind !== 'image')) return null;
  const src = f.clip;
  const img = createImageClip(still, t, duration);
  img.adjust = clone(src.adjust);
  img.filter = src.filter ? { ...src.filter } : null;
  img.chroma = { ...src.chroma };
  if (src.crop) img.crop = { ...src.crop };
  img.blend = src.blend;
  const local = t - src.start;
  for (const k of Object.keys(img.transform) as (keyof Transform)[]) img.transform[k] = anim(evalAnimAt(src.transform[k], local));
  p.assets[still.id] = still;
  if (f.track.kind === 'main') {
    const right = splitClip(p, clipId, t);
    const main = mainTrack(p);
    const at = right ? main.clips.findIndex((c) => c.id === right) : main.clips.findIndex((c) => c.id === clipId) + (local > src.duration / 2 ? 1 : 0);
    main.clips.splice(at, 0, img);
    packMain(main);
  } else {
    placeClip(p, img);
  }
  return img.id;
}



/** Gives every asset a new id (used when importing a backup next to existing projects). */
export function remapAssets(p: Project, idFor: (old: string) => string): void {
  const assets: Record<string, Asset> = {};
  for (const a of Object.values(p.assets)) {
    const id = idFor(a.id);
    const derived = a.derived?.denoise ? { denoise: idFor(a.derived.denoise) } : undefined;
    assets[id] = { ...a, id, ...(derived ? { derived } : {}) };
  }
  p.assets = assets;
  for (const t of p.tracks) {
    for (const c of t.clips) {
      if ('assetId' in c) c.assetId = idFor(c.assetId);
      if (isSound(c) && c.audioAssetId) c.audioAssetId = idFor(c.audioAssetId);
    }
  }
}

/**
 * Keeps only the given source ranges of a media clip (e.g. speech after "Remove pauses"), laid end to end
 * from the clip's start. The first piece keeps the clip id, its incoming transition and fade-in.
 */
export function keepSourceRanges(p: Project, id: string, keep: [number, number][]): string[] {
  const f = findClip(p, id);
  if (!f || !isMedia(f.clip) || f.clip.curve || !keep.length) return [];
  const c = f.clip;
  const pieces: MediaClip[] = [];
  let cursor = c.start;
  keep.forEach(([a, b], i) => {
    const piece = clone(c);
    piece.id = i === 0 ? c.id : uid();
    piece.in = r6(a);
    piece.duration = r6((b - a) / c.speed);
    piece.start = r6(cursor);
    const offset = (a - c.in) / c.speed;
    mapClipAnims(piece, (k) => k - offset);
    if (i > 0) { piece.fadeIn = 0; if (piece.kind === 'video') delete piece.transitionIn; }
    if (i < keep.length - 1) piece.fadeOut = 0;
    cursor += piece.duration;
    pieces.push(piece);
  });
  if (f.track.kind === 'main') {
    f.track.clips.splice(f.index, 1, ...pieces);
    packMain(f.track);
  } else {
    f.track.clips.splice(f.index, 1);
    for (const piece of pieces) placeClip(p, piece, f.track.id);
  }
  return pieces.map((x) => x.id);
}

/** Trim for clips with a speed curve: edges move in source space and the curve is re-cut to the new range. */
function trimCurved(p: Project, c: MediaClip, edge: 'start' | 'end', t: number, free: boolean, track: Track, index: number): void {
  const curve = c.curve!;
  const L = sourceSpan(c), D = c.duration;
  if (edge === 'start') {
    const prevEnd = free && index > 0 ? clipEnd(track.clips[index - 1]) : -Infinity;
    const lo = Math.max(-c.in / (c.speed * curve[0]), prevEnd - c.start);
    const delta = clamp(t - c.start, lo, D - MIN_CLIP);
    const ds = delta >= 0 ? L * timeFractionToU(curve, delta / D) : delta * c.speed * curve[0];
    const next = subCurve(curve, ds / L, 1, RESAMPLE_POINTS);
    const end = c.start + D;
    c.in = r6(Math.max(0, c.in + ds));
    c.curve = next;
    c.duration = r6(Math.max(MIN_CLIP, ((L - ds) * curveIntegral(next)) / c.speed));
    const shift = end - c.duration - c.start;
    c.start = r6(end - c.duration);
    mapClipAnims(c, (k) => k - shift);
  } else {
    const nextStart = free && index < track.clips.length - 1 ? track.clips[index + 1].start : Infinity;
    const d = clamp(t - c.start, MIN_CLIP, Math.min(maxDuration(c, p.assets[c.assetId]), nextStart - c.start));
    const u1 = d <= D ? timeFractionToU(curve, d / D) : 1 + ((d - D) * c.speed * curve[curve.length - 1]) / L;
    c.curve = subCurve(curve, 0, u1, RESAMPLE_POINTS);
    c.duration = r6(Math.max(MIN_CLIP, (L * u1 * curveIntegral(c.curve)) / c.speed));
  }
}

/** Applies (or removes, with null) a speed curve; the clip keeps its source range, so its duration changes. */
export function setCurve(p: Project, id: string, points: number[] | null): void {
  const f = findClip(p, id);
  if (!f || !isMedia(f.clip)) return;
  const c = f.clip;
  const L = sourceSpan(c);
  if (points) c.curve = [...points];
  else delete c.curve;
  c.duration = r6(Math.max(MIN_CLIP, c.curve ? (L * curveIntegral(c.curve)) / c.speed : L / c.speed));
  if (f.track.kind === 'main') packMain(f.track);
  else resolveOverlap(p, c.id);
}

/** Moves each main-track cut onto the beat grid (every `every`-th beat, timeline seconds). Returns cuts moved. */
export function cutMainToBeats(p: Project, beats: number[], every = 1): number {
  const grid = beats.filter((_, i) => i % every === 0);
  const main = mainTrack(p);
  let moved = 0;
  for (let i = 0; i < main.clips.length; i++) {
    const c = main.clips[i];
    const target = grid.find((b) => b > c.start + 0.3);
    if (target === undefined) break;
    trimClip(p, c.id, 'end', target);
    moved++;
  }
  return moved;
}

const CUT_MIN = 0.01;

/**
 * Removes timeline range [a, b) from one clip: split at both edges and delete the middle. Never removes more
 * than the range — if an edge can't be split, nothing is cut.
 */
function cutClipRange(p: Project, id: string, a: number, b: number): void {
  const f = findClip(p, id);
  if (!f || b - a < CUT_MIN) return;
  const start = f.clip.start, end = clipEnd(f.clip);
  if (b < end - CUT_MIN && !splitClip(p, id, b, CUT_MIN)) return;
  let target = id;
  if (a > start + CUT_MIN) {
    const mid = splitClip(p, id, a, CUT_MIN);
    if (!mid) return;
    target = mid;
  }
  deleteClip(p, target);
}

/**
 * Ripple-cuts timeline ranges out of the main track ("edit by text"). Captions follow: words inside a
 * range are removed and later words move left. Other overlays keep their times. Returns seconds removed.
 */
export function cutTimelineRanges(p: Project, ranges: [number, number][]): number {
  const merged = [...ranges].filter(([a, b]) => b - a > 0.01).sort((x, y) => x[0] - y[0])
    .reduce<[number, number][]>((out, r) => {
      const last = out[out.length - 1];
      if (last && r[0] <= last[1] + 0.02) last[1] = Math.max(last[1], r[1]);
      else out.push([...r]);
      return out;
    }, []);
  const before = projectDuration(p);
  for (const [a, b] of merged.reverse()) { // from the end, so earlier positions stay valid
    const main = mainTrack(p);
    const hits = main.clips.filter((c) => c.start < b && clipEnd(c) > a).reverse();
    if (!hits.length) continue;
    for (const c of hits) cutClipRange(p, c.id, Math.max(a, c.start), Math.min(b, clipEnd(c)));
    const len = b - a;
    for (const t of p.tracks) {
      for (const c of t.clips) {
        if (c.kind !== 'caption') continue;
        if (c.start >= b) { c.start = r6(c.start - len); continue; }
        if (clipEnd(c) <= a) continue;
        const ra = a - c.start, rb = b - c.start;
        c.words = c.words.filter((w) => w.t1 <= ra + 0.02 || w.t0 >= rb - 0.02)
          .map((w) => (w.t0 >= rb - 0.02 ? { ...w, t0: w.t0 - len, t1: w.t1 - len } : w));
        c.duration = r6(Math.max(MIN_CLIP, c.duration - Math.max(0, Math.min(clipEnd(c), b) - Math.max(c.start, a))));
      }
    }
  }
  return r6(before - projectDuration(p));
}
