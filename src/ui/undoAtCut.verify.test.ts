// Sweep lane E2 (docs/21 §5): SW-E2-1 — past 500 steps Undo must say why it goes no further. The store says it
// (src/state/historyCut.test.ts); this checks the one line that lets a person press Undo at the cut at all: with the
// history cut and nothing left in it, the button stays enabled, or the store's words are never reached.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it('Undo stays enabled at the cut of the history, so it can say why (SW-E2-1)', () => {
  const src = readFileSync(join(import.meta.dirname, 'Editor.tsx'), 'utf8');
  const canUndo = /const canUndo = useEditor\(\(s\) => ([^;]+)\);/.exec(src)?.[1];
  expect(canUndo, 'the Undo button reads its state from the store').toBeTruthy();
  expect(canUndo, 'a cut history keeps Undo enabled').toMatch(/s\.historyCut/);
  expect(src).toMatch(/label=\{t\('Undo'\)\} disabled=\{!canUndo\}/);
});
