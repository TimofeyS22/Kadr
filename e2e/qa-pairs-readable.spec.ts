// A font pair reads on any picture (docs/18 Ш6), in Russian and in English, by the edge contrast of the ?styles measure
// (3 or more): on white, black and grey one of its two variants does it bare; on a busy mosaic bare letters of these
// faces never do (measured 1.6–3.0 in both variants, a dark halo only 2.2), so there the box offered for a busy picture
// (core/pairs.ts pickVariant: a spread over 0.15) must. Which variant a frame gets is pickVariant's unit test.
import { expect, test } from '@playwright/test';
import { PAIRS } from '../src/core/pairs';
import type { StylesReport } from '../src/ui/StylesCheck';

const GROUNDS = ['white', 'black', 'grey', 'busy'] as const;

test('every pair reads on white, black, grey and a busy picture in one of its two variants', async ({ page }) => {
  test.setTimeout(400_000);
  await page.goto('./?styles=pairs');
  await page.waitForFunction(() => (window as unknown as { __kadrStyles?: StylesReport }).__kadrStyles?.done, null, { timeout: 380_000, polling: 1000 });
  const r = await page.evaluate(() => (window as unknown as { __kadrStyles: StylesReport }).__kadrStyles);
  const rows = r.rows.filter((x) => x.kind === 'pair');
  expect(rows.length).toBe(PAIRS.length * 3 * 2);
  const bad: string[] = [];
  for (const p of PAIRS) for (const lang of ['ru', 'en'] as const) {
    const of = (v: string) => rows.find((x) => x.id === `${p.id}:${v}` && x.lang === lang)!.edge;
    const light = of('light'), dark = of('dark'), plate = of('plate');
    console.log(`${p.id} ${lang}: ${GROUNDS.map((g) => `${g} ${light[g]}/${dark[g]}/${plate[g]}`).join(', ')}`);
    for (const g of GROUNDS) {
      const best = g === 'busy' ? plate[g] : Math.max(light[g], dark[g]);
      if (best < 3) bad.push(`${p.id} ${lang} ${g}: light ${light[g]}, dark ${dark[g]}, on the box ${plate[g]}`);
    }
  }
  expect(bad).toEqual([]);
});
