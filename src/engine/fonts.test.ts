import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { CAPTION_PRESETS, TEXT_PRESETS } from '../core/presets';
import { FONT_IDS } from '../core/types';
import { FONTS, fontOf, fontWeight } from './text';

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

// docs/18 Ф1: a style that sets italic gets the italic its font's author drew, not a slant the browser makes up. Russo One,
// Unbounded and Days One have no italic at all; on them the slant is the style's own look.
const NO_ITALIC_DRAWN = ['russo', 'unbounded', 'days'];
it('every italic style draws a real italic where the font has one', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'fonts.ts'), 'utf8');
  for (const p of [...TEXT_PRESETS, ...CAPTION_PRESETS].filter((x) => x.style.italic && !NO_ITALIC_DRAWN.includes(x.style.font))) {
    const w = fontWeight(p.style.font, p.style.weight);
    const pkg = /^"([^"]+)"/.exec(fontOf(p.style.font).family)![1].toLowerCase().replace(/ /g, '-');
    for (const sub of ['latin', 'cyrillic']) expect(css, `${p.id}: ${pkg} ${w} ${sub} italic`).toContain(`'@fontsource/${pkg}/${sub}-${w}-italic.css'`);
  }
});

it('every preset uses a bundled font', () => {
  for (const p of [...TEXT_PRESETS, ...CAPTION_PRESETS]) expect(FONT_IDS).toContain(p.style.font);
});
