import { describe, expect, it } from 'vitest';
import { duplicatePackages } from './one-copy';

const W = '/u/kadr/.claude/worktrees/w/node_modules';
const M = '/u/kadr/node_modules';

describe('one copy of each package (S-1-11)', () => {
  it('finds React reached through a symlinked node_modules and its real path', () => {
    const twice = duplicatePackages([`${M}/react/index.js`, `${M}/react/cjs/react.production.js`, `${W}/react/index.js`, `${M}/react-dom/client.js`, '/u/kadr/src/main.tsx']);
    expect([...twice.keys()]).toEqual(['react']);
    expect(twice.get('react')).toEqual([`${W}/react`, `${M}/react`].sort());
  });

  it('counts scoped packages and nested dependencies by their own folder', () => {
    expect(duplicatePackages([`${M}/@scope/a/x.js`, `${W}/@scope/a/x.js`]).get('@scope/a')).toHaveLength(2);
    // Two versions of one package, one nested in another package: also two copies, and named.
    expect(duplicatePackages([`${M}/b/i.js`, `${M}/c/node_modules/b/i.js`]).has('b')).toBe(true);
  });

  it('is silent on one copy, on virtual modules and on files outside node_modules', () => {
    expect(duplicatePackages([`${M}/react/index.js`, `${M}/react/cjs/react.production.js`, '\0vite/preload-helper', '/u/kadr/src/a.ts']).size).toBe(0);
  });
});
