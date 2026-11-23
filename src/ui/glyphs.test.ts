// Every character the interface draws is in Geologica (the ranges ckFont.ts loads) or in the system font after it in
// --font-ui. A character in neither sends WebKit hunting through the system's fallback fonts the first time it is laid
// out: «◆» in the Transform sheet's hint cost 36–65 ms of the sheet's first frame on the Mac (WebKit, live v1.9.14, Д4 of
// docs/17), against 1–3 ms for plain text. The arrows below are in the system font and measured 0–1 ms. A new symbol
// fails here until it is drawn as an icon (KeyHint) or measured and added to SYSTEM.
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseAst } from 'vite';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..', '..');
/** In the system font (SF), measured on the Mac at 0–2 ms for its first layout (2026-11-19). */
const SYSTEM = new Set('←→↔↕⋯≈');

const ranges = [...readFileSync(join(ROOT, 'src/ui/ckFont.ts'), 'utf8').matchAll(/U\+([0-9A-F]+)(?:-([0-9A-F]+))?/g)]
  .map((m) => [parseInt(m[1], 16), parseInt(m[2] ?? m[1], 16)] as const);
const inFace = (c: string) => { const n = c.codePointAt(0)!; return ranges.some(([a, b]) => n >= a && n <= b); };

function files(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return files(p);
    return /\.tsx?$/.test(e.name) && !/\.test\.|\.verify\./.test(e.name) ? [p] : [];
  });
}

/** The characters of every string, template and JSX text in a file: what may reach the screen (comments and
 *  `aria-label`s do not). */
function drawn(file: string): { at: string; c: string }[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const out: { at: string; c: string }[] = [];
  const add = (s: string | null | undefined, start: number) => {
    if (!s) return;
    const at = `${file}:${text.slice(0, start).split('\n').length}`;
    for (const c of new Set(s)) out.push({ at, c });
  };
  const visit = (n: unknown): void => {
    if (!n || typeof n !== 'object') return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    const node = n as { type?: string; value?: unknown; start?: number; name?: { name?: unknown } };
    if (node.type === 'JSXAttribute' && node.name?.name === 'aria-label') return; // heard, not drawn
    if (node.type === 'JSXText' && typeof node.value === 'string') add(node.value, node.start ?? 0);
    else if (node.type === 'Literal' && typeof node.value === 'string') add(node.value, node.start ?? 0);
    else if (node.type === 'TemplateElement') add((node.value as { cooked?: string | null }).cooked, node.start ?? 0);
    for (const v of Object.values(node)) visit(v);
  };
  visit(parseAst(text, { lang: file.endsWith('x') ? 'tsx' : 'ts' }));
  return out;
}

describe('glyphs of the interface (Д4)', () => {
  it('reads the face ranges from ckFont.ts', () => {
    expect(ranges.length).toBeGreaterThan(10);
    expect(inFace('ё') && inFace('W') && inFace('—') && !inFace('◆')).toBe(true);
  });

  it('draws no character that neither Geologica nor the system font has', () => {
    const odd = [...files('src/ui'), 'src/lib/locale-ru.ts', 'src/lib/i18n.ts']
      .flatMap(drawn)
      .filter(({ c }) => !inFace(c) && !SYSTEM.has(c) && !/\s/.test(c))
      .map(({ at, c }) => `${at} «${c}» U+${c.codePointAt(0)!.toString(16).toUpperCase()}`);
    expect(odd, 'draw it as an icon (KeyHint for ◆) or measure its first layout in WebKit and add it to SYSTEM').toEqual([]);
  });
});
