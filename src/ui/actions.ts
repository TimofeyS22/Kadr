// User-level editing actions shared by the toolbar, sheets and keyboard shortcuts.
import { captionPages, parseSubtitles, toSrt } from '../core/captions';
import { anim, createAudioClip, createCaptionClip, createImageClip, createTextClip, createVideoClip, uid } from '../core/defaults';
import { MAX_CUBE_BYTES, parseCube, toBase64 } from '../core/lut';
import { fitTrack, type LibraryTrack } from '../core/music';
import { CAPTION_PRESETS } from '../core/presets';
import {
  clipEnd, deleteClip, deleteClips, detachAudio, duplicateClip, duplicateClips, moveClipsBy, expectedAudioKey, findClip, insertFreezeFrame, insertMain, isSound, mainTrack, placeClip,
  sourceTime, splitClip,
} from '../core/timeline';
import type { Asset, CaptionClip, CaptionWord, Clip, SoundClip } from '../core/types';
import { prepareClipSound } from '../engine/audiofx';
import { coverScale, reframeKeys } from '../core/reframe';
import { saveFile } from '../engine/exporter';
import { MediaError, captureFrame } from '../engine/media';
import { importFile, importFiles, pickFiles } from '../engine/importer';
import { putBlob } from '../storage/db';
import { player } from '../engine/player';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { mark } from '../lib/perf';
import { t } from '../lib/i18n';

export type AddTarget = 'main' | 'overlay' | 'audio';

export async function addMedia(target: AddTarget): Promise<void> {
  const files = await pickFiles(target === 'audio' ? 'audio/*,video/*' : 'video/*,image/*');
  await addFiles(files, target);
}

/** Imports files and places them at the playhead (also used for drag and drop). */
export async function addFiles(files: File[], target: AddTarget): Promise<void> {
  if (!files.length) return;
  const s = editor();
  const busy = (i: number) => useEditor.setState({ busy: { label: t('Adding {i} of {n}…', { i: i + 1, n: files.length }), progress: i / files.length } });
  busy(0);
  mark('import:start');
  let assets: Asset[] = [];
  try {
    assets = await importFiles(files, (name, e) => s.toast(t('Could not add {name}: {error}', { name, error: errorMessage(e) }), 'error'), busy);
  } finally {
    useEditor.setState({ busy: null });
  }
  if (!assets.length) return;
  let first: string | null = null;
  const now = player.time;
  editor().commit((d) => {
    let at = now;
    for (const a of assets) {
      d.assets[a.id] = a;
      const clip = clipFor(a, target);
      if (!clip) continue;
      if (clip.kind === 'audio' || target !== 'main') {
        clip.start = at;
        if (clip.kind !== 'audio') clip.transform.scale = anim(0.6);
        placeClip(d, clip);
      } else {
        insertMain(d, clip, at);
      }
      at = clipEnd(clip);
      first ??= clip.id;
    }
  });
  if (first) editor().select(first);
  track('media_imported', { count: assets.length, target });
}

function clipFor(a: Asset, target: AddTarget): Clip | null {
  if (target === 'audio' || a.kind === 'audio') return a.hasAudio ? createAudioClip(a) : null;
  return a.kind === 'image' ? createImageClip(a) : createVideoClip(a);
}

const showFrom = (t: number) => { player.pause(); player.seek(t); useEditor.setState({ time: player.time }); };

export function addText(): void {
  let id = '';
  editor().commit((d) => {
    const c = createTextClip(player.time);
    placeClip(d, c);
    id = c.id;
  });
  editor().select(id);
  showFrom(player.time + 0.35); // past the fade-in, so the new text is visible
  editor().openSheet('text');
}

/** Splits the selected clip, or the main-track clip under the playhead. */
export function splitAtPlayhead(): void {
  const s = editor();
  const p = s.project;
  if (!p) return;
  const now = player.time;
  const covers = (c: Clip) => now > c.start && now < clipEnd(c);
  let id = s.selection;
  const sel = id ? findClip(p, id)?.clip : undefined;
  if (!sel || !covers(sel)) id = mainTrack(p).clips.find(covers)?.id ?? null;
  if (!id) { s.toast(t('Move the playhead over a clip to split it')); return; }
  let right: string | null = null;
  s.commit((d) => { right = splitClip(d, id, now); });
  if (!right) s.toast(t('Too close to the edge of the clip'));
  else track('clip_split');
}

