// v1.5 template catalogs: every template is valid, translated, readable on any background and applied whole.
import { describe, expect, it } from 'vitest';
import { RU } from '../lib/locale-ru';
import { PAGE_IN_S, WORD_IN_S, applyCaptionLook, captionAt, captionLayout, motionAt, stepTime, wordRoles } from './captions';
import { contrast, readableOn } from './color';
import { createCaptionClip, createProject, createTextClip } from './defaults';
import { FILTERS } from './filters';
import { saneStyle } from './style';
import { visualLayer } from './frame';
import { CAPTION_CATEGORIES, CAPTION_PRESETS, STICKERS, STICKER_GROUPS, TEXT_CATEGORIES, TEXT_PRESETS, type CaptionPreset } from './presets';
import { CAPTION_EMPHASES, CAPTION_MOTIONS, FONT_IDS, TEXT_ANIM_TYPES, TEXT_LOOP_TYPES, type FontId, type TextStyle } from './types';

const unique = (xs: string[]) => new Set(xs).size === xs.length;
const translated = (xs: string[]) => xs.filter((x) => !(x in RU));
const fontOk = (s: TextStyle) => (FONT_IDS as readonly string[]).includes(s.font as FontId);

/**
 * Readable on any background, by colour: the letters' edge contrasts with them — an outline of at least 0.04 font
 * sizes (3:1, WCAG large text), or a box (4.5:1 for the text, 3:1 for a lit word). The e2e checks the same in pixels.
 */
function readability(pr: Pick<CaptionPreset, 'style' | 'highlight' | 'emphasis'>): string[] {
  const s = pr.style, bad: string[] = [];
  const lit = pr.highlight && pr.emphasis !== 'box' ? [pr.highlight] : [];
  const fills = [s.color, ...(s.gradient ? [s.gradient] : []), ...lit];
  if (s.background && s.background.opacity >= 0.6) {
    for (const f of fills) if (contrast(f, s.background.color) < (f === s.color ? 4.5 : 3)) bad.push(`${f} on its box ${s.background.color}: ${contrast(f, s.background.color).toFixed(2)}`);
  } else if (s.stroke && s.stroke.width >= 0.04) {
    for (const f of fills) if (contrast(f, s.stroke.color) < 3) bad.push(`${f} in its outline ${s.stroke.color}: ${contrast(f, s.stroke.color).toFixed(2)}`);
  } else bad.push('no outline of 0.04 or more and no box');
  if (pr.emphasis === 'box' && contrast(readableOn(pr.highlight!, s.color), pr.highlight!) < 4.5) bad.push('text on the word box');
  return bad;
}

