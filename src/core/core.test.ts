import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { evalAnim, splitAnim, toggleKey, setAnim } from './anim';
import { createImageClip, createProject, createTextClip, createVideoClip } from './defaults';
import { buildFrame } from './frame';
import { resolveAdjust } from './filters';
import {
  deleteClip, detachAudio, duplicateClip, findClip, insertMain, mainTrack, moveClip, placeClip, projectDuration,
  reorderMain, setSpeed, setTransition, splitClip, trimClip,
} from './timeline';
import { defaultAdjust } from './defaults';
import type { Anim, Asset, Project, VideoClip } from './types';

const asset = (id: string, duration = 10): Asset => ({
  id, kind: 'video', name: id, mime: 'video/mp4', size: 1, duration, width: 1920, height: 1080, hasAudio: true,
});

function twoClips(): Project {
  const p = createProject('t', '9:16');
  p.assets = { a: asset('a'), b: asset('b', 6) };
  return produce(p, (d) => { insertMain(d, createVideoClip(d.assets.a), 0); insertMain(d, createVideoClip(d.assets.b), 99); });
}
const edit = (p: Project, fn: (d: Project) => void) => produce(p, fn);
const clips = (p: Project) => mainTrack(p).clips;

describe('anim', () => {
  it('interpolates with easing and clamps outside keys', () => {
    const a = { v: 0, k: [{ t: 0, v: 0 }, { t: 1, v: 10, e: 'in' as const }, { t: 2, v: 20 }] };
    expect(evalAnim(a, -1)).toBe(0);
    expect(evalAnim(a, 0.5)).toBe(5);
    expect(evalAnim(a, 1.5)).toBeCloseTo(12.5);
    expect(evalAnim(a, 5)).toBe(20);
  });
  it('toggleKey adds then removes; setAnim writes keyframe only when animated', () => {
    const a: Anim = { v: 3 };
    setAnim(a, 1, 4);
    expect(a).toEqual({ v: 4 });
    expect(toggleKey(a, 1)).toBe(true);
    setAnim(a, 2, 8);
    expect(evalAnim(a, 1.5)).toBe(6);
    expect(toggleKey(a, 2)).toBe(false);
    expect(a.k?.length).toBe(1);
  });
  it('splitAnim keeps the value continuous at the cut', () => {
    const [l, r] = splitAnim({ v: 0, k: [{ t: 0, v: 0 }, { t: 2, v: 2 }] }, 1);
    expect(evalAnim(l, 1)).toBe(1);
    expect(evalAnim(r, 0)).toBe(1);
    expect(evalAnim(r, 1)).toBe(2);
  });
});

