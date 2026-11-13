// Chetko tokens (docs/17 stage Ч2, condition Д6): the contrast of every pair, the size of every scale, and drift —
// a value written by hand in a file that already lives on tokens. Each check has a control: a deliberate violation
// must turn it red, otherwise the check proves nothing.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TOKEN_LIMITS, TOKEN_PAIRS } from './tokenPairs';

const read = (file: string) => readFileSync(join(import.meta.dirname, file), 'utf8');
const TOKENS = read('tokens.css');

/** `--name: value` of the `.ck` block, with `var()` followed to the end. */
function parseTokens(css: string): Map<string, string> {
  const raw = new Map<string, string>();
  for (const m of css.matchAll(/^\s*(--[a-z0-9-]+):\s*([^;]+);/gm)) if (!raw.has(m[1])) raw.set(m[1], m[2].trim());
  const resolve = (v: string, depth = 0): string => {
    const m = v.match(/^var\((--[a-z0-9-]+)\)$/);
    if (!m || depth > 8) return v;
    const next = raw.get(m[1]);
    if (next === undefined) throw new Error(`${m[1]} is not defined`);
    return resolve(next, depth + 1);
  };
  return new Map([...raw].map(([k, v]) => [k, resolve(v)]));
}

/** OKLCH → relative luminance of the sRGB colour a screen shows (clipped to the gamut, like a browser on an sRGB screen). */
function luminance(value: string): number {
  const m = value.match(/^oklch\(([\d.]+)%\s+([\d.]+)\s+([\d.]+)\)$/);
  if (!m) throw new Error(`not an opaque oklch colour: ${value}`);
  const L = Number(m[1]) / 100, C = Number(m[2]), h = (Number(m[3]) * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const mm = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * mm + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * mm - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * mm + 1.707614701 * s,
  ].map((v) => Math.min(1, Math.max(0, v)));
  return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2];
}
const contrast = (fg: string, bg: string) => { const a = luminance(fg), b = luminance(bg); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };

function failingPairs(css: string): string[] {
  const t = parseTokens(css);
  const out: string[] = [];
  for (const p of TOKEN_PAIRS) {
    const fg = t.get(p.fg), bg = t.get(p.bg);
    if (!fg || !bg) { out.push(`${p.fg} on ${p.bg}: a token is missing`); continue; }
    const r = contrast(fg, bg);
    if (r < p.min) out.push(`${p.fg} on ${p.bg}: ${r.toFixed(2)} < ${p.min} (${p.what})`);
  }
  return out;
}

describe('tokens: contrast', () => {
  it('known colours give the known ratios (the maths itself)', () => {
    expect(contrast('oklch(100% 0 0)', 'oklch(0% 0 0)')).toBeCloseTo(21, 1);
    expect(contrast('oklch(56.93% 0 0)', 'oklch(100% 0 0)')).toBeCloseTo(4.48, 1); // #777777 on white
    const yellow = contrast('oklch(88.5% 0.181 95)', 'oklch(0% 0 0)'); // #ffd60a on black is 14.9
    expect(yellow).toBeGreaterThan(14.4);
    expect(yellow).toBeLessThan(15.4);
  });
  it('every pair that meets on screen keeps its WCAG AA contrast', () => {
    expect(failingPairs(TOKENS)).toEqual([]);
  });
  it('control: a dimmer second-plan text is caught', () => {
    const broken = TOKENS.replace(/--ink-65: oklch\([^)]*\)/, '--ink-65: oklch(45% 0.008 270)');
    expect(broken).not.toBe(TOKENS);
    expect(failingPairs(broken).some((f) => f.startsWith('--text-secondary on --surface-panel'))).toBe(true);
  });
});

describe('tokens: scales do not grow', () => {
  const names = [...parseTokens(TOKENS).keys()];
  for (const [prefix, max] of Object.entries(TOKEN_LIMITS)) {
    it(`${prefix}* has at most ${max} steps`, () => {
      const steps = names.filter((n) => n.startsWith(prefix));
      expect(steps.length).toBeGreaterThan(0);
      expect(steps.length, steps.join(' ')).toBeLessThanOrEqual(max);
    });
  }
  it('type is set in rem, so the text follows the size a person chose', () => {
    const t = parseTokens(TOKENS);
    for (const n of names.filter((x) => x.startsWith('--type-'))) expect(t.get(n), n).toMatch(/^[\d.]+rem$/);
  });
});

// ---- drift: a file that lives on tokens has no value written by hand ----
/** Files already moved onto tokens. A screen is added here in the same commit that migrates it (stage Ч4). */
const ON_TOKENS = ['ds.css', 'DesignSystem.tsx', 'DsComponents.tsx', 'DsParts.tsx', 'ck/ck.css', 'ck/Scale.tsx', 'ck/Sheet.tsx', 'ck/controls.tsx', 'ck/choice.tsx',
  'ck/Field.tsx', 'ck/feedback.tsx', 'ck/home.tsx', 'ck/timeline.tsx', 'home.css', 'editor.css', 'timeline.css', 'sheets.css', 'stage.css'];
/** Pictures that stand in for a person's video in the gallery: content, so their colours are free and not interface debt. */
const CONTENT = ['dsArt.tsx'];
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