export function deleteSelected(): void {
  const { selection, commit, select } = editor();
  if (!selection) return;
  commit((d) => deleteClip(d, selection));
  select(null);
}

/** Multi-select: ids that still exist (undo may have removed some). */
function picked(): string[] {
  const { multi, project } = editor();
  return project && multi ? multi.filter((id) => findClip(project, id)) : [];
}

export function deleteMulti(): void {
  const ids = picked();
  if (!ids.length) return;
  editor().commit((d) => deleteClips(d, ids));
  editor().setMulti([]);
  track('multi_delete', { n: ids.length });
}

export function duplicateMulti(): void {
  const ids = picked();
  if (!ids.length) return;
  let copies: string[] = [];
  editor().commit((d) => { copies = duplicateClips(d, ids); });
  editor().setMulti(copies);
  track('multi_duplicate', { n: ids.length });
}

/** Moves the picked free clips so the earliest one starts at the playhead. */
export function multiToPlayhead(): void {
  const ids = picked();
  const p = editor().project;
  const free = p ? ids.map((id) => findClip(p, id)).filter((f) => f && f.track.kind !== 'main') : [];
  if (!free.length) { editor().toast(t('Main-track clips keep their order; pick clips on other tracks to move them')); return; }
  const delta = player.time - Math.min(...free.map((f) => f!.clip.start));
  editor().commit((d) => moveClipsBy(d, ids, delta));
}

export function duplicateSelected(): void {
  const { selection, commit, select } = editor();
  if (!selection) return;
  let id: string | null = null;
  commit((d) => { id = duplicateClip(d, selection); });
  if (id) select(id);
}

export function detachSelectedAudio(): void {
  const { selection, commit, toast } = editor();
  if (!selection) return;
  let id: string | null = null;
  commit((d) => { id = detachAudio(d, selection); });
  toast(id ? t('Audio extracted to its own track') : t('This clip has no audio'));
}

/** Edits one clip by id inside an undoable commit. */
export function editClip(id: string, fn: (c: Clip) => void, key?: string): void {
  editor().commit((d) => {
    const f = findClip(d, id);
    if (f) fn(f.clip);
  }, key);
}


/** Clip under the playhead: the selected one if it covers the playhead, else the main-track clip. */
function clipAtPlayhead(kinds: Clip['kind'][]): Clip | null {
  const s = editor();
  if (!s.project) return null;
  const now = player.time;
  const covers = (c: Clip) => now >= c.start && now < clipEnd(c) && kinds.includes(c.kind);
  const sel = s.selection ? findClip(s.project, s.selection)?.clip : undefined;
  return sel && covers(sel) ? sel : mainTrack(s.project).clips.find(covers) ?? null;
}

/**
 * Long jobs (reverse, reframe, freeze) apply their result only if their clip is untouched in the meantime:
 * immer keeps unchanged clips as the same object, so any edit or undo that affected the clip changes its identity.
 */
function unchanged(clip: Clip): boolean {
  const p = editor().project;
  const same = !!p && findClip(p, clip.id)?.clip === clip;
  if (!same && p) editor().toast(t('The clip changed while this was running. Try again.'));
  return same;
}

export async function freezeFrame(): Promise<void> {
  const c = clipAtPlayhead(['video']);
  if (!c || c.kind !== 'video') { editor().toast(t('Put the playhead over a video clip')); return; }
  player.pause();
  const now = player.time;
  try {
    const blob = await captureFrame(c.assetId, sourceTime(c, now));
    const still = await importFile(blob, 'Freeze frame.jpg');
    if (!unchanged(c)) return;
    let id: string | null = null;
    editor().commit((d) => { id = insertFreezeFrame(d, c.id, now, still); });
    if (id) editor().select(id);
    track('freeze_frame');
  } catch (e) {
    editor().toast(errorMessage(e), 'error');
  }
}

export function addSticker(emoji: string): void {
  let id = '';
  editor().commit((d) => {
    const c = createTextClip(player.time, emoji);
    c.style = { ...c.style, size: 0.14, shadow: false };
    c.animIn = { type: 'pop', duration: 0.35 };
    c.animOut = { type: 'fade', duration: 0.2 };
    placeClip(d, c);
    id = c.id;
  });
  editor().select(id);
  showFrom(player.time + 0.36);
  editor().openSheet(null);
  track('sticker_added');
}

