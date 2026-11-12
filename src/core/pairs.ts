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

/** Which letters a pair is set in on a frame (docs/18 Ш6): light ones for a dark picture, dark ones for a light one. */
export type PairVariant = 'light' | 'dark';
export const PAIR_VARIANTS: Record<PairVariant, Pick<TextStyle, 'color' | 'shadow' | 'shadowColor'>> = {
  light: { color: '#ffffff', shadow: true },
  dark: { color: '#141414', shadow: true, shadowColor: '#ffffff' },
};

/** WCAG relative luminance of a `#rrggbb` colour. */
export function luminance(hex: string): number {
  const n = parseInt(hex.slice(1, 7), 16);
  const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}
const contrast = (a: number, b: number) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/**
 * The variant for a picture whose band under the text has mean luminance `mean` and spread `spread` (its standard
 * deviation): the one that stands out more from the mean. `plate`: neither stands out enough, or the picture is too busy
 * for bare letters, so a box under the text is offered (one tap, never put on by itself). The thresholds are an ОЦЕНКА:
 * bare letters of these faces fail the ?styles busy mosaic in both variants, and the sample's sunrise, whose sun band
 * (spread 0.225) swallows a pair's support, must get the offer; a calm sky or a wall (spread ~0.02–0.05) must not.
 */
export function pickVariant(tone: { mean: number; spread: number } | null): { variant: PairVariant; plate: boolean } {
  if (!tone) return { variant: 'light', plate: false };
  const light = contrast(luminance(PAIR_VARIANTS.light.color), tone.mean), dark = contrast(luminance(PAIR_VARIANTS.dark.color), tone.mean);
  return { variant: dark > light ? 'dark' : 'light', plate: Math.max(light, dark) < 4.5 || tone.spread > 0.15 };
}

/** The box offered under a pair the picture would swallow: the opposite of its letters, half seen through. */
export function pairPlate(variant: PairVariant): NonNullable<TextStyle['background']> {
  return { color: variant === 'light' ? '#000000' : '#ffffff', opacity: 0.7, padding: 0.45, radius: 0.35 };
}

/**
 * The text style of `pair` over `current`: its faces and looks, its letters in `variant`; the size, alignment and box
 * stay the person's.
 */
export function pairStyle(pair: FontPair, current: TextStyle, variant: PairVariant = 'light'): TextStyle {
  const s: TextStyle = { ...current, ...PAIR_VARIANTS[variant], font: pair.base.font, weight: pair.base.weight, italic: false, lines: [{ ...pair.accent }, { ...pair.support }] };
  if (!PAIR_VARIANTS[variant].shadowColor) delete s.shadowColor;
  delete s.uppercase;
  delete s.letterSpacing;
  delete s.gradient;
  delete s.copies;
  return s;
}

/**
 * The catalog of the first release (docs/18 Ф3): round 2 of the independent art director, drawn by the renderer, blind,
 * two weak controls mixed in (both scored 4 of 10, so the scores count). Every pair here scored 8 or 9 of 10. «Праздник»
 * is round 3 (2026-11-12): six candidates and two controls (4 and 3), the only one at 8 of 10, with the director's tweak
 * (capitals 10% smaller, 0.06 more spacing); it keeps the name readable both over and under the accent. «Джаз» and
 * «Воздух» feel alike and never stand side by side, nor do «Праздник» and «Влог» (both in Caveat). Ids are for ever.
 */
export const PAIRS: FontPair[] = [
  {
    id: 'tender', name: { ru: 'Нежно', en: 'Tender' }, sample: { ru: 'Нежность\nутро в Питере', en: 'Tenderness\nmorning in Paris' },
    base: { font: 'ysabeau', weight: 400 }, split: 'first',
    accent: { font: 'greatVibes', scale: 2.3 }, support: { font: 'ysabeau', scale: 0.5, uppercase: true, letterSpacing: 0.25, gap: -0.15 },
  },
  {
    id: 'party', name: { ru: 'Праздник', en: 'Party' }, sample: { ru: 'Аня\nс днём рождения', en: 'Anna\nhappy birthday' },
    base: { font: 'unbounded', weight: 700 }, split: 'first',
    accent: { font: 'caveat', weight: 700, scale: 2 }, support: { font: 'unbounded', weight: 700, scale: 0.4, uppercase: true, letterSpacing: 0.16 },
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
