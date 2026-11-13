// The demo a caption template plays on its tile (ui/tiles.ts), as pure timing so it can be checked without a canvas.
//
// The owner, 2026-11-13: «после показа все пропадают, оставив чёрный фон, потом появляются». The demo line lived
// from 0.3 s to 2.25 s of a 2.4 s loop, and every tile runs on one clock: for 0.45 s of each loop the whole strip was
// black. Now a tile is never empty: the words are said from the loop's first moment, then the settled line stays
// until the loop starts again, and neighbouring tiles start their loops apart, so the strip never blinks as one
// (docs/20 ADR-С4).
import type { CaptionWord } from './types';

/** A demo word takes this long, and the next one starts `DEMO_WORD_GAP_S` after it. */
const DEMO_WORD_S = 0.45, DEMO_WORD_GAP_S = 0.05;
/**
 * A line or a word comes in from nothing (`motionAt` at 0 is fully clear): the loop starts 50 ms in, where every
 * motion already shows (opacity above 0.1, checked by the test over every template).
 */
const DEMO_FIRST_S = 0.05;
/** How long after its last word a line stays on the video (`captionAt`): the demo holds just before that. */
const LINE_STAYS_S = 0.5;

/** The demo phrase as caption words, the first one starting at 0. */
export function demoCaptionWords(texts: readonly string[]): CaptionWord[] {
  return texts.map((text, i) => ({ t0: i * (DEMO_WORD_S + DEMO_WORD_GAP_S), t1: i * (DEMO_WORD_S + DEMO_WORD_GAP_S) + DEMO_WORD_S, text }));
}

/** The moment of the demo a tile shows at loop time `time`: the words being said, then the whole line, held. */
export function demoCaptionTime(time: number, words: readonly CaptionWord[]): number {
  const hold = (words.at(-1)?.t1 ?? 0) + LINE_STAYS_S - DEMO_FIRST_S;
  return Math.min(Math.max(time, DEMO_FIRST_S), hold);
}

/** The moments at which the demo line is settled, one per word and the held one: the tile is sized for the largest. */
export function demoSettledTimes(words: readonly CaptionWord[]): number[] {
  return [...words.map((w) => w.t1 - 0.01), demoCaptionTime(Infinity, words)];
}

/** Neighbouring tiles start their loops a third of a loop apart: `index` is the tile's place in the strip. */
export const demoPhase = (index: number, loop: number): number => ((index % 3) * loop) / 3;
