import { expect, it } from 'vitest';
import { PAIRS, pairStyle, splitForPair, type FontPair } from './pairs';
import { saneStyle } from './style';
import { FONT_IDS } from './types';
import type { TextStyle } from './types';

it('puts the first word in the accent, with the words that cling to it (docs/18 ADR-П6)', () => {
  expect(splitForPair('Лето в городе', 'first')).toBe('Лето\nв городе');
  expect(splitForPair('В Питере летом', 'first')).toBe('В Питере\nлетом');
  expect(splitForPair('Мой день', 'first')).toBe('Мой\nдень');
  expect(splitForPair('И снова лето', 'first')).toBe('И снова\nлето');
});

it('never parts a number from its unit', () => {
  expect(splitForPair('990 ₽ за всё', 'first')).toBe('990 ₽\nза всё');
  expect(splitForPair('30 % скидка', 'first')).toBe('30 %\nскидка');
  expect(splitForPair('15 мая', 'first')).toBe('15 мая');
});

it('splits in the middle where the halves are closest', () => {
  expect(splitForPair('С днём рождения, Аня', 'half')).toBe('С днём\nрождения, Аня');
  expect(splitForPair('Самое лучшее лето в моей жизни', 'half')).toBe('Самое лучшее лето\nв моей жизни');
});

it('keeps what the person wrote when there is nothing to split', () => {
  expect(splitForPair('Лето\nв городе', 'first')).toBe('Лето\nв городе');
  expect(splitForPair('Лето', 'first')).toBe('Лето');
  expect(splitForPair('Лето в городе', 'none')).toBe('Лето в городе');
  expect(splitForPair('в', 'first')).toBe('в');
});

it('a pair over a style keeps the person\'s size, colour and shadow, and sets the support as the base face', () => {
  const pair: FontPair = {
    id: 't', name: { ru: 'Т', en: 'T' }, sample: { ru: 'а\nб', en: 'a\nb' }, base: { font: 'tenor', weight: 400 }, split: 'first',
    accent: { font: 'greatVibes', scale: 2.2 }, support: { font: 'tenor', scale: 0.5, uppercase: true, letterSpacing: 0.25 },
  };
  const current: TextStyle = { font: 'inter', size: 0.08, weight: 900, italic: true, color: '#ffd60a', align: 'left', stroke: null, background: null, shadow: true, uppercase: true, letterSpacing: 0.3 };
  const s = pairStyle(pair, current);
  expect(s).toMatchObject({ font: 'tenor', weight: 400, italic: false, size: 0.08, color: '#ffd60a', shadow: true, align: 'left' });
  expect(s.uppercase).toBeUndefined();
  expect(s.letterSpacing).toBeUndefined();
  expect(s.lines).toEqual([pair.accent, pair.support]);
  expect(s.lines![0]).not.toBe(pair.accent); // a copy: editing the text never edits the catalog
});

it('the catalog: fonts bundled and whole in Russian, the base is the support, sizes in range, two-line samples, ids once', () => {
  const ids = new Set<string>();
  // Faces whose own Russian has holes (src/engine/fontFiles.test.ts) never go into a pair.
  const holes = ['anton', 'bebas', 'jost', 'neucha'];
  for (const p of PAIRS) {
    expect(ids.has(p.id), p.id).toBe(false);
    ids.add(p.id);
    for (const f of [p.base.font, p.accent.font, p.support.font]) {
      expect(FONT_IDS, `${p.id}: ${f}`).toContain(f);
      expect(holes, `${p.id}: ${f}`).not.toContain(f);
    }
    expect(p.support.font, `${p.id}: an old version draws the whole text in the support's face`).toBe(p.base.font);
    const style = pairStyle(p, { font: 'inter', size: 0.055, weight: 700, italic: false, color: '#ffffff', align: 'center', stroke: null, background: null, shadow: true });
    expect(saneStyle(style).lines, `${p.id}: within the ranges a file is held to`).toEqual(style.lines);
    expect(p.accent.scale!).toBeGreaterThan(p.support.scale!);
    expect(p.sample.ru.split('\n')).toHaveLength(2);
    expect(p.sample.en.split('\n')).toHaveLength(2);
    expect(p.name.ru.length, p.id).toBeLessThanOrEqual(12);
  }
  expect(PAIRS.length).toBeGreaterThanOrEqual(8);
});
