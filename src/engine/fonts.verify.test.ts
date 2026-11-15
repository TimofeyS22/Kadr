// Verifier E3 (docs/21 §5), D-18: "any text in italic on Playfair Display, Lora or Cormorant Garamond drew a slant the
// browser made up". fonts.test.ts checks the italic of each preset's weight; a person's own text can be italic at any
// weight of these faces, and without the 400 italic the browser slanted the upright again (the control: red here, green
// in fonts.test.ts). Every weight Kadr offers on these three has its drawn italic, Latin and Cyrillic.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { FONTS } from './text';

const DRAWN_ITALIC = { playfair: 'playfair-display', lora: 'lora', cormorant: 'cormorant-garamond' } as const;

it('every weight of the serif faces with a drawn italic brings that italic, Latin and Cyrillic (D-18)', () => {
  const css = readFileSync(join(import.meta.dirname, '..', 'fonts.ts'), 'utf8');
  for (const [id, pkg] of Object.entries(DRAWN_ITALIC)) {
    const weights = FONTS[id as keyof typeof DRAWN_ITALIC].weights;
    expect(weights.length, id).toBeGreaterThan(0);
    for (const w of weights) for (const sub of ['latin', 'cyrillic']) expect(css, `${pkg} ${w} ${sub} italic`).toContain(`'@fontsource/${pkg}/${sub}-${w}-italic.css'`);
  }
});