describe('caption templates (v1.5)', () => {
  it('a CapCut-sized catalog: 30+ templates, every category filled, unique ids and names', () => {
    expect(CAPTION_PRESETS.length).toBeGreaterThanOrEqual(40);
    expect(unique(CAPTION_PRESETS.map((p) => p.id))).toBe(true);
    expect(unique(CAPTION_PRESETS.map((p) => p.name))).toBe(true);
    for (const c of CAPTION_CATEGORIES) expect(CAPTION_PRESETS.filter((p) => p.cat === c.id).length, c.id).toBeGreaterThanOrEqual(5);
    expect(CAPTION_PRESETS.every((p) => CAPTION_CATEGORIES.some((c) => c.id === p.cat))).toBe(true);
  });
  it('the v1.0 looks keep their ids, order and layout (saved choices, projects and code use them)', () => {
    expect(CAPTION_PRESETS.slice(0, 9).map((p) => p.id)).toEqual(['pop', 'clean', 'box', 'karaoke', 'minimal', 'bold', 'green', 'neon', 'bubble']);
    expect(CAPTION_PRESETS[0]).toMatchObject({ highlight: '#ffd23f', wordsPerPage: 3, layout: 'highlight' });
  });
  it('no v1.5 name holds another name of its picker or is held by one (people and tests tell "Pop" from the rest)', () => {
    const old = new Set([...CAPTION_PRESETS.slice(0, 9).map((p) => p.id), ...TEXT_PRESETS.slice(0, TEXT_PRESETS.findIndex((p) => p.id === 'rounded')).map((p) => p.id)]);
    for (const list of [CAPTION_PRESETS, TEXT_PRESETS]) {
      const bad = list.flatMap((a) => list.filter((b) => b !== a && (!old.has(a.id) || !old.has(b.id)) && b.name.toLowerCase().includes(a.name.toLowerCase())).map((b) => `${a.name} ⊂ ${b.name}`));
      expect(bad).toEqual([]);
    }
  });
  it('use bundled faces and known emphases and motions; every name is in Russian', () => {
    for (const p of CAPTION_PRESETS) {
      expect(fontOk(p.style), p.id).toBe(true);
      if (p.emphasis) expect(CAPTION_EMPHASES, p.id).toContain(p.emphasis);
      if (p.motion) expect(CAPTION_MOTIONS, p.id).toContain(p.motion);
      expect(p.style.size, p.id).toBeGreaterThanOrEqual(0.03);
    }
    expect(translated([...CAPTION_PRESETS.map((p) => p.name), ...CAPTION_CATEGORIES.map((c) => c.name)])).toEqual([]);
  });
  it('every template reads on any background (outline or box contrast)', () => {
    const bad = CAPTION_PRESETS.flatMap((p) => readability(p).map((b) => `${p.id}: ${b}`));
    expect(bad).toEqual([]);
  });
  it('a template is applied whole — look, emphasis, motion, layout — and the catalog is never shared with the clip', () => {
    const words = [{ t0: 1, t1: 1.4, text: 'one' }, { t0: 1.5, t1: 2, text: 'two' }];
    for (const p of CAPTION_PRESETS) {
      const c = createCaptionClip(words, p);
      expect(c.preset).toBe(p.id);
      expect(captionLayout(c), p.id).toBe(p.layout);
      if (p.layout !== 'word') expect(c.wordsPerPage, p.id).toBe(p.wordsPerPage);
      expect(c.emphasis).toBe(p.emphasis);
      expect(c.motion).toBe(p.motion);
      expect(c.style).toEqual(p.style);
      expect(c.style).not.toBe(p.style);
    }
    // Another template replaces everything, including what the first one set and the second does not have.
    const c = createCaptionClip(words, CAPTION_PRESETS.find((p) => p.id === 'hype')!);
    c.style.stroke!.color = '#ff0000';
    expect(CAPTION_PRESETS.find((p) => p.id === 'hype')!.style.stroke!.color).toBe('#000000');
    applyCaptionLook(c, CAPTION_PRESETS.find((p) => p.id === 'clean')!);
    expect([c.emphasis, c.motion, c.highlight, captionLayout(c)]).toEqual([undefined, undefined, null, 'phrase']);
  });
});

describe('text styles, stickers and filters (v1.5)', () => {
  it('text styles: 55+ in filled categories, bundled faces, unique, translated', () => {
    expect(TEXT_PRESETS.length).toBeGreaterThanOrEqual(55);
    expect(unique(TEXT_PRESETS.map((p) => p.id))).toBe(true);
    expect(unique(TEXT_PRESETS.map((p) => p.name))).toBe(true);
    for (const c of TEXT_CATEGORIES) expect(TEXT_PRESETS.filter((p) => p.cat === c.id).length, c.id).toBeGreaterThanOrEqual(3);
    for (const p of TEXT_PRESETS) {
      expect(fontOk(p.style), p.id).toBe(true);
      if (p.animIn) expect(TEXT_ANIM_TYPES, p.id).toContain(p.animIn.type);
    }
    expect(translated([...TEXT_PRESETS.map((p) => p.name), ...TEXT_CATEGORIES.map((c) => c.name)])).toEqual([]);
  });
  it('the v1.5 text styles read on any background too (the v0.2–v0.8 ones keep their look)', () => {
    const fresh = TEXT_PRESETS.slice(TEXT_PRESETS.findIndex((p) => p.id === 'rounded'));
    expect(fresh.length).toBeGreaterThanOrEqual(20);
    expect(fresh.flatMap((p) => readability({ style: p.style, highlight: null }).map((b) => `${p.id}: ${b}`))).toEqual([]);
  });
  it('stickers: the v0.2 set first and in order, no doubles, every group named', () => {
    expect(STICKERS.slice(0, 3)).toEqual(['😂', '🔥', '❤️']);
    expect(STICKER_GROUPS[0].items.length).toBe(32);
    expect(STICKERS.length).toBeGreaterThanOrEqual(150);
    expect(unique([...STICKERS])).toBe(true);
    expect(translated(STICKER_GROUPS.map((g) => g.name))).toEqual([]);
  });
  it('filters: 24, unique, translated', () => {
    expect(FILTERS.length).toBe(24);
    expect(unique(FILTERS.map((f) => f.id))).toBe(true);
    expect(translated(FILTERS.map((f) => f.name))).toEqual([]);
  });
});