/** Adds a caption clip from words in timeline time. */
export function addCaptions(words: CaptionWord[], presetId = 'pop', wordsPerPage?: number): void {
  if (!words.length) { editor().toast(t('No speech was found in this video')); return; }
  const preset = CAPTION_PRESETS.find((x) => x.id === presetId) ?? CAPTION_PRESETS[0];
  let id = '';
  editor().commit((d) => {
    const c = createCaptionClip(words, wordsPerPage ? { ...preset, wordsPerPage } : preset);
    placeClip(d, c);
    id = c.id;
  });
  editor().select(id);
  editor().openSheet('captionEdit');
}

export async function importSubtitles(): Promise<void> {
  const [file] = await pickFiles('.srt,.vtt,text/vtt,application/x-subrip', false);
  if (!file) return;
  const words = parseSubtitles(await file.text());
  if (!words.length) { editor().toast(t('No subtitles found in this file'), 'error'); return; }
  addCaptions(words, 'clean', 16); // imported cues keep their own lines
  track('subtitles_imported', { words: words.length });
}

export async function exportSubtitles(): Promise<void> {
  const p = editor().project;
  if (!p) return;
  const clips = p.tracks.flatMap((t) => t.clips.filter((c): c is CaptionClip => c.kind === 'caption'));
  if (!clips.length) { editor().toast(t('There are no captions yet')); return; }
  await saveFile(new Blob([toSrt(clips)], { type: 'application/x-subrip' }), `${p.name || 'captions'}.srt`);
}

export const pageCount = (c: CaptionClip): number => captionPages(c.words, Math.max(1, c.wordsPerPage)).length;

/**
 * Changes a clip's sound settings (noise reduction, keep pitch) and builds the processed sound on device if
 * needed. Until processing finishes the clip plays its source sound.
 */
export async function updateClipSound(clipId: string, change: (c: SoundClip) => void, onProgress: (f: number) => void, signal: AbortSignal): Promise<void> {
  editor().commit((d) => { const f = findClip(d, clipId); if (f && isSound(f.clip)) change(f.clip); });
  const p = editor().project;
  const f = p ? findClip(p, clipId) : null;
  if (!p || !f || !isSound(f.clip)) return;
  const clip = f.clip;
  const key = expectedAudioKey(clip);
  if (key && clip.audioKey === key && clip.audioAssetId && p.assets[clip.audioAssetId]) return;
  const r = key ? await prepareClipSound(p, clip, onProgress, signal) : null;
  // Attaching the processed sound is not an edit of its own: undo goes straight back to the previous settings.
  editor().amend((d) => {
    if (r) {
      for (const a of r.created) d.assets[a.id] = a;
      const src = d.assets[clip.assetId];
      if (src) src.derived = r.derived;
    }
    const g = findClip(d, clipId);
    if (!g || !isSound(g.clip) || expectedAudioKey(g.clip) !== key) return; // settings changed meanwhile
    if (r?.assetId) { g.clip.audioAssetId = r.assetId; g.clip.audioKey = key; }
    else { delete g.clip.audioAssetId; delete g.clip.audioKey; }
  });
}

/** Runs a long on-device job with the shared progress overlay; returns null if cancelled. */
export async function withBusy<T>(label: string, job: (progress: (f: number) => void, signal: AbortSignal) => Promise<T>): Promise<T | null> {
  const ac = new AbortController();
  const set = (progress: number | null) => useEditorSet({ busy: { label, progress, cancel: () => ac.abort() } });
  set(null);
  try {
    return await job((f) => set(f), ac.signal);
  } catch (e) {
    if ((e as Error).name !== 'AbortError') editor().toast(errorMessage(e), 'error');
    return null;
  } finally {
    useEditorSet({ busy: null });
  }
}
const useEditorSet = (patch: Partial<ReturnType<typeof editor>>) => useEditor.setState(patch);

