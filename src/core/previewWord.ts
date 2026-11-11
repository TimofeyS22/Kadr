// The word a font or style tile is drawn on (docs/18; the owner, 2026-11-11: font previews were the same «Ёж» on grey).
// A face is judged on the person's own text, in their language, so the tile also shows whether the face has its letters.
// A sample word stands in only when there is nothing of theirs to show.

const LETTER = /\p{L}/u;
const EDGE = /^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu;
/** Text a new text piece starts with: a placeholder, not the person's words. */
export const PLACEHOLDERS = ['Your text', 'Ваш текст'];
const MAX = 10;

const graphemes = (s: string): string[] => (typeof Intl.Segmenter === 'function'
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(s), (x) => x.segment) : Array.from(s));

/**
 * The first word of at least three letters among the first three words, as written (no emoji or signs round it). Short
 * words only («Я и ты»): the whole text up to ten letters. Nothing but signs, emoji or the placeholder: `fallback`.
 */
export function previewWord(text: string, fallback: string): string {
  if (PLACEHOLDERS.includes(text.trim())) return fallback;
  const words = text.split(/\s+/).map((w) => w.replace(EDGE, '')).filter((w) => LETTER.test(w));
  if (!words.length) return fallback;
  const word = words.slice(0, 3).find((w) => graphemes(w).filter((g) => LETTER.test(g)).length >= 3);
  if (word) return graphemes(word).slice(0, MAX).join('');
  const short = words.join(' ').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  return graphemes(short).slice(0, MAX).join('').trim() || fallback;
}