describe('caption words and motion (v1.5)', () => {
  const words = [{ t0: 0, t1: 0.4, text: 'a' }, { t0: 0.5, t1: 0.9, text: 'b' }, { t0: 1, t1: 1.4, text: 'c' }];
  it('captionAt reports the latest started word: its age and length', () => {
    expect(captionAt({ words, wordsPerPage: 3 }, 0.7)).toMatchObject({ active: 1, shown: 2, wordDur: 0.4 });
    expect(captionAt({ words, wordsPerPage: 3 }, 0.95)!.wordSince).toBeCloseTo(0.45);
    expect(captionAt({ words, wordsPerPage: 3 }, 0.95)!.active).toBe(-1); // between words
  });
  it('word roles per emphasis: lit, box, line, bigger, karaoke share, said so far, dimmed', () => {
    const hl = { highlight: '#ff0000', reveal: undefined, motion: undefined };
    const r = (emphasis: (typeof CAPTION_EMPHASES)[number] | undefined, active: number, said: number, fill = 1) =>
      wordRoles({ ...hl, emphasis }, 3, active, said, fill, false);
    expect(r(undefined, 1, 2).map((x) => x.lit)).toEqual([0, 1, 0]);
    expect(r(undefined, -1, 2).map((x) => x.lit)).toEqual([0, 0, 0]); // as before v1.5: off between words
    expect(r('color', -1, 2).map((x) => x.lit)).toEqual([0, 1, 0]); // v1.5: stays on through a pause
    expect(r('box', 1, 2).map((x) => x.box)).toEqual([false, true, false]);
    expect(r('underline', 1, 2).map((x) => x.underline)).toEqual([false, true, false]);
    expect(r('scale', 1, 2).map((x) => [x.big, x.lit])).toEqual([[false, 0], [true, 1], [false, 0]]);
    expect(r('fill', 1, 2, 0.25).map((x) => x.lit)).toEqual([1, 0.25, 0]);
    expect(r('past', 2, 3).map((x) => x.lit)).toEqual([1, 1, 1]);
    expect(r('dim', 0, 1).map((x) => [x.lit, x.dim])).toEqual([[1, false], [0, true], [0, true]]);
    expect(wordRoles({ highlight: null, emphasis: 'fill' }, 3, 1, 2, 0.5, false).every((x) => !x.lit)).toBe(true); // no highlight: plain
    expect(wordRoles({ highlight: '#fff', reveal: true, motion: 'pop' }, 3, 1, 2, 1, true).map((x) => x.enter)).toEqual([false, true, false]);
  });
  it('every motion starts small or clear and ends exactly in place', () => {
    for (const m of CAPTION_MOTIONS) {
      expect(motionAt(m, 1), m).toEqual({ k: 1, x: 0, y: 0, a: 1 });
      if (m !== 'none') { const s = motionAt(m, 0); expect(s.a < 0.01 || s.k < 0.6 || Math.abs(s.x) > 0.5, m).toBe(true); }
    }
  });
  it('stepped time lands on export frames exactly (preview and the 30 fps export see the same steps)', () => {
    for (let k = 0; k <= 600; k++) expect(stepTime(k / 30)).toBe(Math.floor(k + 1e-6) / 30);
    expect(stepTime(1 / 30 - 1e-4)).toBe(0);
  });
});

describe('styles from outside (v1.5, docs/11 §3.15)', () => {
  it('a style from a backup is kept sane before drawing; every catalog style passes unchanged', () => {
    for (const p of [...CAPTION_PRESETS, ...TEXT_PRESETS]) expect(saneStyle(p.style), p.id).toEqual(p.style);
    const evil = { ...TEXT_PRESETS[0].style, size: 400, stroke: { color: '#000', width: 1e9 }, outline2: { color: '#fff', width: Number.NaN },
      copies: Array.from({ length: 1e4 }, () => ({ color: '#f00', x: 1e6, y: -1e6, depth: true })), letterSpacing: 1e5, lineHeight: -3,
      background: { color: '#000', opacity: 7, padding: 1e9, radius: Infinity, lines: true } } as TextStyle;
    const s = saneStyle(evil);
    expect([s.size, s.stroke!.width, s.outline2!.width, s.copies!.length, s.copies![0].x, s.copies![0].y, s.letterSpacing, s.lineHeight]).toEqual([1, 0.5, 0, 4, 0.5, -0.5, 2, 0.5]);
    expect(s.background).toMatchObject({ opacity: 1, padding: 3, radius: 0.3 });
  });
  it('an emphasis or motion from a newer version draws plainly instead of breaking the frame', () => {
    expect(motionAt('wobble' as never, 0.3)).toEqual({ k: 1, x: 0, y: 0, a: 1 });
    expect(wordRoles({ highlight: '#fff', emphasis: 'sparkle' as never }, 2, 0, 1, 1, false).map((r) => r.lit)).toEqual([0, 0]);
    const c = createCaptionClip([{ t0: 0, t1: 1, text: 'a' }], CAPTION_PRESETS[0]);
    Object.assign(c, { motion: 'wobble', emphasis: 'sparkle' });
    expect(() => visualLayer(createProject('x', '9:16'), c, 0.1)).not.toThrow();
  });
});