describe('timeline', () => {
  it('packs main clips back to back', () => {
    const p = twoClips();
    expect(clips(p).map((c) => [c.start, c.duration])).toEqual([[0, 10], [10, 6]]);
    expect(projectDuration(p)).toBe(16);
  });

  it('split maps source in-point and keeps total duration', () => {
    const p = twoClips();
    const id = clips(p)[0].id;
    const q = edit(p, (d) => { splitClip(d, id, 4); });
    const [l, r] = clips(q) as VideoClip[];
    expect([l.duration, r.start, r.duration, r.in]).toEqual([4, 4, 6, 4]);
    expect(projectDuration(q)).toBe(16);
  });

  it('split rejects cuts that would create sub-minimum clips', () => {
    const p = twoClips();
    const id = clips(p)[0].id;
    expect(produce(p, (d) => { expect(splitClip(d, id, 0.05)).toBeNull(); })).toBe(p);
  });

  it('trim start on main ripples later clips; trim end is capped by source', () => {
    const p = twoClips();
    const [a, b] = clips(p);
    const q = edit(p, (d) => { trimClip(d, a.id, 'start', 3); trimClip(d, b.id, 'end', 999); });
    const [qa, qb] = clips(q) as VideoClip[];
    expect([qa.start, qa.in, qa.duration]).toEqual([0, 3, 7]);
    expect([qb.start, qb.duration]).toEqual([7, 6]);
  });

  it('transitions overlap clips and are clamped to half the shorter clip', () => {
    const p = edit(twoClips(), (d) => { setTransition(d, clips(d)[1].id, { type: 'fade', duration: 10 }); });
    const b = clips(p)[1] as VideoClip;
    expect(b.transitionIn?.duration).toBe(3);
    expect(b.start).toBe(7);
    expect(projectDuration(p)).toBe(13);
  });

  it('speed scales duration and keyframe times', () => {
    const p = edit(twoClips(), (d) => {
      const c = clips(d)[0] as VideoClip;
      c.transform.x = { v: 0, k: [{ t: 0, v: 0 }, { t: 8, v: 1 }] };
      setSpeed(d, c.id, 2);
    });
    const c = clips(p)[0] as VideoClip;
    expect(c.duration).toBe(5);
    expect(c.transform.x.k?.[1].t).toBe(4);
    expect(clips(p)[1].start).toBe(5);
  });

  it('reorder, duplicate and delete keep the track packed', () => {
    let p = twoClips();
    const [a, b] = clips(p);
    p = edit(p, (d) => { reorderMain(d, b.id, 0); });
    expect(clips(p).map((c) => c.id)).toEqual([b.id, a.id]);
    p = edit(p, (d) => { duplicateClip(d, b.id); });
    expect(clips(p).map((c) => c.start)).toEqual([0, 6, 12]);
    p = edit(p, (d) => { deleteClip(d, b.id); });
    expect(clips(p).map((c) => c.start)).toEqual([0, 6]);
  });

  it('overlay clips never overlap on one track', () => {
    let p = twoClips();
    p = edit(p, (d) => { placeClip(d, { ...createTextClip(1), id: 't1' }); placeClip(d, { ...createTextClip(2), id: 't2' }); });
    const overlays = p.tracks.filter((t) => t.kind === 'overlay');
    expect(overlays.length).toBe(2);
    p = edit(p, (d) => { moveClip(d, 't2', 5, overlays[0].id); });
    expect(p.tracks.filter((t) => t.kind === 'overlay').length).toBe(1);
    expect(findClip(p, 't2')?.clip.start).toBe(5);
  });

  it('detachAudio mutes the video and adds a matching audio clip', () => {
    const p = twoClips();
    const v = clips(p)[0];
    let aid: string | null = null;
    const q = edit(p, (d) => { aid = detachAudio(d, v.id); });
    expect((clips(q)[0] as VideoClip).muted).toBe(true);
    const a = findClip(q, aid!)!;
    expect([a.track.kind, a.clip.start, a.clip.duration]).toEqual(['audio', 0, 10]);
  });

  it('images can be extended; text split disables inner animations', () => {
    let p = createProject('t', '1:1');
    p.assets = { img: { ...asset('img', 0), kind: 'image' } };
    p = edit(p, (d) => { insertMain(d, createImageClip(d.assets.img), 0); });
    const id = clips(p)[0].id;
    p = edit(p, (d) => { trimClip(d, id, 'end', 12); });
    expect(clips(p)[0].duration).toBe(12);
    const plain = createTextClip(0);
    expect([plain.animIn.type, plain.animOut.type]).toEqual(['none', 'none']); // new text has no effects
    p = edit(p, (d) => { placeClip(d, { ...createTextClip(0), id: 'tx', animIn: { type: 'fade', duration: 0.3 }, animOut: { type: 'fade', duration: 0.3 } }); splitClip(d, 'tx', 1); });
    const texts = p.tracks.find((t) => t.kind === 'overlay')!.clips;
    expect(texts.map((c) => c.kind === 'text' && [c.animIn.type, c.animOut.type])).toEqual([['fade', 'none'], ['none', 'fade']]);
  });
});

describe('buildFrame', () => {
  it('maps timeline time to source time with speed', () => {
    const p = edit(twoClips(), (d) => { setSpeed(d, clips(d)[0].id, 2); });
    const f = buildFrame(p, 1);
    expect(f.layers[0].source).toMatchObject({ kind: 'video', time: 2 });
  });

  it('crossfade renders both clips with incoming opacity = progress', () => {
    const p = edit(twoClips(), (d) => { setTransition(d, clips(d)[1].id, { type: 'fade', duration: 2 }); });
    const f = buildFrame(p, 9); // transition runs 8..10
    expect(f.layers.map((l) => l.opacity)).toEqual([1, 0.5]);
  });

  it('dip to black adds a solid layer peaking at the midpoint', () => {
    const p = edit(twoClips(), (d) => { setTransition(d, clips(d)[1].id, { type: 'black', duration: 2 }); });
    const f = buildFrame(p, 9);
    expect(f.layers.at(-1)).toMatchObject({ source: { kind: 'solid' }, opacity: 1 });
  });

  it('blur background adds a cover layer under the main clip', () => {
    const p = edit(twoClips(), (d) => { d.settings.background.mode = 'blur'; });
    const f = buildFrame(p, 1);
    expect(f.layers.map((l) => [l.id === '__bg', l.fit])).toEqual([[true, 'cover'], [false, 'contain']]);
  });

  it('filters add to manual adjustments within range', () => {
    const adj = { ...defaultAdjust(), saturation: 0.8 };
    expect(resolveAdjust(adj, { id: 'vivid', intensity: 1 }).saturation).toBe(1);
    expect(resolveAdjust(adj, { id: 'mono', intensity: 0.5 }).saturation).toBeCloseTo(0.3);
  });
});
