// @ts-expect-error a plain ES module script, no types
import { KEEP, KEEP_MS, retain } from './keep-assets.mjs';
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