describe('buildFrame for captions and text (v1.5): one picture per moment', () => {
  const p = createProject('t', '9:16');
  const words = [{ t0: 1, t1: 1.5, text: 'one' }, { t0: 1.6, t1: 2.2, text: 'two' }, { t0: 2.3, t1: 2.8, text: 'three' }];
  const at = (id: string, t: number) => {
    const c = createCaptionClip(words, CAPTION_PRESETS.find((x) => x.id === id)!);
    return visualLayer(p, c, t);
  };
  it('karaoke fill is the stepped share of the word; it changes at most 30 times a second', () => {
    const l = at('fill', 1.6 + 0.3);
    expect(l.source.kind === 'caption' && l.source.fill).toBeCloseTo(stepTime(0.3) / 0.6, 6);
    const steps = new Set<number>();
    for (let t = 1.6; t < 2.2; t += 1 / 240) { const x = at('fill', t); if (x.source.kind === 'caption') steps.add(x.source.fill); }
    expect(steps.size).toBeLessThanOrEqual(Math.ceil(0.6 * 30) + 1);
  });
  it('the bigger word pops in 1/15 s steps: at most 4 drawings of the caption per word', () => {
    const steps = new Set<number>();
    for (let t = 1.6; t < 1.6 + WORD_IN_S + 0.05; t += 1 / 240) { const x = at('hype', t); if (x.source.kind === 'caption') steps.add(x.source.enter); }
    expect([...steps].sort()).toEqual([0, 1 / 3, 2 / 3, 1].map((v) => expect.closeTo(v, 6)));
  });
  it('a word coming in (words appear) steps from 0 to 1 over WORD_IN_S; others are drawn settled', () => {
    const l = (t: number) => { const x = at('popup', t); return x.source.kind === 'caption' ? x.source.enter : NaN; };
    expect(l(1.6)).toBe(0);
    expect(l(1.6 + WORD_IN_S + 0.01)).toBe(1);
    expect(at('clean', 1.7).source).toMatchObject({ fill: 1, enter: 1 });
  });
  it('a line comes in with its motion and is exactly in place after PAGE_IN_S; the same time gives the same frame', () => {
    const settled = at('slide', 1 + PAGE_IN_S + 0.01), start = at('slide', 1);
    const base = createCaptionClip(words, CAPTION_PRESETS.find((x) => x.id === 'slide')!).transform;
    expect([settled.x, settled.y, settled.opacity, settled.scale]).toEqual([base.x.v, base.y.v, 1, 1]);
    expect(start.opacity).toBe(0);
    expect(start.x).toBeLessThan(base.x.v);
    const zoom = createCaptionClip(words, CAPTION_PRESETS.find((x) => x.id === 'zoom')!);
    expect(visualLayer(p, zoom, 1.1)).toEqual(visualLayer(p, zoom, 1.1));
  });
  it('captions from before v1.5 (no motion) still pop word by word, and nothing else moves', () => {
    const c = createCaptionClip(words, CAPTION_PRESETS[0]);
    delete c.motion;
    c.wordsPerPage = 1;
    expect(visualLayer(p, c, 1.05).scale).toBeLessThan(1);
    c.wordsPerPage = 3;
    expect(visualLayer(p, c, 1.05).scale).toBe(1);
  });
  it('text: every entrance ends in place; every repeat is the same at the same time', () => {
    for (const type of TEXT_ANIM_TYPES) {
      const c = createTextClip(0, 'Hi');
      c.animIn = { type, duration: 0.5 };
      const l = visualLayer(p, c, 0.6);
      expect([l.x, l.y, l.scale, l.rotation, l.opacity, l.fx], type).toEqual([0, 0, 1, 0, 1, null]);
    }
    for (const type of TEXT_LOOP_TYPES) {
      const c = createTextClip(0, 'Hi');
      c.loop = { type, period: 1 };
      expect(visualLayer(p, c, 1.37), type).toEqual(visualLayer(p, c, 1.37));
      if (type !== 'none') expect(visualLayer(p, c, 1.37), type).not.toEqual(visualLayer(p, { ...c, loop: undefined }, 1.37));
    }
  });
});
