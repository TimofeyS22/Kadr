// @ts-expect-error a plain ES module script, no types
import { KEEP, KEEP_MS, retain, rollbackGenerations } from './keep-assets.mjs';
import { describe, expect, it } from 'vitest';

const DAY = 864e5;
const now = Date.parse('2026-11-01T00:00:00Z');
/** Generation `i` deployed `ago` days before now, with its own file. */
const gen = (i: number, ago: number, files = [`chunk-${i}.js`]) => ({ version: `v${i}`, at: new Date(now - ago * DAY).toISOString(), files });

describe('keep-assets retain', () => {
  it('keeps the last five generations however old', () => {
    const gens = Array.from({ length: 8 }, (_, i) => gen(i, 100 + i * 50));
    expect(retain(gens, now).map((g: { version: string }) => g.version)).toEqual(['v0', 'v1', 'v2', 'v3', 'v4']);
    expect(KEEP).toBe(5);
  });

  it('keeps older generations while they were replaced less than 30 days ago (several deploys a day)', () => {
    const gens = Array.from({ length: 20 }, (_, i) => gen(i, i * 2)); // a deploy every 2 days
    const kept = retain(gens, now);
    expect(kept).toHaveLength(16); // v15 was replaced by v14, 28 days ago; v16 by v15, 30 days ago
    expect(now - Date.parse(kept[kept.length - 2].at)).toBeLessThan(KEEP_MS);
  });

  it('drops a generation the newer one has all the files of (a redeploy of the same code)', () => {
    const gens = [gen(0, 0, ['a.js', 'b.js']), gen(1, 1, ['a.js', 'b.js']), gen(2, 2, ['a.js', 'c.js'])];
    expect(retain(gens, now).map((g: { version: string }) => g.version)).toEqual(['v0', 'v2']);
  });

  it('reads the first, crawled generation (file names only) like the others', () => {
    const gens = [gen(0, 0, [{ name: 'a.js', size: 1, sha256: 'x' }] as never), gen(1, 1, ['a.js'])];
    expect(retain(gens, now)).toHaveLength(1);
  });
});

describe('keep-assets after a rollback', () => {
  // The earlier site (1.8.3's) kept 1.8.2's and 1.8.1's files besides its own; the live site is the rolled-back 1.8.2.
  const own = gen(3, 1, ['a3.js', 'b3.js']), g2 = gen(2, 2, ['a2.js']), g1 = gen(1, 3, ['a1.js']);
  const earlier = { generations: [own, g2, g1] };
  const live = [gen(2, 0, ['a2.js']), own, g2, g1];
  const versions = (gens: { version: string }[]) => gens.map((g) => g.version);

  it('the site that goes back up is its own build, and the history stays (rehearsal of 2026-11-11)', () => {
    const back = rollbackGenerations(earlier, live);
    expect(back.own.files).toEqual(['a3.js', 'b3.js']);
    expect(versions(retain([back.own, ...back.previous], now))).toEqual(['v3', 'v2', 'v1']);
  });

  it('every file of the folder taken as its own folds the history into one generation (the rehearsal)', () => {
    const everything = gen(3, 0, ['a1.js', 'a2.js', 'a3.js', 'b3.js']);
    expect(versions(retain([everything, ...live], now))).toEqual(['v3']);
  });

  it('a generation only the earlier site still listed is kept too', () => {
    const back = rollbackGenerations(earlier, [gen(2, 0, ['a2.js'])]);
    expect(versions(back.previous)).toEqual(['v2', 'v1']);
  });
});
