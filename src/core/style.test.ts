// The looks of paragraphs from a file (docs/18 ADR-П1, docs/11 §3.15): kept in ranges before a canvas is sized by them.
import { expect, it } from 'vitest';
import { saneStyle } from './style';
import type { LineLook, TextStyle } from './types';

const base: TextStyle = { font: 'inter', size: 0.06, weight: 700, italic: false, color: '#ffffff', align: 'center', stroke: null, background: null, shadow: true };

it('keeps a pair as it is made', () => {
  const lines: LineLook[] = [{ font: 'lobster', scale: 2.2, gap: -0.3 }, { font: 'montserrat', uppercase: true, letterSpacing: 0.25, scale: 0.55 }];
  expect(saneStyle({ ...base, lines }).lines).toEqual(lines);
});

it('cuts the looks of a file to four, in sane ranges', () => {
  const evil = { ...base, lines: [{ scale: 1e4, gap: -50, dx: 9, letterSpacing: 99 }, null, 'x', ...Array(9).fill({ scale: 1 })] } as unknown as TextStyle;
  const s = saneStyle(evil);
  expect(s.lines!.length).toBeLessThanOrEqual(4);
  expect(s.lines![0]).toEqual({ scale: 3, gap: -0.8, dx: 0.5, letterSpacing: 2 });
});

it('drops looks that are not a list or are all broken', () => {
  expect(saneStyle({ ...base, lines: 'x' } as unknown as TextStyle).lines).toBeUndefined();
  expect(saneStyle({ ...base, lines: [null, 3] } as unknown as TextStyle).lines).toBeUndefined();
  expect(saneStyle(base).lines).toBeUndefined();
});
