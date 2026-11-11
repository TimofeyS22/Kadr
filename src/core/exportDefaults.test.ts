// What an export starts with (audit V-216): the video's own frame rate and size, as far as the encoder goes.
import { describe, expect, it } from 'vitest';
import { createImageClip, createProject, createVideoClip } from './defaults';
import { LONG_EXPORT_S, estimateMb, exportCost, exportDefaults, exportNotes, exportSource, isFast } from './exportDefaults';
import { mainTrack } from './timeline';
import type { Asset, AspectId, Project } from './types';

type Size = 720 | 1080 | 1440 | 2160;
const ALL: Size[] = [720, 1080, 1440, 2160];

let n = 0;
function video(width: number, height: number, fps?: number): Asset {
  return { id: `v${n++}`, kind: 'video', name: 'v.mp4', mime: 'video/mp4', size: 1, duration: 6, width, height, hasAudio: true, ...(fps === undefined ? {} : { fps }) };
}
const photo = (): Asset => ({ id: `i${n++}`, kind: 'image', name: 'p.jpg', mime: 'image/jpeg', size: 1, duration: 0, width: 8064, height: 6048, hasAudio: false });

function project(aspect: AspectId, ...assets: Asset[]): Project {
  const p = createProject('x', aspect);
  for (const a of assets) {
    p.assets[a.id] = a;
    mainTrack(p).clips.push(a.kind === 'image' ? createImageClip(a) : createVideoClip(a));
  }
  return p;
}

describe('frame rate', () => {
  it('a 60 fps video starts at 60 when the encoder takes its size at 60', () => {
    expect(exportDefaults(project('9:16', video(720, 1280, 60)), ALL, ALL)).toEqual({ resolution: 720, fps: 60 });
  });

  it('and at 30 when the encoder does not: the sheet then says what is lost and why', () => {
    const p = project('9:16', video(1080, 1920, 60));
    expect(exportDefaults(p, ALL, [720])).toEqual({ resolution: 1080, fps: 30 }); // 60 only at a smaller size: the size is kept
    expect(exportDefaults(p, ALL, [])).toEqual({ resolution: 1080, fps: 30 });
    expect(exportCost(exportSource(p), 1080, 30, [720])).toEqual({ frames: { from: 60, half: true }, no60: true, larger: false });
    expect(exportCost(exportSource(p), 720, 30, [720]).no60, 'at 720p it is a choice, not the encoder').toBe(false);
    expect(exportCost(exportSource(p), 1080, 30, null).no60, 'an encoder that was not asked is not blamed').toBe(false);
    expect(exportCost(exportSource(p), 1080, 60, ALL)).toEqual({ no60: false, larger: false });
  });

  it('30 and 60 fps videos together: 60, so that none of them loses frames', () => {
    const p = project('9:16', video(1080, 1920, 30), video(1080, 1920, 60), video(1080, 1920, 30));
    expect(exportDefaults(p, ALL, ALL).fps).toBe(60);
    expect(exportCost(exportSource(p), 1080, 30, ALL).frames).toEqual({ from: 60, half: true });
  });

  it('a 30 fps video stays at 30', () => {
    const p = project('16:9', video(1280, 720, 30));
    expect(exportDefaults(p, ALL, ALL)).toEqual({ resolution: 720, fps: 30 });
    expect(exportCost(exportSource(p), 720, 30, null)).toEqual({ no60: false, larger: false });
    expect(exportCost(exportSource(p), 720, 24, null).frames).toEqual({ from: 30, half: false });
  });

  it('a frame rate nobody measured (an old project) is exported at 30 and not talked about', () => {
    const p = project('9:16', video(1080, 1920));
    expect(exportSource(p)).toEqual({ fps: null, side: 1080 });
    expect(isFast(exportSource(p))).toBe(false);
    expect(exportDefaults(p, ALL, ALL)).toEqual({ resolution: 1080, fps: 30 });
    expect(exportCost(exportSource(p), 1080, 24, ALL).frames, 'no claim about a rate that is not known').toBeUndefined();
    // A number that is not one (a damaged backup) is no measurement either.
    const bad = project('9:16', { ...video(1080, 1920), fps: Number.NaN }, { ...video(1080, 1920), fps: -60 }, { ...video(1080, 1920), fps: Infinity });
    expect(exportSource(bad)?.fps).toBeNull();
    // One measured video among unmeasured ones is what is known.
    expect(exportDefaults(project('9:16', video(1080, 1920), video(1080, 1920, 60)), ALL, ALL).fps).toBe(60);
  });

  it('camera rates: 59.94 is 60, 50 goes to 60, 29.97 at 30 loses nothing', () => {
    expect(exportDefaults(project('9:16', video(1080, 1920, 59.94)), ALL, ALL).fps).toBe(60);
    expect(exportDefaults(project('9:16', video(1080, 1920, 50)), ALL, ALL).fps).toBe(60);
    expect(exportDefaults(project('9:16', video(1080, 1920, 48)), ALL, ALL).fps).toBe(30);
    expect(exportCost({ fps: 29.97, side: 1080 }, 1080, 30, ALL).frames).toBeUndefined();
    expect(exportCost({ fps: 59.94, side: 1080 }, 1080, 60, ALL).frames).toBeUndefined();
    expect(exportCost({ fps: 59.94, side: 1080 }, 1080, 30, ALL).frames).toEqual({ from: 60, half: true });
    expect(exportCost({ fps: 50, side: 1080 }, 1080, 30, ALL).frames).toEqual({ from: 50, half: false });
    // A variable frame rate file measured at the rate of most of its frames (fixtures/vfr.mp4 gives 57.27).
    expect(exportDefaults(project('16:9', video(640, 360, 57.27)), ALL, ALL)).toEqual({ resolution: 720, fps: 60 });
    expect(exportCost({ fps: 57.27, side: 360 }, 720, 30, ALL).frames).toEqual({ from: 57, half: false });
  });

  it('a frame rate set for the project is a choice and stays, 30 too; an untouched 30 is not', () => {
    const p = project('9:16', video(1080, 1920, 60));
    p.settings.fps = 24;
    expect(exportDefaults(p, ALL, ALL).fps).toBe(24);
    p.settings.fps = 60; // set before the mark existed: any rate but the one a project is created with was picked
    expect(exportDefaults(p, ALL, []).fps).toBe(60);
    p.settings.fps = 30;
    expect(exportDefaults(p, ALL, ALL).fps).toBe(60);
    p.settings.fpsSet = true;
    expect(exportDefaults(p, ALL, ALL).fps).toBe(30);
  });

  it('a slowed 60 fps video shows 30 of its frames a second: 30 loses nothing; sped up, it counts as shot', () => {
    const p = project('9:16', video(1080, 1920, 60));
    const clip = mainTrack(p).clips[0];
    if (clip.kind !== 'video') throw new Error('a video clip');
    clip.speed = 0.5;
    expect(exportSource(p)?.fps).toBe(30);
    expect(exportDefaults(p, ALL, ALL).fps).toBe(30);
    expect(exportCost(exportSource(p), 1080, 30, ALL).frames).toBeUndefined();
    clip.curve = [1, 4, 1]; // a ramp that runs at 2× in the middle
    expect(exportSource(p)?.fps).toBe(60);
    clip.curve = undefined;
    clip.speed = 3;
    expect(exportSource(p)?.fps).toBe(60);
  });

  it('only the main track counts', () => {
    const p = project('9:16', video(1080, 1920, 30));
    const over = video(3840, 2160, 60);
    p.assets[over.id] = over;
    p.tracks.push({ id: 'o', kind: 'overlay', clips: [createVideoClip(over)] });
    expect(exportDefaults(p, ALL, ALL)).toEqual({ resolution: 1080, fps: 30 });
  });
});

