// The text sheet over a text set in several faces (docs/18 ADR-П7): «Весь текст · Строка 1 · Строка 2». Every control of
// the sheet follows the chosen part, so none of them is silent (Ж5): on one line its own fields go to that line's look
// and the rest to the block; on the whole text a field a line set for itself is cleared, so the edit reaches every line.
import type { LineLook, TextStyle } from './types';

export type LineChoice = 'all' | number;

/** What a line may set for itself from the sheet; outline, shadow, box, gradient and line spacing stay the block's. */
const OWN = ['italic', 'uppercase', 'color', 'letterSpacing', 'align'] as const;
type Own = (typeof OWN)[number];
const own = (k: string): k is Own => (OWN as readonly string[]).includes(k);
type Loose = Record<string, unknown>;

const lookOf = (s: TextStyle, choice: LineChoice): LineLook | undefined => (choice === 'all' ? undefined : s.lines?.[choice]);

/** The style as the chosen part shows it: a line's own fields over the block's. */
export function lineView(s: TextStyle, choice: LineChoice): TextStyle {
  const look = lookOf(s, choice);
  if (!look) return s;
  const v: Loose = { ...s };
  for (const k of [...OWN, 'font', 'weight'] as const) if (look[k] !== undefined) v[k] = look[k];
  return v as unknown as TextStyle;
}

/** Runs an edit of the sheet's controls (written against a whole style) on `s` as `choice` sees it. */
export function editLine(s: TextStyle, choice: LineChoice, fn: (v: TextStyle) => void): void {
  const look = lookOf(s, choice) as Loose | undefined;
  // A JSON copy, not structuredClone: in the store `s` is an immer draft, and a draft (a Proxy) cannot be cloned.
  const copy = (o: unknown): Loose => JSON.parse(JSON.stringify(o)) as Loose;
  const view = copy(lineView(s, choice)), before = copy(view);
  fn(view as unknown as TextStyle);
  const block = s as unknown as Loose;
  for (const k of new Set([...Object.keys(before), ...Object.keys(view)])) {
    if (k === 'lines' || k === 'font' || k === 'weight' || JSON.stringify(before[k]) === JSON.stringify(view[k])) continue;
    const target = look && own(k) ? look : block;
    if (view[k] === undefined) delete target[k]; else target[k] = view[k];
    if (!look && own(k)) for (const l of s.lines ?? []) delete (l as Loose)[k];
  }
}

/** The size the slider shows: a line's own (its share of the block's size), or the block's. */
export function lineSize(s: TextStyle, choice: LineChoice): number {
  const look = lookOf(s, choice);
  return look ? s.size * (look.scale ?? 1) : s.size;
}

/** Sets the size of the chosen part: a line's share of the block (0.3–3, as a file is held to), or the block's size. */
export function setLineSize(s: TextStyle, choice: LineChoice, size: number): void {
  const look = lookOf(s, choice);
  if (look) look.scale = Math.min(3, Math.max(0.3, size / s.size));
  else s.size = size;
}

/** «Поменять местами» (docs/18 ADR-П7) is offered on a text of two lines set in two faces. */
export function canSwap(text: string, s: TextStyle): boolean {
  return s.lines?.length === 2 && text.split('\n').length === 2;
}

/**
 * The two lines trade places, each with its words and its whole look, the gap under it included: the small line goes
 * over the accent like the overline of a magazine, and a second tap gives back the first. Returns the new text.
 */
export function swapLines(text: string, s: TextStyle): string {
  if (!canSwap(text, s)) return text;
  const [a, b] = text.split('\n');
  s.lines!.reverse();
  return `${b}\n${a}`;
}
