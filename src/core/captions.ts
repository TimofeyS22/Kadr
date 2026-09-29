// Caption logic: grouping words into on-screen pages, the active word, SRT import/export.
import type { CaptionClip, CaptionWord } from './types';

const SENTENCE_END = /[.!?…]$/;

/** Groups words into pages: at most `maxWords`, broken at long pauses and sentence ends. */
export function captionPages(words: CaptionWord[], maxWords: number, maxGap = 0.7): CaptionWord[][] {
  const pages: CaptionWord[][] = [];
  let page: CaptionWord[] = [];
  for (const w of words) {
    const prev = page.at(-1);
    const newCue = prev?.cue !== undefined && w.cue !== prev.cue;
    if (prev && (newCue || page.length >= maxWords || w.t0 - prev.t1 > maxGap || SENTENCE_END.test(prev.text))) {
      pages.push(page);
      page = [];
    }
    page.push(w);
  }
  if (page.length) pages.push(page);
  return pages;
}

/** Page shown at clip-local time `t` and the index of the word being spoken (-1 between words). */
export function captionAt(c: Pick<CaptionClip, 'words' | 'wordsPerPage'>, t: number): { words: string[]; active: number } | null {
  const pages = captionPages(c.words, Math.max(1, c.wordsPerPage));
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i];
    const next = pages[i + 1];
    const end = Math.min(p[p.length - 1].t1 + 0.5, next ? next[0].t0 : Infinity);
    if (t >= p[0].t0 && t < end) {
      return { words: p.map((w) => w.text), active: p.findIndex((w) => t >= w.t0 && t < w.t1) };
    }
  }
  return null;
}

/** Spreads a phrase over [t0, t1] proportionally to word length (for SRT import and plain segments). */
export function wordsFromSegment(t0: number, t1: number, text: string): CaptionWord[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean);
  const total = tokens.reduce((n, w) => n + w.length + 1, 0);
  let t = t0;
  return tokens.map((w) => {
    const d = ((w.length + 1) / total) * (t1 - t0);
    const word = { t0: t, t1: t + d, text: w };
    t += d;
    return word;
  });
}

const pad = (n: number, l = 2) => String(n).padStart(l, '0');
function srtTime(s: number): string {
  const ms = Math.max(0, Math.round(s * 1000));
  return `${pad(Math.floor(ms / 3600000))}:${pad(Math.floor(ms / 60000) % 60)}:${pad(Math.floor(ms / 1000) % 60)},${pad(ms % 1000, 3)}`;
}

/** SRT with one cue per page, in timeline time. */
export function toSrt(clips: CaptionClip[]): string {
  const cues: string[] = [];
  for (const c of [...clips].sort((a, b) => a.start - b.start)) {
    for (const page of captionPages(c.words, Math.max(1, c.wordsPerPage))) {
      const t0 = c.start + page[0].t0, t1 = c.start + page[page.length - 1].t1;
      if (t1 <= c.start || t0 >= c.start + c.duration) continue;
      cues.push(`${cues.length + 1}\n${srtTime(t0)} --> ${srtTime(Math.min(t1, c.start + c.duration))}\n${page.map((w) => w.text).join(' ')}\n`);
    }
  }
  return cues.join('\n');
}

// Hours are optional in WebVTT (mm:ss.ttt).
const TIME = /(?:(\d+):)?(\d{2}):(\d{2})[,.](\d{1,3})/;
const toSec = (m: RegExpExecArray) => +(m[1] ?? 0) * 3600 + +m[2] * 60 + +m[3] + +m[4].padEnd(3, '0') / 1000;

/** Parses SRT or WebVTT cues into words in absolute time. Tolerates BOM, CRLF and styling tags. */
export function parseSubtitles(text: string): CaptionWord[] {
  const words: CaptionWord[] = [];
  for (const block of text.replace(/^﻿/, '').replace(/\r/g, '').split(/\n{2,}/)) {
    const lines = block.split('\n');
    const i = lines.findIndex((l) => l.includes('-->'));
    if (i < 0) continue;
    const [a, b] = lines[i].split('-->');
    const m0 = TIME.exec(a), m1 = TIME.exec(b);
    if (!m0 || !m1) continue;
    const body = lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim();
    const cue = words.length ? (words[words.length - 1].cue ?? 0) + 1 : 0;
    if (body) words.push(...wordsFromSegment(toSec(m0), toSec(m1), body).map((x) => ({ ...x, cue })));
  }
  return words.sort((x, y) => x.t0 - y.t0);
}

