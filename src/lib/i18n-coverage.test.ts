// Every literal UI string passed to t() must have a Russian translation.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { RU } from './locale-ru';

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    return e.isDirectory() ? files(p) : /\.tsx?$/.test(e.name) && !e.name.includes('.test.') ? [p] : [];
  });
}

test('all t() strings are translated to Russian', () => {
  const missing = new Set<string>();
  for (const f of files(join(import.meta.dirname, '..'))) {
    for (const m of readFileSync(f, 'utf8').matchAll(/\b(?:t|MediaError)\(\s*'((?:[^'\\]|\\.)+)'/g)) {
      const key = m[1].replace(/\\'/g, "'");
      if (!(key in RU)) missing.add(key);
    }
  }
  expect([...missing]).toEqual([]);
});