export async function reverseSelected(): Promise<void> {
  const s = editor();
  const f = s.project && s.selection ? findClip(s.project, s.selection) : null;
  if (!f || f.clip.kind !== 'video') return;
  const clip = f.clip;
  if (clip.reversedFrom) {
    const back = clip.reversedFrom;
    s.commit((d) => { const g = findClip(d, clip.id); if (g && g.clip.kind === 'video') { g.clip.assetId = back.assetId; g.clip.in = back.in; delete g.clip.reversedFrom; delete g.clip.audioAssetId; delete g.clip.audioKey; } });
    s.toast(t('Playing forward again'));
    return;
  }
  player.pause();
  // The overlay goes up in the same tap (before the module loads), so nothing can be edited while this runs.
  const project = s.project!;
  const rev = await withBusy(t('Reversing the clip on this device…'), async (progress, signal) =>
    (await import('../engine/reverse')).reverseClipSource(project, clip, progress, signal));
  if (!rev || !unchanged(clip)) return;
  editor().commit((d) => {
    d.assets[rev.id] = rev;
    const g = findClip(d, clip.id);
    if (!g || g.clip.kind !== 'video') return;
    g.clip.reversedFrom = { assetId: g.clip.assetId, in: g.clip.in };
    g.clip.assetId = rev.id;
    g.clip.in = 0;
    delete g.clip.audioAssetId;
    delete g.clip.audioKey;
  });
  track('clip_reversed', { seconds: Math.round(rev.duration) });
}

/** Turns automatic face hiding on (loading the on-device detector first) or off. */
export async function setHideFaces(clipId: string, on: boolean): Promise<void> {
  if (on) {
    const ok = await withBusy(t('Preparing face detection…'), async () => { await (await import('../engine/faces')).warmFaces(); return true; });
    if (!ok) return;
  }
  editClip(clipId, (c) => {
    if (c.kind !== 'video' && c.kind !== 'image') return;
    c.privacy ??= { faces: false, areas: [], style: 'blur' };
    c.privacy.faces = on;
  });
  track('hide_faces', { on });
}

/** Imports a .cube LUT into the project and applies it to the clip. */
export async function importLut(clipId: string): Promise<void> {
  // No accept filter: iOS greys out files whose extension it does not know, and .cube is one of them.
  const [file] = await pickFiles('', false);
  if (!file) return;
  try {
    if (file.size > MAX_CUBE_BYTES) throw new MediaError('This LUT file is too large (over 10 MB)');
    const lut = parseCube(await file.text());
    const id = uid();
    editor().commit((d) => {
      d.luts = { ...d.luts, [id]: { name: (lut.title || file.name.replace(/\.cube$/i, '')).slice(0, 40), size: lut.size, data: toBase64(lut.data) } };
      const f = findClip(d, clipId);
      if (f && (f.clip.kind === 'video' || f.clip.kind === 'image')) f.clip.lut = { id, intensity: 1 };
    });
    track('lut_imported', { size: lut.size });
  } catch (e) {
    editor().toast(t('Could not import the LUT: {error}', { error: errorMessage(e) }), 'error');
  }
}

/** Adds a font file (TTF/OTF/WOFF/WOFF2) to the project and applies it to the text clip. */
export async function addCustomFont(clipId: string): Promise<void> {
  // No accept filter: iOS greys out font files it does not know.
  const [file] = await pickFiles('', false);
  if (!file) return;
  try {
    const { validateFont, registerFont } = await import('../engine/customFonts');
    await validateFont(file);
    const id = uid();
    await putBlob(id, file);
    await registerFont(id, id);
    const name = file.name.replace(/\.(ttf|otf|woff2?)$/i, '').slice(0, 32) || 'Font';
    editor().commit((d) => {
      d.fonts = { ...d.fonts, [id]: { name, blobId: id } };
      const f = findClip(d, clipId);
      if (f && f.clip.kind === 'text') f.clip.style.font = `custom:${id}`;
    });
    editor().toast(t('Font added: {name}. Check that it has the letters you need.', { name }));
    track('font_added');
  } catch (e) {
    editor().toast(t('Could not add the font: {error}', { error: errorMessage(e) }), 'error');
  }
}

export const musicUrl = (path: string): string => new URL(`${import.meta.env.BASE_URL}music/${path}`, location.origin).href;

