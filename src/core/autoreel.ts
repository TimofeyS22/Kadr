// "Reel in one tap" (docs/08 A): the pure planning half — which ranges to cut, how to zoom, what the hook says.
// The orchestration (transcription, waveforms, music download, commits) lives in ui/autoreel.ts.
import { anim, defaultTransform, uid } from './defaults';
import { coverScale, fillerIndices } from './reframe';
import { DEFAULT_PAUSES, speechRanges, wordCutRange, type PauseOptions } from './silence';
import { clipEnd, isMedia, mainTrack, sourceTime, timelineTimeOf } from './timeline';
import type { CaptionWord, MediaClip, Project, TextClip } from './types';

/** Extra zoom of every other piece after the cuts: the classic way to hide jump cuts in a talking-head video. */
export const JUMP_ZOOM = 1.12;
export const HOOK_S = 2.5;
const HOOK_MAX_WORDS = 7;

/**
 * Timeline ranges of a main clip that are silence (pauses, dead air at the start and end), from its sound's peaks.
 * A clip with no speech at all gets no cuts: silence everywhere means "music video", not "cut everything".
 */
export function pauseCuts(c: MediaClip, peaks: Float32Array, pps: number, o: PauseOptions = DEFAULT_PAUSES): [number, number][] {
  if (c.curve) return [];
  const from = c.in, to = sourceTime(c, clipEnd(c));
  const keep = speechRanges(peaks, pps, from, to, o);
  if (!keep.length) return [];
  const cuts: [number, number][] = [];
  let cursor = from;
  for (const [a, b] of keep) {
    if (a - cursor > 0.05) cuts.push([timelineTimeOf(c, cursor), timelineTimeOf(c, a)]);
    cursor = b;
  }
  if (to - cursor > 0.05) cuts.push([timelineTimeOf(c, cursor), timelineTimeOf(c, to)]);
  return cuts;
}

/**
 * Timeline cut ranges for filler words and immediate repeats (words in timeline seconds). Each cut edge moves to the
 * quietest point next to the word (via the clip's peaks), so the neighbouring words keep their first and last sounds.
 */
export function fillerCuts(
  words: CaptionWord[], clips: MediaClip[], peaksOf: (c: MediaClip) => Float32Array | undefined, pps: number,
): { ranges: [number, number][]; indices: number[] } {
  const indices = fillerIndices(words);
  const ranges: [number, number][] = [];
  for (const i of indices) {
    const w = words[i], mid = (w.t0 + w.t1) / 2;
    const c = clips.find((x) => mid >= x.start && mid < clipEnd(x));
    const peaks = c && peaksOf(c);
    if (!c || !peaks || c.curve) { ranges.push([w.t0, w.t1]); continue; }
    const [s0, s1] = wordCutRange(peaks, pps, sourceTime(c, w.t0), sourceTime(c, w.t1));
    ranges.push([timelineTimeOf(c, s0), timelineTimeOf(c, s1)]);
  }
  return { ranges, indices };
}

/**
 * Whisper often runs the last word before a pause into the silence (or starts a word inside the pause before it).
 * The sound says it is silence, so each word is fitted to the speech side of the pause and survives the pause cut.
 */
export function fitWordsToPauses(words: CaptionWord[], pauses: [number, number][]): CaptionWord[] {
  return words.map((w) => {
    let { t0, t1 } = w;
    for (const [a, b] of pauses) {
      if (t1 <= a || t0 >= b) continue;
      const head = Math.max(0, a - t0), tail = Math.max(0, t1 - b);
      if (head > 0 && head >= tail) t1 = a;
      else if (tail > 0) t0 = b;
      else { // all inside the silence: the timing is off, so the word goes to the nearer edge
        const d = Math.min(t1 - t0, 0.25);
        if ((t0 + t1) / 2 - a < b - (t0 + t1) / 2) { t0 = a - d; t1 = a; } else { t0 = b; t1 = b + d; }
      }
    }
    return t0 === w.t0 && t1 === w.t1 ? w : { ...w, t0, t1 };
  });
}

/** Words without the ones at `drop` (filler indices): what the captions should say. */
export const withoutIndices = (words: CaptionWord[], drop: number[]): CaptionWord[] => {
  const set = new Set(drop);
  return words.filter((_, i) => !set.has(i));
};

/**
 * Fills the frame with each main video (cover, centered) and zooms every other piece by JUMP_ZOOM. Clips with
 * animated scale (keyframes, auto reframe) keep their animation. Returns how many pieces were zoomed.
 */
export function jumpZoom(p: Project): number {
  const canvas = p.settings.width / p.settings.height;
  let zoomed = 0;
  mainTrack(p).clips.forEach((c, i) => {
    if (c.kind !== 'video' || c.transform.scale.k?.length) return;
    const a = p.assets[c.assetId];
    const src = a && a.height ? a.width / a.height : canvas;
    const fill = Math.abs(src - canvas) > 0.02 ? coverScale(src, canvas) : 1;
    const zoom = i % 2 === 1 ? JUMP_ZOOM : 1;
    c.transform.scale = anim(fill * zoom);
    if (zoom > 1) zoomed++;
  });
  return zoomed;
}

/** The first phrase (to a sentence end, at most 7 words), as a hook title; null when there is too little speech. */
export function hookText(words: CaptionWord[]): string | null {
  const out: string[] = [];
  for (const w of words) {
    out.push(w.text);
    if (out.length >= HOOK_MAX_WORDS || /[.!?…]$/.test(w.text)) break;
  }
  if (out.length < 2) return null;
  const s = out.join(' ').replace(/[,;:—-]+$/, '');
  return s.charAt(0).toLocaleUpperCase() + s.slice(1);
}

/** A big title at the top for the first seconds: what stops the scroll. */
export function hookClip(text: string): TextClip {
  return {
    kind: 'text', id: uid(), start: 0, duration: HOOK_S, text,
    style: {
      font: 'montserrat', size: 0.052, weight: 900, italic: false, color: '#111111', align: 'center', uppercase: true,
      stroke: null, background: { color: '#ffffff', opacity: 1, padding: 0.3 }, shadow: false,
    },
    animIn: { type: 'pop', duration: 0.3 },
    animOut: { type: 'none', duration: 0.3 },
    transform: { ...defaultTransform(), y: anim(-0.3) },
    blend: 'normal',
  };
}

/** Main-track clips that carry sound worth analysing. */
export const soundMainClips = (p: Project): MediaClip[] =>
  mainTrack(p).clips.filter((c): c is MediaClip => isMedia(c) && !c.muted && !!p.assets[c.assetId]?.hasAudio);
