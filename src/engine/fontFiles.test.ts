// The font files as they are served (docs/18 Ш1, Ш2): every face draws Russian, Latin and the common signs with its own
// glyphs, read from the woff2 files themselves (their cmap), not from the browser, which falls back without a word.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as fontkit from 'fontkit';
import { expect, it } from 'vitest';
import { FONT_IDS } from '../core/types';
import { FONTS } from './text';

const ROOT = join(import.meta.dirname, '..', '..');
const RU = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const SIGNS = '0123456789«»„“’—–…№!?,.:;()"\'%°×+';
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const NEED = [...RU + SIGNS + LATIN];

/**
 * Gaps the faces of earlier versions have, each with what stands in for it. Anything not here must be whole, so a
 * new face with a hole fails; and a gap here that is no longer found fails too (the reading of the files is checked).
 */
const KNOWN_GAPS: Record<string, string> = {
  // Their Cyrillic, «№» and «Ё» come from Oswald, listed next in the family (src/engine/text.ts).
  anton: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя№',
  bebas: 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя№',
  jost: '№',
  neucha: '×',
};

const imports = readFileSync(join(ROOT, 'src', 'fonts.ts'), 'utf8');
const faceFiles = (pkg: string) => {
  const faces = new Map<string, string[]>();
  for (const m of imports.matchAll(new RegExp(`'@fontsource/${pkg}/([a-z-]+?)-(\\d+)(-italic)?\\.css'`, 'g'))) {
    const key = `${m[2]}${m[3] ? ' italic' : ''}`;
    faces.set(key, [...(faces.get(key) ?? []), join(ROOT, 'node_modules', '@fontsource', pkg, 'files', `${pkg}-${m[1]}-${m[2]}-${m[3] ? 'italic' : 'normal'}.woff2`)]);
  }
  return faces;
};
const packageOf = (id: string) => /^"([^"]+)"/.exec(FONTS[id as keyof typeof FONTS].family)![1].toLowerCase().replace(/ /g, '-');
const missing = (files: string[]) => {
  const have = new Set<number>();
  for (const f of files) for (const cp of (fontkit.create(readFileSync(f)) as fontkit.Font).characterSet) have.add(cp);
  return NEED.filter((ch) => !have.has(ch.codePointAt(0)!)).join('');
};

it('every face draws Russian, Latin and the common signs with its own glyphs (Ш1)', () => {
  const found: Record<string, string> = {};
  for (const id of FONT_IDS) {
    const faces = faceFiles(packageOf(id));
    expect(faces.size, `${id}: faces imported`).toBeGreaterThan(0);
    for (const [face, files] of faces) {
      const gap = missing(files);
      if (gap) found[id] = [...new Set((found[id] ?? '') + gap)].join('');
      if (!(id in KNOWN_GAPS)) expect(gap, `${id} ${face}: letters drawn by another face`).toBe('');
    }
  }
  expect(found, 'the recorded gaps, no more and no fewer').toEqual(KNOWN_GAPS);
});

it('every face served fits the cache that keeps them offline (Ш2)', () => {
  const config = readFileSync(join(ROOT, 'vite.config.ts'), 'utf8');
  const limit = Number(/cacheName: 'kadr-fonts', expiration: \{ maxEntries: (\d+) \}/.exec(config)![1]);
  const served = [...imports.matchAll(/^import '@fontsource\//gm)].length + 2; // + the interface's Geologica, two files
  expect(served).toBeLessThanOrEqual(limit);
});