describe('size', () => {
  it('a 720p video starts at 720p, not blown up to 1080p', () => {
    expect(exportDefaults(project('16:9', video(1280, 720, 30)), ALL, ALL).resolution).toBe(720);
    expect(exportDefaults(project('9:16', video(720, 1280, 30)), ALL, ALL).resolution).toBe(720);
  });

  it('a 4K or 2K video starts at 1080p (owner, 2026-11-11): 4K is a tap away, and a larger size picked before is kept', () => {
    const p = project('16:9', video(3840, 2160, 30));
    expect(exportDefaults(p, ALL, ALL).resolution).toBe(1080);
    expect(exportDefaults(project('9:16', video(2160, 3840, 30)), ALL, ALL).resolution).toBe(1080);
    expect(exportDefaults(project('16:9', video(2560, 1440, 30)), ALL, ALL).resolution).toBe(1080);
    expect(exportDefaults(p, ALL, ALL, 2160).resolution).toBe(2160);
    expect(exportDefaults(p, ALL, ALL, 1440).resolution).toBe(1440);
    expect(exportDefaults(p, [720], []).resolution, 'or the largest the encoder takes').toBe(720);
  });

  it('several videos: the largest decides', () => {
    expect(exportDefaults(project('16:9', video(1280, 720, 30), video(1920, 1080, 30)), ALL, ALL).resolution).toBe(1080);
  });

  it('a size between two options: the one below', () => {
    expect(exportDefaults(project('16:9', video(2304, 1296, 30)), ALL, ALL).resolution).toBe(1080);
  });

  it('a video smaller than every size: the smallest, and the sheet says it is larger than the source', () => {
    const p = project('16:9', video(640, 360, 30));
    expect(exportDefaults(p, ALL, ALL).resolution).toBe(720);
    expect(exportCost(exportSource(p), 720, 30, null).larger).toBe(true);
    expect(exportCost(exportSource(project('16:9', video(1280, 720, 30))), 720, 30, null).larger).toBe(false);
    expect(exportCost(exportSource(project('16:9', video(1280, 720, 30))), 1080, 30, null).larger).toBe(true);
  });

  it('a video across the canvas is measured along the side it touches', () => {
    // 1280×720 inside 9:16 is 1280 wide only in a file 1280 wide: 1080 still shrinks it, 1440 would enlarge it.
    const p = project('9:16', video(1280, 720, 30));
    expect(exportSource(p)?.side).toBe(1280);
    expect(exportDefaults(p, ALL, ALL).resolution).toBe(1080);
    expect(exportCost(exportSource(p), 1080, 30, null).larger).toBe(false);
    expect(exportCost(exportSource(p), 1440, 30, null).larger).toBe(true);
  });

  it('photos only: the default it always had, and nothing to compare with', () => {
    const p = project('9:16', photo(), photo());
    expect(exportSource(p)).toBeNull();
    expect(exportDefaults(p, ALL, ALL)).toEqual({ resolution: 1080, fps: 30 });
    expect(exportDefaults(p, [720], [])).toEqual({ resolution: 720, fps: 30 });
    expect(exportDefaults(p, ALL, ALL, 2160).resolution).toBe(2160);
    expect(exportDefaults(p, ALL, ALL, 720).resolution).toBe(720);
    expect(exportCost(null, 2160, 24, ALL)).toEqual({ no60: false, larger: false });
    // Photos beside a video do not raise the size: the video decides.
    expect(exportDefaults(project('9:16', photo(), video(720, 1280, 30)), ALL, ALL).resolution).toBe(720);
  });

  it('an encoder that takes nothing: no size, the sheet says so', () => {
    expect(exportDefaults(project('9:16', video(1080, 1920, 60)), [], []).resolution).toBeUndefined();
  });
});

