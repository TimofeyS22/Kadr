import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CAPTION_PRESETS, TEXT_PRESETS } from '../core/presets';
import { FONT_IDS } from '../core/types';
import { FONTS, fontWeight } from './text';

it('every font id has a face, weights and Latin + Cyrillic files imported', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'fonts.ts'), 'utf8');
  expect(Object.keys(FONTS).sort()).toEqual([...FONT_IDS].sort());
  expect(FONT_IDS.length).toBeGreaterThanOrEqual(23);
  for (const id of FONT_IDS) {
    const family = /^"([^"]+)"/.exec(FONTS[id].family)![1];
    const pkg = family.toLowerCase().replace(/ /g, '-').replace('bebas-neue', 'bebas-neue');
    for (const w of FONTS[id].weights) {
      expect(css, `${id} ${w} latin`).toContain(`/latin-${w}.css`);
      // Anton and Bebas have no Cyrillic; they borrow it from Oswald (listed next in the family).
      if (id === 'anton' || id === 'bebas') expect(FONTS[id].family).toContain('"Oswald"');
      else expect(css, `${pkg} ${w} cyrillic`).toMatch(new RegExp(`@fontsource/[a-z0-9-]+/cyrillic-${w}\\.css`));
    }
  }
});

it('picks the nearest real weight, so bold is never faked', () => {
  expect(fontWeight('lobster', 900)).toBe(400);
  expect(fontWeight('oswald', 900)).toBe(700);
  expect(fontWeight('inter', 700)).toBe(700);
  expect(fontWeight('caveat', 900)).toBe(700);
});

it('every preset uses a bundled font', () => {
  for (const p of [...TEXT_PRESETS, ...CAPTION_PRESETS]) expect(FONT_IDS).toContain(p.style.font);
});
