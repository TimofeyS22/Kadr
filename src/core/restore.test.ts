import { describe, expect, it } from 'vitest';
import { createImageClip, createProject, createTextClip } from './defaults';
import { toBase64 } from './lut';
import { dropDamagedClips, repairBackup } from './restore';
import type { Asset, Project } from './types';

const photo: Asset = { id: 'a1', kind: 'image', name: 'p.png', mime: 'image/png', size: 1, duration: 0, width: 100, height: 100, hasAudio: false } as Asset;

function project(): Project {
  const p = createProject('Test', '9:16');
  p.assets[photo.id] = photo;
  p.tracks[0].clips.push(createImageClip(photo, 0, 3), createImageClip(photo, 3, 3));
  p.tracks.push({ id: 'o', kind: 'overlay', clips: [createTextClip(0, 'Hi')] });
  return p;
}

describe('dropDamagedClips (a backup is not trusted)', () => {
  it('keeps a whole project as it is', () => {
    const p = project(), before = JSON.stringify(p);
    expect(dropDamagedClips(p)).toBe(0);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('leaves out clips with impossible times, unknown kinds and missing parts, and counts them', () => {
    const p = project();
    const main = p.tracks[0].clips as unknown as Record<string, unknown>[];
    main[0].duration = -5;
    delete main[1].start;
    main.push({ kind: 'hologram', id: 'h' }, null as never, { ...main[1], start: 0, duration: Number.NaN } as never);
    const text = p.tracks[1].clips[0] as unknown as Record<string, unknown>;
    text.style = null;
    expect(dropDamagedClips(p)).toBe(6);
    expect(p.tracks.every((t) => t.clips.length === 0)).toBe(true);
  });

  it('leaves out a track of an unknown kind with its clips, and a clip without its look', () => {
    const p = project();
    p.tracks.push({ id: 'x', kind: 'text' as never, clips: [createTextClip(0, 'A'), createTextClip(1, 'B')] });
    delete (p.tracks[0].clips[0] as unknown as Record<string, unknown>).adjust;
    expect(dropDamagedClips(p)).toBe(3);
    expect(p.tracks.map((t) => t.kind)).toEqual(['main', 'overlay']);
    expect(p.tracks[0].clips).toHaveLength(1);
  });
});

describe('repairBackup (the rest of a backup is not trusted either)', () => {
  const lut = (size: number, bytes = size ** 3 * 3) => ({ name: 'L', size, data: toBase64(new Uint8Array(bytes)) });

  it('keeps a whole project as it is, with a LUT and a font', () => {
    const p = project();
    p.luts = { good: lut(2) };
    p.fonts = { f: { name: 'Mine', blobId: 'b' } };
    (p.tracks[0].clips[0] as { lut?: unknown }).lut = { id: 'good', intensity: 0.5 };
    const before = JSON.stringify(p);
    expect(repairBackup(p)).toBe(0);
    expect(JSON.stringify(p)).toBe(before);
  });

  it('makes the canvas one the app can make', () => {
    const p = project();
    Object.assign(p.settings, { aspect: '7:3', width: 100_000, height: -1, fps: 0, background: { mode: 'disco', color: 'url(x)' } });
    repairBackup(p);
    expect(p.settings).toEqual({ aspect: '9:16', width: 1080, height: 1920, fps: 30, background: { mode: 'color', color: '#000000' } });
  });

  it('leaves out LUTs that do not decode or do not fit their size, and the looks that point at them', () => {
    const p = project();
    p.luts = { bad: { name: 'x', size: 33, data: 'not base64 at all!' }, short: lut(4, 10), huge: lut(65), good: lut(3) };
    const [a, b] = p.tracks[0].clips as { lut?: unknown }[];
    a.lut = { id: 'bad', intensity: 1 };
    b.lut = { id: 'good', intensity: Number.NaN };
    expect(repairBackup(p)).toBe(3);
    expect(Object.keys(p.luts)).toEqual(['good']);
    expect(a.lut).toBeUndefined();
    expect(b.lut).toBeUndefined();
  });

  it('leaves out media with impossible numbers (their clips go with them later) and fonts without a file', () => {
    const p = project();
    p.assets.v = { ...photo, id: 'v', kind: 'video', duration: -1 };
    p.assets.z = { ...photo, id: 'z', width: 0 };
    p.assets.w = { ...photo, id: 'other' };
    p.fonts = { f: { name: 'Mine' } as never };
    repairBackup(p);
    expect(Object.keys(p.assets)).toEqual([photo.id]);
    expect(p.fonts).toEqual({});
  });
});