/** Splits caption words at clip-local time `at`; the right part is rebased to 0. */
export function splitWords(words: CaptionWord[], at: number): [CaptionWord[], CaptionWord[]] {
  return [
    words.filter((w) => w.t0 < at),
    words.filter((w) => w.t0 >= at).map((w) => ({ ...w, t0: w.t0 - at, t1: w.t1 - at })),
  ];
}

export interface VadOptions { on: number; off: number; minSpeech: number; minSilence: number; pad: number }
export const DEFAULT_VAD: VadOptions = { on: 0.5, off: 0.35, minSpeech: 0.25, minSilence: 0.3, pad: 0.2 };

/** Speech segments (seconds) from per-frame speech probabilities, with hysteresis and padding. */
export function vadSegments(probs: Float32Array, frame: number, o: VadOptions = DEFAULT_VAD): [number, number][] {
  const raw: [number, number][] = [];
  let start = -1;
  for (let i = 0; i <= probs.length; i++) {
    const p = i < probs.length ? probs[i] : 0;
    if (start < 0 && p >= o.on) start = i;
    else if (start >= 0 && p < o.off) { raw.push([start * frame, i * frame]); start = -1; }
  }
  const merged: [number, number][] = [];
  for (const s of raw) {
    const last = merged[merged.length - 1];
    if (last && s[0] - last[1] < o.minSilence) last[1] = s[1];
    else merged.push([...s]);
  }
  const end = probs.length * frame;
  return merged.filter(([a, b]) => b - a >= o.minSpeech).map(([a, b]) => [Math.max(0, a - o.pad), Math.min(end, b + o.pad)]);
}

/** Groups speech segments into transcription windows no longer than `max` seconds. */
export function speechWindows(segments: [number, number][], max = 28): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of segments) {
    const last = out[out.length - 1];
    if (last && b - last[0] <= max) last[1] = b;
    else {
      for (let s = a; s < b; s += max) out.push([s, Math.min(b, s + max)]); // very long speech is split
    }
  }
  return out;
}

/** Keeps words whose middle falls inside speech (drops text invented over music or silence). */
export const wordsInSpeech = (words: CaptionWord[], segments: [number, number][], slack = 0.3): CaptionWord[] =>
  words.filter((w) => { const m = (w.t0 + w.t1) / 2; return segments.some(([a, b]) => m >= a - slack && m <= b + slack); });

/** Where the voice actually starts inside [from, to): first 10 ms frame louder than 15 % of the segment's peak. */
export function speechOnset(audio: Float32Array, sr: number, from: number, to: number): number {
  const hop = Math.round(sr / 100);
  const i0 = Math.max(0, Math.floor(from * sr)), i1 = Math.min(audio.length, Math.ceil(to * sr));
  const rms: number[] = [];
  for (let i = i0; i + hop <= i1; i += hop) {
    let e = 0;
    for (let k = i; k < i + hop; k++) e += audio[k] * audio[k];
    rms.push(Math.sqrt(e / hop));
  }
  const peak = Math.max(0, ...rms);
  const k = rms.findIndex((v) => v > Math.max(0.01, peak * 0.15));
  return k < 0 ? from : (i0 + k * hop) / sr;
}

/**
 * Whisper's word times tend to lag the voice by a few hundred ms. For each speech segment, shift its words so
 * the first one starts at the measured voice onset. Lags outside (0.04, 0.6) s are left alone.
 */
export function alignToSpeech(words: CaptionWord[], segments: [number, number][], onsets: number[]): CaptionWord[] {
  const out = words.map((w) => ({ ...w }));
  for (const [si, [a, b]] of segments.entries()) {
    const inSeg = out.filter((w) => { const m = (w.t0 + w.t1) / 2; return m >= a && m <= b; });
    if (!inSeg.length) continue;
    const lag = inSeg[0].t0 - (onsets[si] ?? a);
    if (lag <= 0.04 || lag >= 0.6) continue;
    for (const w of inSeg) { w.t0 = Math.max(a, w.t0 - lag); w.t1 = Math.max(w.t0 + 0.05, w.t1 - lag); }
  }
  return out;
}
