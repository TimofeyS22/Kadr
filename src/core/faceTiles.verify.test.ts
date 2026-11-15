// Verifier E3 (docs/21 §5), audit V-163: "the ninth face is not hidden; with six hand-drawn areas only two faces are".
// audit.test.ts proves fitRects keeps every rectangle inside eight; the defect itself was the call in the compositor,
// which cut the list at eight (`.slice(0, 8)`): putting that back leaves audit.test.ts green. The shader's eight slots
// get the hand-drawn areas and the faces together, through fitRects, never a cut list.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('the compositor hides areas and faces together through fitRects, never a list cut at eight (audit V-163)', () => {
  const src = readFileSync(join(import.meta.dirname, '..', 'engine', 'compositor.ts'), 'utf8');
  const call = /const rects = pv \? fitRects\(\[\s*\.\.\.pv\.areas,\s*\.\.\.\(d\?\.faces \?\? \[\]\)[\s\S]*?\], 8\) : \[\];/.exec(src);
  expect(call, 'areas and faces go through fitRects(…, 8)').not.toBeNull();
  expect(src, 'no list of hidden rectangles is cut').not.toMatch(/\]\.slice\(0, 8\)/);
  expect(src).toMatch(/gl\.uniform1i\(this\.loc\('uPrivN'\), rects\.length\)/);
});
