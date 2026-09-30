import { describe, expect, it } from 'vitest';
import { createImageClip, createProject, createTextClip } from './defaults';
import { punchScale, seedOf, shake } from './effects';
import { applyTransition, buildFrame } from './frame';
import { fromBase64, parseCube, toBase64 } from './lut';
import { applyTransitionToAll, clipEnd, deleteClips, duplicateClips, findClip, insertMain, mainTrack, moveClipsBy, placeClip } from './timeline';
import { TRANSITION_TYPES, type Asset, type ImageClip } from './types';

const cube = (size: number, f: (r: number, g: number, b: number) => number[], head = '') => {
  const lines = [head, `LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    lines.push(f(r / (size - 1), g / (size - 1), b / (size - 1)).map((v) => v.toFixed(6)).join(' '));
  }
  return lines.join('\n');
};

describe('.cube LUT parser', () => {
  it('parses an identity LUT with title and comments', () => {
    const l = parseCube(cube(17, (r, g, b) => [r, g, b], '# comment\nTITLE "Identity"'));
    expect(l.title).toBe('Identity');
    expect(l.size).toBe(17);
    // Red is fastest: entry (r=16, g=0, b=0) is pure red.
    expect(Array.from(l.data.subarray(16 * 3, 16 * 3 + 3))).toEqual([255, 0, 0]);
  });
  it('resamples LUTs above 33 to 33 without changing an identity', () => {
    const l = parseCube(cube(65, (r, g, b) => [r, g, b]));
    expect(l.size).toBe(33);
    const i = ((20 * 33 + 10) * 33 + 5) * 3;
    expect(Array.from(l.data.subarray(i, i + 3))).toEqual([5, 10, 20].map((x) => Math.round((x / 32) * 255)));
  }, 20_000); // 275k-line file: slow under a loaded parallel test run
  it('rejects 1D LUTs, wrong counts and garbage', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(/1D/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/not a valid/);
    expect(() => parseCube('hello world')).toThrow(/not a valid/);
    expect(() => parseCube(`LUT_3D_SIZE 2\n${'0 0 x\n'.repeat(8)}`)).toThrow(/not a valid/);
  });
  it('base64 round-trips binary data', () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });
});

describe('effects', () => {
  it('are deterministic and vanish at amount 0', () => {
    const s = seedOf('clip-1');
    expect(seedOf('clip-1')).toBe(s);
    expect(shake(1.23, 1, s)).toEqual(shake(1.23, 1, s));
    expect(Object.values(shake(1.23, 0, s)).every((v) => v === 0)).toBe(true);
    expect(punchScale(0, 0)).toBe(1);
    expect(punchScale(0, 1)).toBeCloseTo(1.18, 5);
    expect(punchScale(0.49, 1)).toBeLessThan(1.01);
  });
});

describe('frame layers for v0.6 looks', () => {
  const setup = (edit: (c: ImageClip) => void) => {
    const p = createProject('p', '9:16');
    const a: Asset = { id: 'a', kind: 'image', name: 'a.png', mime: 'image/png', size: 1, duration: 0, width: 100, height: 100, hasAudio: false };
    p.assets.a = a;
    const c = createImageClip(a, 0);
    edit(c);
    placeClip(p, c);
    p.luts = { L: { name: 'L', size: 2, data: toBase64(new Uint8Array(24)) } };
    return buildFrame(p, 0.5).layers.find((l) => l.id === c.id)!;
  };
  it('maps shader effects, LUTs and hidden areas; zero amounts are no-ops', () => {
    const l = setup((c) => {
      c.effect = { id: 'vhs', amount: 0.5 };
      c.lut = { id: 'L', intensity: 0.7 };
      c.privacy = { faces: true, style: 'pixelate', areas: [{ x: { v: 0.2 }, y: { v: 0.8 }, w: 0.1, h: 0.2 }] };
    });
    expect(l.fx).toMatchObject({ code: 2, amount: 0.5, time: 0.5 });
    expect(l.lut?.intensity).toBe(0.7);
    expect(l.privacy).toEqual({ faces: true, pixelate: true, areas: [[0.2, 0.8, 0.1, 0.2]] });
    const none = setup((c) => { c.effect = { id: 'glitch', amount: 0 }; c.lut = { id: 'missing', intensity: 1 }; });
    expect(none.fx).toBeNull();
    expect(none.lut).toBeNull();
    expect(none.privacy).toBeNull();
  });
  it('shake and zoom punch move the layer instead of using the shader', () => {
    const base = setup(() => undefined);
    const punch = setup((c) => { c.effect = { id: 'zoomPunch', amount: 1 }; });
    expect(punch.fx).toBeNull();
    expect(punch.scale).toBeCloseTo(base.scale * 1.18, 5); // 0.5 s is the start of a punch
  });
});

describe('group operations (multi-select)', () => {
  const setup = () => {
    const p = createProject('g', '9:16');
    const img: Asset = { id: 'i', kind: 'image', name: 'i.png', mime: 'image/png', size: 1, duration: 0, width: 10, height: 10, hasAudio: false };
    p.assets.i = img;
    const main = [0, 1, 2].map(() => createImageClip(img, 0));
    for (const c of main) insertMain(p, c, Infinity);
    const t1 = createTextClip(1, 'a'), t2 = createTextClip(4, 'b');
    placeClip(p, t1);
    placeClip(p, t2);
    return { p, main, t1, t2 };
  };
  const starts = (p: ReturnType<typeof createProject>) => p.tracks.flatMap((t) => t.clips.map((c) => [c.id, c.start] as const));

  it('deletes clips across tracks and closes main-track gaps', () => {
    const { p, main, t1 } = setup();
    deleteClips(p, [main[0].id, t1.id]);
    expect(mainTrack(p).clips.map((c) => c.id)).toEqual([main[1].id, main[2].id]);
    expect(mainTrack(p).clips[0].start).toBe(0);
    expect(findClip(p, t1.id)).toBeNull();
  });
  it('duplicates a group: main copies after the last pick, free copies keep offsets without overlaps', () => {
    const { p, main, t1, t2 } = setup();
    const ids = duplicateClips(p, [main[0].id, main[2].id, t1.id, t2.id]);
    expect(ids).toHaveLength(4);
    expect(mainTrack(p).clips).toHaveLength(5);
    expect(mainTrack(p).clips.slice(3).map((c) => c.id)).toEqual(ids.slice(0, 2));
    const [c1, c2] = ids.slice(2).map((id) => findClip(p, id)!.clip);
    expect(c2.start - c1.start).toBeCloseTo(t2.start - t1.start, 6);
    for (const tr of p.tracks.filter((t) => t.kind !== 'main')) {
      const cs = [...tr.clips].sort((a, b) => a.start - b.start);
      for (let i = 1; i < cs.length; i++) expect(cs[i].start).toBeGreaterThanOrEqual(clipEnd(cs[i - 1]) - 1e-6);
    }
  });
  it('moves free clips together, never before 0, and leaves the main track alone', () => {
    const { p, main, t1, t2 } = setup();
    const before = starts(p);
    moveClipsBy(p, [t1.id, t2.id, main[1].id], 2);
    expect(findClip(p, t1.id)!.clip.start).toBeCloseTo(3, 6);
    expect(findClip(p, t2.id)!.clip.start).toBeCloseTo(6, 6);
    expect(findClip(p, main[1].id)!.clip.start).toBe(before.find(([id]) => id === main[1].id)![1]);
    moveClipsBy(p, [t1.id, t2.id], -10);
    expect(findClip(p, t1.id)!.clip.start).toBe(0);
    expect(findClip(p, t2.id)!.clip.start).toBeCloseTo(3, 6);
  });
});

describe('transitions (v0.7)', () => {
  const layer = () => setupLayer();
  function setupLayer() {
    const p = createProject('t', '9:16');
    const a: Asset = { id: 'a', kind: 'image', name: 'a.png', mime: 'image/png', size: 1, duration: 0, width: 100, height: 100, hasAudio: false };
    p.assets.a = a;
    const c = createImageClip(a, 0);
    placeClip(p, c);
    return buildFrame(p, 0.1).layers.find((l) => l.id === c.id)!;
  }
  const visible = (l: ReturnType<typeof layer>) => l.opacity > 0.5 && (!l.wipe || l.wipe[2] > 0.9) && Math.abs(l.x) < 0.1 && Math.abs(l.y) < 0.1;
  it.each(TRANSITION_TYPES)('%s starts on the outgoing shot and ends on the incoming one', (type) => {
    const a0 = layer(), b0 = layer();
    const dip0 = applyTransition(type, 0.01, a0, b0);
    expect(a0.opacity).toBeGreaterThan(0.5);
    const hidden = b0.opacity * (b0.wipe ? b0.wipe[2] : 1) < 0.5 || Math.abs(b0.x) > 0.9 || Math.abs(b0.y) > 0.9; // or still off-screen (slides)
    expect(hidden, `${type} starts on the outgoing shot`).toBe(true);
    expect(dip0 === null || dip0.opacity < 0.2).toBe(true);
    const a1 = layer(), b1 = layer();
    const dip1 = applyTransition(type, 0.99, a1, b1);
    expect(visible(b1), `${type} ends on the incoming shot`).toBe(true);
    expect(dip1 === null || dip1.opacity < 0.2).toBe(true);
    // Deterministic: same input, same output (WYSIWYG between preview and export).
    const a2 = layer(), b2 = layer();
    applyTransition(type, 0.37, a2, b2);
    const a3 = layer(), b3 = layer();
    applyTransition(type, 0.37, a3, b3);
    const strip = (l: ReturnType<typeof layer>) => ({ ...l, id: '' });
    expect([a3, b3].map(strip)).toEqual([a2, b2].map(strip));
  });
  it('apply to all puts one transition on every cut in one step', () => {
    const p = createProject('t', '9:16');
    const img: Asset = { id: 'i', kind: 'image', name: 'i.png', mime: 'image/png', size: 1, duration: 0, width: 10, height: 10, hasAudio: false };
    p.assets.i = img;
    for (let i = 0; i < 4; i++) insertMain(p, createImageClip(img, 0), Infinity);
    applyTransitionToAll(p, { type: 'circle', duration: 0.4 });
    const cs = mainTrack(p).clips;
    expect(cs[0].kind !== 'audio' && 'transitionIn' in cs[0] ? cs[0].transitionIn : undefined).toBeUndefined();
    expect(cs.slice(1).map((c) => (c.kind === 'image' ? c.transitionIn?.type : null))).toEqual(['circle', 'circle', 'circle']);
    applyTransitionToAll(p, null);
    expect(cs.slice(1).every((c) => c.kind === 'image' && !c.transitionIn)).toBe(true);
  });
});
