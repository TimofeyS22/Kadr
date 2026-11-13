import { describe, expect, it } from 'vitest';
import { captionCursor, clipToRanges, clipWordsOnTimeline, mergeCaptionWords, normalizeRanges, rangesSeconds, setClipWords } from './captions';
import { createCaptionClip } from './defaults';
import { CAPTION_PRESETS } from './presets';
import type { CaptionWord } from './types';

const w = (t0: number, text: string, d = 0.4): CaptionWord => ({ t0, t1: t0 + d, text });

describe('captionCursor: the word the playhead stands on (the owner, 2026-11-13)', () => {
  // Two lines of three words; a pause of 2 s between them starts the second line.
  const c = { wordsPerPage: 3, words: [w(1, 'раз'), w(1.5, 'два'), w(2, 'три'), w(5, 'четыре'), w(5.5, 'пять')] };

  it('is the word being said', () => {
    expect(captionCursor(c, 1.6)).toEqual({ page: 0, word: 1, index: 1 });
    expect(captionCursor(c, 5.6)).toEqual({ page: 1, word: 1, index: 4 });
  });
  it('between words and in a pause is the word said last', () => {
    expect(captionCursor(c, 1.45)).toEqual({ page: 0, word: 0, index: 0 });
    expect(captionCursor(c, 3.5)).toEqual({ page: 0, word: 2, index: 2 });
  });
  it('before the first word is the first word, after the last one the last', () => {
    expect(captionCursor(c, 0)).toEqual({ page: 0, word: 0, index: 0 });
    expect(captionCursor(c, -3)).toEqual({ page: 0, word: 0, index: 0 });
    expect(captionCursor(c, 99)).toEqual({ page: 1, word: 1, index: 4 });
  });
  it('is on the very moment a word starts', () => {
    expect(captionCursor(c, 2)).toEqual({ page: 0, word: 2, index: 2 });
    expect(captionCursor(c, 5)).toEqual({ page: 1, word: 0, index: 3 });
  });
  it('has nowhere to stand in a caption without words', () => {
    expect(captionCursor({ wordsPerPage: 3, words: [] }, 1)).toBeNull();
  });
  it('counts one word a line', () => {
    expect(captionCursor({ ...c, wordsPerPage: 1 }, 5.6)).toEqual({ page: 4, word: 0, index: 4 });
  });
});

describe('captions for parts of the video (the owner, 2026-11-13)', () => {
  it('puts ranges in order, joins the ones that touch and keeps them inside the video', () => {
    expect(normalizeRanges([[8, 12], [-2, 3], [2.5, 5], [11, 40]], 20)).toEqual([[0, 5], [8, 20]]);
  });
  it('takes a range given backwards, drops an empty one and one that is not a number', () => {
    expect(normalizeRanges([[6, 4], [7, 7.01], [NaN, 3], [30, 40]], 20)).toEqual([[4, 6]]);
  });
  it('counts the seconds asked for', () => {
    expect(rangesSeconds([[0, 5], [8, 20]])).toBe(17);
  });
  it('cuts speech to the ranges', () => {
    expect(clipToRanges([[1, 6], [7, 9], [15, 16]], [[0, 5], [8, 20]])).toEqual([[1, 5], [8, 9], [15, 16]]);
    expect(clipToRanges([[1, 6]], [])).toEqual([]);
  });
  it('replaces the words inside the ranges and keeps the corrected ones outside', () => {
    const old = [w(1, 'Привет'), w(6, 'стараа'), w(12, 'конец')];
    const fresh = [w(6, 'старая'), w(6.5, 'песня'), w(13, 'не-отсюда')];
    expect(mergeCaptionWords(old, fresh, [[5, 8]]).map((x) => x.text)).toEqual(['Привет', 'старая', 'песня', 'конец']);
  });
  it('clears a range where no speech was found', () => {
    expect(mergeCaptionWords([w(1, 'а'), w(6, 'б')], [], [[5, 8]]).map((x) => x.text)).toEqual(['а']);
  });
  it('reads a clip’s shown words in timeline time and writes them back', () => {
    const c = createCaptionClip([w(10, 'раз'), w(11, 'два'), w(14, 'три')], CAPTION_PRESETS[0]);
    c.duration = 3; // trimmed: «три» is not shown
    expect(clipWordsOnTimeline(c).map((x) => [x.t0, x.text])).toEqual([[10, 'раз'], [11, 'два']]);
    setClipWords(c, [w(4, 'ноль'), w(10, 'раз')]);
    expect(c.start).toBe(4);
    expect(c.words.map((x) => x.t0)).toEqual([0, 6]);
    expect(c.duration).toBeCloseTo(6.9);
  });
});
