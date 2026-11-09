import { describe, expect, it } from 'vitest';
import { createProject, createTextClip, defaultAdjust } from './defaults';
import { withoutLook, type FrameDesc } from './frame';
import { FILTERS, FILTER_CATEGORIES } from './filters';
import { applyLookToTrack, mainTrack } from './timeline';
import type { Project, VideoClip } from './types';

function piece(id: string, start: number): VideoClip {
  return { id, kind: 'video', assetId: 'a', start, duration: 2, filter: null, adjust: defaultAdjust(), chroma: { enabled: false }, transform: { marker: id } } as unknown as VideoClip;
}
function project(): { p: Project; a: VideoClip; b: VideoClip; c: VideoClip } {
  const p = createProject('x', '9:16');
  const a = piece('a', 0), b = piece('b', 2), c = piece('c', 4);
  mainTrack(p).clips.push(a, b, c);
  return { p, a, b, c };
}

describe('apply a look to every piece', () => {
  it('copies filter and LUT, and only them', () => {
    const { p, a, b, c } = project();
    a.filter = { id: 'noir', intensity: 0.4 };
    a.lut = { id: 'l1', intensity: 0.5 };
    a.adjust.contrast = 0.7;
    a.effect = { id: 'vhs', amount: 0.3 };
    expect(applyLookToTrack(p, 'a', ['filter'])).toBe(2);
    expect(b.filter).toEqual({ id: 'noir', intensity: 0.4 });
    expect(c.lut).toEqual({ id: 'l1', intensity: 0.5 });
    expect(b.adjust.contrast, 'adjustments are another sheet').toBe(0);
    expect(c.effect).toBeUndefined();
    expect((b.transform as unknown as { marker: string }).marker, 'framing stays').toBe('b');
  });

  it('copies adjustments and effects as independent values', () => {
    const { p, a, b } = project();
    a.adjust.temperature = -0.3;
    a.effect = { id: 'glitch', amount: 0.9 };
    applyLookToTrack(p, 'a', ['adjust', 'effect']);
    expect(b.adjust.temperature).toBe(-0.3);
    expect(b.effect).toEqual({ id: 'glitch', amount: 0.9 });
    b.adjust.temperature = 0.5;
    b.effect!.amount = 0.1;
    expect(a.adjust.temperature, 'the pieces do not share one object').toBe(-0.3);
    expect(a.effect!.amount).toBe(0.9);
  });

  it('"None" clears the others', () => {
    const { p, b, c } = project();
    b.filter = { id: 'mono', intensity: 1 };
    b.lut = { id: 'l1', intensity: 1 };
    c.effect = { id: 'blur', amount: 1 };
    applyLookToTrack(p, 'a', ['filter', 'effect']);
    expect(b.filter).toBeNull();
    expect(b.lut).toBeUndefined();
    expect(c.effect).toBeUndefined();
  });

  it('stays on the clip\'s own track and leaves text alone', () => {
    const { p, a, b } = project();
    const overlay = piece('o', 0);
    const text = createTextClip(0, 'hi');
    p.tracks.push({ id: 't1', kind: 'overlay', clips: [overlay] } as never, { id: 't2', kind: 'text', clips: [text] } as never);
    a.adjust.exposure = 0.2;
    expect(applyLookToTrack(p, 'a', ['adjust'])).toBe(2);
    expect(overlay.adjust.exposure).toBe(0);
    expect(b.adjust.exposure).toBe(0.2);
    overlay.adjust.grain = 0.9;
    expect(applyLookToTrack(p, 'o', ['adjust']), 'an overlay alone on its track').toBe(0);
    expect(a.adjust.grain).toBe(0);
  });

  it('does nothing for a clip without a look', () => {
    const { p } = project();
    const text = createTextClip(0, 'hi');
    p.tracks.push({ id: 'c', kind: 'text', clips: [text] } as never);
    expect(applyLookToTrack(p, text.id, ['adjust'])).toBe(0);
    expect(applyLookToTrack(p, 'missing', ['adjust'])).toBe(0);
  });
});

describe('before and after', () => {
  it('leaves out colour and effect of that clip only, and copies instead of changing', () => {
    const look = { adjust: { contrast: 1 }, lut: { id: 'l' }, fx: { code: 1 } };
    const desc = { t: 0, background: '#000', layers: [{ id: 'a', ...look }, { id: 'b', ...look }] } as unknown as FrameDesc;
    const out = withoutLook(desc, 'a');
    expect(out.layers[0]).toMatchObject({ id: 'a', adjust: null, lut: null, fx: null });
    expect(out.layers[1]).toMatchObject(look);
    expect(desc.layers[0]).toMatchObject(look);
  });
});

describe('filter categories', () => {
  it('every filter sits in a category the picker shows', () => {
    const ids = new Set<string>(FILTER_CATEGORIES.map((c) => c.id));
    for (const f of FILTERS) expect(ids.has(f.cat), f.id).toBe(true);
  });
});