function drift(source: string): string[] {
  const s = stripComments(source);
  const out: string[] = [];
  const add = (what: string, hits: Iterable<RegExpMatchArray>) => { for (const m of hits) out.push(`${what}: ${m[0].trim().slice(0, 60)}`); };
  add('a colour by hand', s.matchAll(/#[0-9a-fA-F]{3,8}\b(?![\w-])/g));
  add('a colour by hand', s.matchAll(/\b(?:rgba?|hsla?|oklch|oklab|lab|lch|color-mix)\(/g));
  const byHand = (what: string, re: RegExp, allowed: RegExp) => { for (const m of s.matchAll(re)) if (!allowed.test(m[1].trim())) out.push(`${what}: ${m[0].trim().slice(0, 60)}`); };
  byHand('a font size by hand', /font-?[sS]ize:\s*['"`]?([^;,}\n'"`]+)/g, /^(?:var\(|inherit)/);
  add('a font size by hand', s.matchAll(/\bfont:\s*[^;}\n]*\d(?:px|rem|em)\b[^;}\n]*/g));
  byHand('a radius by hand', /border-?[rR]adius:\s*['"`]?([^;,}\n'"`]+)/g, /^(?:var\(|`var\(|0$|50%$|24%$|inherit)/);
  byHand('a layer by hand', /z-?[iI]ndex:\s*['"`]?([^;,}\n'"`]+)/g, /^var\(/);
  for (const m of s.matchAll(/(?:transition|animation)(?:-duration)?:\s*([^;}\n]+)/g)) if (/\d(?:ms|s)\b/.test(m[1])) out.push(`a duration by hand: ${m[0].slice(0, 60)}`);
  for (const m of s.matchAll(/(?:padding|margin|gap)(?:-[a-z]+)?:\s*([^;}\n]+)/g)) {
    for (const px of m[1].replace(/var\([^)]*\)|calc\([^;]*\)|env\([^)]*\)/g, '').matchAll(/(\d+(?:\.\d+)?)px/g)) if (Number(px[1]) % 4 !== 0) out.push(`a gap off the 4 px grid: ${m[0].slice(0, 60)}`);
  }
  return out;
}

describe('tokens: drift', () => {
  for (const file of ON_TOKENS) it(`${file} takes every value from tokens`, () => { expect(drift(read(file))).toEqual([]); });
  it('classes of the new system are namespaced, so the old stylesheet cannot restyle them', () => {
    // Found the hard way: the gallery's `.tile` took the width and the font size of the editor's `.tile`.
    const classesOf = (css: string) => [...new Set([...stripComments(css).matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]))];
    const old = new Set(classesOf(read('styles.css')));
    const foreign = (css: string) => classesOf(css).filter((c) => !/^(?:ck|ds)(?:-|$)/.test(c) || old.has(c));
    for (const file of ON_TOKENS.filter((f) => f.endsWith('.css'))) expect(foreign(read(file)), file).toEqual([]);
    expect(foreign('.ds .tile { width: 100%; } .ck-held.now::after { top: 0; }'), 'control').toEqual(['tile', 'now']);
  });
  it('control: each kind of hand-written value is caught', () => {
    const bad = ['.a { color: #ff0; }', '.a { background: rgba(0, 0, 0, 0.5); }', '.a { font-size: 13px; }', '.a { font: 600 14px Inter; }', '.a { border-radius: 10px; }',
      '.a { z-index: 5; }', '.a { transition: scale 0.2s ease; }', '.a { padding: 6px 10px; }', "<i style={{ fontSize: '13px' }} />", "<i style={{ color: '#fff' }} />"];
    for (const line of bad) expect(drift(line), line).not.toEqual([]);
    const good = ['.a { color: var(--signal); border-radius: var(--radius-control); padding: var(--space-2) 0; transition: scale var(--dur-press) var(--ease-soft); }',
      '.a { font-size: var(--type-sm); z-index: var(--z-mark); margin: 0 auto; gap: 8px; border-radius: 50%; }', "<i style={{ fontSize: 'var(--type-lg)' }} />"];
    for (const line of good) expect(drift(line), line).toEqual([]);
  });
});

// ---- the screens that are not migrated yet: their debt may only shrink ----
/** What styles.css and the components held on 2026-11-10 (reports/Chetko — аудит интерфейса.md §6). Lower a number when a
 *  screen moves onto tokens; never raise one. */
const LEGACY = { hex: 87, colourFunctions: 38, fontSizes: 13, radii: 14, layers: 13, hexInComponents: 49 };

describe('tokens: the old styles do not grow new debt', () => {
  const css = stripComments(read('styles.css'));
  const distinct = (re: RegExp) => new Set([...css.matchAll(re)].map((m) => m[1].trim())).size;
  it('styles.css', () => {
    expect([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].length).toBeLessThanOrEqual(LEGACY.hex);
    expect([...css.matchAll(/\b(?:rgba?|hsla?)\(/g)].length).toBeLessThanOrEqual(LEGACY.colourFunctions);
    expect(distinct(/(?<![a-z-])font-size:\s*([^;}]+)/g)).toBeLessThanOrEqual(LEGACY.fontSizes);
    expect(distinct(/border-radius:\s*([^;}]+)/g)).toBeLessThanOrEqual(LEGACY.radii);
    expect(distinct(/z-index:\s*([^;}]+)/g)).toBeLessThanOrEqual(LEGACY.layers);
  });
  it('components', () => {
    const files = readdirSync(import.meta.dirname).filter((f) => /\.tsx?$/.test(f) && !f.endsWith('.test.ts') && !ON_TOKENS.includes(f) && f !== 'tokenPairs.ts' && f !== 'ckFont.ts' && !CONTENT.includes(f));
    const hex = files.reduce((n, f) => n + [...read(f).matchAll(/#[0-9a-fA-F]{6}\b/g)].length, 0);
    expect(hex).toBeLessThanOrEqual(LEGACY.hexInComponents);
  });
});
