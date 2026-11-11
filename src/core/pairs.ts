// Font pairs (docs/18): a text set in two faces, an accent over a support, as data. A pair becomes a text style with
// looks of paragraphs (TextStyle.lines); the renderer draws it like any style, so the tile, the preview and the file agree.
import type { LineLook, TextStyle } from './types';

/** How a one-line text is broken in two when a pair is put on it (docs/18 ADR-П6). */
export type PairSplit = 'first' | 'half' | 'none';

export interface FontPair {
  /** For ever: projects keep the style, this id names the pair in the catalog only. */
  id: string;
  /** The name under its tile, one or two words. */
  name: { ru: string; en: string };
  /** The text a tile shows when the person has written nothing yet. */
  sample: { ru: string; en: string };
  /** The base style is the support's face: a version that does not know `lines` draws the whole text in it. */
  base: Pick<TextStyle, 'font' | 'weight'>;
  accent: LineLook;
  support: LineLook;
  split: PairSplit;
}

/** Words that never end a line in Russian: they belong with the word after them. */
const CLINGS = new Set(['в', 'во', 'и', 'с', 'со', 'к', 'ко', 'у', 'о', 'об', 'а', 'но', 'на', 'по', 'за', 'из', 'от', 'до', 'не', 'ни', 'для', 'при', 'без', 'под', 'над', 'про', 'же', 'ли', 'бы']);
/** A unit or sign that never starts a line: it belongs with the number before it. */
const UNIT = /^(₽|руб\.?|р\.?|%|°|\$|€|шт\.?|кг|г|км|м|см|мин|ч|сек|лет|года?|мая|января|февраля|марта|апреля|июня|июля|августа|сентября|октября|ноября|декабря)$/i;

/** Where a line may break: after word `i` (0-based), not before a unit after a number, not after a clinging word. */
function canBreakAfter(words: string[], i: number): boolean {
  const here = words[i], next = words[i + 1];
  if (!next) return false;
  if (CLINGS.has(here.toLocaleLowerCase('ru'))) return false;
  if (/\d/.test(here) && UNIT.test(next)) return false;
  return true;
}

/**
 * Breaks a one-line text in two for a pair: `first` puts the first word (with what clings to it) in the accent, `half`
 * splits where the two halves are closest in length. A text with a line break already, of one word, or a pair that
 * does not split is kept as written.
 */
export function splitForPair(text: string, split: PairSplit): string {
  if (split === 'none' || text.includes('\n')) return text;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length < 2) return text;
  const breaks = words.map((_, i) => i).filter((i) => canBreakAfter(words, i));
  if (!breaks.length) return text;
  let at = breaks[0];
  if (split === 'half') {
    const total = words.join(' ').length;
    at = breaks.reduce((best, i) => {
      const left = words.slice(0, i + 1).join(' ').length;
      const bestLeft = words.slice(0, best + 1).join(' ').length;
      return Math.abs(total / 2 - left) < Math.abs(total / 2 - bestLeft) ? i : best;
    }, at);
  }
  return `${words.slice(0, at + 1).join(' ')}\n${words.slice(at + 1).join(' ')}`;
}

/** The text style of `pair` over `current`: its faces and looks; the size, colour, shadow and box stay the person's. */
export function pairStyle(pair: FontPair, current: TextStyle): TextStyle {
  const s: TextStyle = { ...current, font: pair.base.font, weight: pair.base.weight, italic: false, lines: [{ ...pair.accent }, { ...pair.support }] };
  delete s.uppercase;
  delete s.letterSpacing;
  return s;
}

/**
 * The catalog of the first release (docs/18 Ф3): round 2 of the independent art director, drawn by the renderer, blind,
 * two weak controls mixed in (both scored 4 of 10, so the scores count). Every pair here scored 8 or 9 of 10. «Джаз» and
 * «Воздух» feel alike and never stand side by side. Ids are for ever.
 */
export const PAIRS: FontPair[] = [
  {
    id: 'tender', name: { ru: 'Нежно', en: 'Tender' }, sample: { ru: 'Нежность\nутро в Питере', en: 'Tenderness\nmorning in Paris' },
    base: { font: 'ysabeau', weight: 400 }, split: 'first',
    accent: { font: 'greatVibes', scale: 2.3 }, support: { font: 'ysabeau', scale: 0.5, uppercase: true, letterSpacing: 0.25, gap: -0.15 },
  },
  {
    id: 'cover', name: { ru: 'Обложка', en: 'Cover' }, sample: { ru: 'Осень\nвыпуск № 3', en: 'Autumn\nissue no. 3' },
    base: { font: 'inter', weight: 700 }, split: 'first',
    accent: { font: 'notoSerif', italic: true, weight: 700, scale: 2.2 }, support: { font: 'inter', weight: 700, scale: 0.42, uppercase: true, letterSpacing: 0.15 },
  },
  {
    id: 'runway', name: { ru: 'Подиум', en: 'Runway' }, sample: { ru: 'Шампань\nколлекция осень', en: 'Champagne\nautumn collection' },
    base: { font: 'tenor', weight: 400 }, split: 'first',
    accent: { font: 'oranienbaum', scale: 1.8, uppercase: true }, support: { font: 'tenor', scale: 0.48, uppercase: true, letterSpacing: 0.3 },
  },
  {
    id: 'film', name: { ru: 'Плёнка', en: 'Film' }, sample: { ru: 'Плёнка\n11.11.26 · Питер', en: 'Film\n11.11.26 · Paris' },
    base: { font: 'plexMono', weight: 400 }, split: 'first',
    accent: { font: 'cormorant', italic: true, weight: 400, scale: 2.2 }, support: { font: 'plexMono', scale: 0.45, uppercase: true, letterSpacing: 0.2 },
  },
  {
    id: 'vlog', name: { ru: 'Влог', en: 'Vlog' }, sample: { ru: 'Мой день\nпросто записываю', en: 'My day\njust writing it down' },
    base: { font: 'plexMono', weight: 400 }, split: 'half',
    accent: { font: 'caveat', weight: 700, scale: 2.1 }, support: { font: 'plexMono', scale: 0.45, uppercase: true, letterSpacing: 0.15 },
  },
  {
    id: 'jazz', name: { ru: 'Джаз', en: 'Jazz' }, sample: { ru: 'Гэтсби\nвечеринка 1925', en: 'Gatsby\nparty 1925' },
    base: { font: 'forum', weight: 400 }, split: 'first',
    accent: { font: 'poiret', scale: 1.9, uppercase: true, letterSpacing: 0.1 }, support: { font: 'forum', scale: 0.55, uppercase: true, letterSpacing: 0.3 },
  },
  {
    id: 'bold', name: { ru: 'Дерзко', en: 'Bold' }, sample: { ru: 'Вайб\nвключён на 100%', en: 'Vibe\nturned up to 100%' },
    base: { font: 'notoSerif', weight: 400 }, split: 'first',
    accent: { font: 'dela', scale: 1.9, uppercase: true }, support: { font: 'notoSerif', italic: true, scale: 0.65 },
  },
  {
    id: 'air', name: { ru: 'Воздух', en: 'Air' }, sample: { ru: 'Тишина\nзаметки дня', en: 'Silence\nnotes of the day' },
    base: { font: 'plexMono', weight: 400 }, split: 'first',
    accent: { font: 'montserrat', weight: 400, scale: 1.3, uppercase: true, letterSpacing: 0.3 }, support: { font: 'plexMono', scale: 0.5 },
  },
];