describe('a size picked at an earlier export', () => {
  it('does not blow up a smaller video', () => {
    expect(exportDefaults(project('16:9', video(1280, 720, 30)), ALL, ALL, 1080).resolution).toBe(720);
    expect(exportDefaults(project('16:9', video(1280, 720, 30)), ALL, ALL, 2160).resolution).toBe(720);
  });

  it('holds a larger video down: smaller files were asked for', () => {
    expect(exportDefaults(project('16:9', video(3840, 2160, 30)), ALL, ALL, 1080).resolution).toBe(1080);
    expect(exportDefaults(project('16:9', video(1920, 1080, 30)), ALL, ALL, 720).resolution).toBe(720);
  });

  it('that this device no longer encodes: the largest below it', () => {
    expect(exportDefaults(project('16:9', video(3840, 2160, 30)), [720, 1080], [], 1440).resolution).toBe(1080);
  });

  it('decides the size before the frame rate: 60 only if the encoder takes that size at 60', () => {
    const p = project('16:9', video(3840, 2160, 60));
    expect(exportDefaults(p, ALL, [720, 1080], 1080)).toEqual({ resolution: 1080, fps: 60 });
    expect(exportDefaults(p, ALL, [720, 1080]), 'nothing picked: 1080p keeps every frame').toEqual({ resolution: 1080, fps: 60 });
    expect(exportDefaults(p, ALL, [720, 1080], 2160), '4K picked: the sheet says frames are dropped').toEqual({ resolution: 2160, fps: 30 });
  });
});


describe('what is said before an export (S-1-5)', () => {
  it('the size estimate follows size, quality, frame rate and length', () => {
    expect(estimateMb(1080, 30, 'standard', 8)).toBeCloseTo(10, 6); // 10 Mbit/s × 8 s
    expect(estimateMb(1080, 60, 'high', 60)).toBeCloseTo(10 * 1.5 * 1.4 * 60 / 8, 6);
    expect(estimateMb(2160, 30, 'standard', 3600)).toBeCloseTo(35 * 3600 / 8, 6);
  });
  it('a ten-hour video is long, and its file does not fit in 2 GB; a short one is neither', () => {
    const mb = estimateMb(1080, 30, 'high', 36000);
    expect(exportNotes(36000, mb, 2000)).toEqual({ long: true, room: true });
    expect(exportNotes(30, estimateMb(1080, 30, 'high', 30), 2000)).toEqual({ long: false, room: false });
    expect(exportNotes(LONG_EXPORT_S, 1, null)).toEqual({ long: false, room: false });
    expect(exportNotes(LONG_EXPORT_S + 1, 1, null).long).toBe(true);
  });
});