/** Downloads a library track (with progress), imports it with its beat grid and puts it under the video. */
export async function addLibraryTrack(tr: LibraryTrack): Promise<void> {
  const asset = await withBusy(t('Adding “{title}”…', { title: tr.title }), async (progress, signal) => {
    const res = await fetch(musicUrl(tr.file), { signal });
    if (!res.ok || !res.body) throw new MediaError('Could not download the track. Check the connection and try again.');
    const reader = res.body.getReader();
    const parts: Uint8Array<ArrayBuffer>[] = [];
    let got = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value as Uint8Array<ArrayBuffer>);
      got += value.length;
      progress(Math.min(0.95, got / tr.bytes));
    }
    const a = await importFile(new File(parts, `${tr.title}.m4a`, { type: 'audio/mp4' }), `${tr.title} — ${tr.artist}`);
    return {
      ...a,
      beats: tr.bpm && tr.beats ? { bpm: tr.bpm, times: tr.beats } : undefined,
      library: { id: tr.id, title: tr.title, artist: tr.artist, license: tr.license, licenseUrl: tr.licenseUrl, source: tr.source },
    } satisfies Asset;
  });
  if (!asset) return;
  const s = editor();
  const p = s.project;
  if (!p) return;
  const videoS = mainTrack(p).clips.reduce((m, c) => Math.max(m, clipEnd(c)), 0);
  const fit = fitTrack(asset.duration, videoS);
  let id = '';
  s.commit((d) => {
    d.assets[asset.id] = asset;
    const c = createAudioClip(asset, 0);
    c.duration = fit.duration;
    c.fadeOut = fit.fadeOut;
    placeClip(d, c);
    id = c.id;
  });
  s.select(id);
  s.openSheet(null);
  s.toast(t('Added “{title}”. Free to use anywhere, no credit needed.', { title: tr.title }));
  track('music_added', { mood: tr.mood, bpm: Math.round(tr.bpm ?? 0) });
}

export async function toggleCutout(): Promise<void> {
  const s = editor();
  const f = s.project && s.selection ? findClip(s.project, s.selection) : null;
  if (!f || (f.clip.kind !== 'video' && f.clip.kind !== 'image')) return;
  const on = !f.clip.removeBg;
  if (on) {
    const ok = await withBusy(t('Preparing person detection…'), async () => { await (await import('../engine/segment')).warmSegmenter(); return true; });
    if (!ok) return;
  }
  editClip(f.clip.id, (c) => { if (c.kind === 'video' || c.kind === 'image') c.removeBg = on; });
  s.toast(on ? t('Background removed. Works best with people in the frame.') : t('Background restored'));
  track('cutout', { on });
}

export async function addSfx(id: string): Promise<void> {
  const { SFX, renderSfx, toWav } = await import('../engine/sfx');
  const sfx = SFX.find((x) => x.id === id);
  if (!sfx) return;
  const asset = await importFile(toWav(await renderSfx(sfx)), `${sfx.name}.wav`);
  let clipId = '';
  editor().commit((d) => {
    d.assets[asset.id] = asset;
    const c = createAudioClip(asset, player.time);
    placeClip(d, c);
    clipId = c.id;
  });
  editor().select(clipId);
  track('sfx_added', { id });
}

/** Pans a horizontal clip inside a narrower canvas so the person stays in frame (keyframed transform.x). */
export async function autoReframe(): Promise<void> {
  const s = editor();
  const f = s.project && s.selection ? findClip(s.project, s.selection) : null;
  if (!s.project || !f || f.clip.kind !== 'video') return;
  const clip = f.clip;
  const asset = s.project.assets[clip.assetId];
  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const src = (asset.width * crop.w) / Math.max(1, asset.height * crop.h);
  const canvas = s.project.settings.width / s.project.settings.height;
  if (src <= canvas * 1.05) { s.toast(t('Auto reframe is for horizontal videos in vertical or square projects')); return; }
  player.pause();
  const samples = await withBusy(t('Following the person in the shot…'), async (progress, signal) => {
    const [{ trackSubject }, { warmSegmenter }] = await Promise.all([import('../engine/reframe'), import('../engine/segment')]);
    await warmSegmenter();
    return trackSubject(clip, progress, signal);
  });
  if (!samples || !unchanged(clip)) return;
  const found = samples.filter((x) => x.u !== null).length;
  if (!found) { s.toast(t('No person found in this clip')); return; }
  const width = coverScale(src, canvas);
  const keys = reframeKeys(samples, width);
  editClip(clip.id, (c) => {
    if (c.kind !== 'video') return;
    c.transform.scale = anim(width);
    c.transform.y = anim(0);
    c.transform.x = keys.length > 1 ? { v: keys[0].v, k: keys } : anim(keys[0]?.v ?? 0);
  });
  s.toast(t('Reframed: the shot follows the person. Fine-tune in Transform.'));
  track('auto_reframe', { samples: samples.length, found, keys: keys.length });
}
