// Sweep lane C (docs/21): defects found by the clip-tool checks of the QA matrix, each with the class it belongs to.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createProject, createVideoClip } from './defaults';
import { detachAudio, expectedAudioKey, forwardIn, insertMain, mainTrack, needsSoundJob, reversedSpan } from './timeline';
import type { Asset, Project, VideoClip } from './types';

const asset = (id: string, duration = 6): Asset => ({
  id, kind: 'video', name: id, mime: 'video/mp4', size: 1, duration, width: 1280, height: 720, hasAudio: true,
});
function oneClip(): Project {
  const p = createProject('t', '9:16');
  p.assets = { a: asset('a') };
  return produce(p, (d) => { insertMain(d, createVideoClip(d.assets.a), 0); });
}
const audioClips = (p: Project) => p.tracks.filter((t) => t.kind === 'audio').flatMap((t) => t.clips);

describe('SW-C-1: a clip\'s sound is taken out once', () => {
  it('a second Extract audio on the same clip adds no second copy of the sound', () => {
    let p = oneClip();
    const id = mainTrack(p).clips[0].id;
    let first: string | null = null, second: string | null = 'not run';
    p = produce(p, (d) => { first = detachAudio(d, id); });
    p = produce(p, (d) => { second = detachAudio(d, id); });
    expect(first).not.toBeNull();
    expect(second, 'the sound is already on its own track').toBeNull();
    expect(audioClips(p)).toHaveLength(1);
  });
  it('a clip whose sound is off has none to take out', () => {
    let p = oneClip();
    const id = mainTrack(p).clips[0].id;
    p = produce(p, (d) => { const c = mainTrack(d).clips[0]; if (c.kind === 'video') c.muted = true; });
    let got: string | null = 'not run';
    p = produce(p, (d) => { got = detachAudio(d, id); });
    expect(got).toBeNull();
    expect(audioClips(p)).toHaveLength(0);
  });
});

describe('SW-C-2: a clip reversed and turned back shows its own frames', () => {
  // counter.mp4 as the e2e has it: source 1–6 s at 2× (2.5 s on the timeline), reversed into a file a frame longer than the
  // 5 s range — what the Chromium e2e showed: the clip came back exactly one frame late.
  function reversed(revDuration: number, span?: number): Project {
    let p = createProject('t', '9:16');
    p.assets = { a: asset('a', 6), rev: { ...asset('rev', revDuration) } };
    p = produce(p, (d) => {
      const c = createVideoClip(d.assets.a);
      Object.assign(c, { in: 1, speed: 2, duration: 2.5 });
      insertMain(d, c, 0);
    });
    return produce(p, (d) => {
      const c = mainTrack(d).clips[0];
      if (c.kind !== 'video') return;
      c.reversedFrom = { assetId: 'a', in: c.in, ...(span === undefined ? {} : { span }) };
      c.assetId = 'rev';
      c.in = 0;
    });
  }
  const clip = (p: Project) => mainTrack(p).clips[0] as Extract<Project['tracks'][number]['clips'][number], { kind: 'video' }>;
  it('the range it was reversed from is what it goes back to, however long the reversed file is', () => {
    for (const len of [5, 5 + 1 / 30, 5.0427]) {
      const p = reversed(len, 5);
      expect(forwardIn(p, clip(p)), `reversed file ${len.toFixed(4)} s`).toBe(1);
    }
  });
  it('the range is taken as the reverse takes it: from the in-point, never past the end of the file', () => {
    let p = createProject('t', '9:16');
    p.assets = { a: asset('a', 6) };
    p = produce(p, (d) => { const c = createVideoClip(d.assets.a); Object.assign(c, { in: 1, speed: 2, duration: 2.5 }); insertMain(d, c, 0); });
    expect(reversedSpan(p, clip(p))).toBe(5);
    p = produce(p, (d) => { Object.assign(mainTrack(d).clips[0], { in: 4.5, duration: 2.5 }); }); // 5 s asked, 1.5 s left
    expect(reversedSpan(p, clip(p))).toBe(1.5);
  });
  it('a project reversed before the range was kept, or with a broken one, goes by the reversed file', () => {
    for (const span of [undefined, Number.NaN, -1, 0]) {
      const p = reversed(5, span);
      expect(forwardIn(p, clip(p)), `span ${span}`).toBe(1);
    }
  });
  it('a piece of the reversed clip goes back to its own part of the range', () => {
    let p = reversed(5 + 1 / 30, 5);
    // The second half of the reversed clip (reversed source 2.5–5 s) is the forward source 1–3.5 s.
    p = produce(p, (d) => { Object.assign(mainTrack(d).clips[0], { in: 2.5, duration: 1.25 }); });
    expect(forwardIn(p, clip(p))).toBe(1);
    p = produce(p, (d) => { Object.assign(mainTrack(d).clips[0], { in: 0, duration: 1.25 }); }); // the first half: 3.5–6 s
    expect(forwardIn(p, clip(p))).toBe(3.5);
  });
});

describe('SW-C-4: a clip whose file has no sound needs no sound made', () => {
  const withClip = (hasAudio: boolean, set: Partial<VideoClip>): [Project, VideoClip] => {
    let p = createProject('t', '9:16');
    p.assets = { a: { ...asset('a'), hasAudio } };
    p = produce(p, (d) => { const c = createVideoClip(d.assets.a); Object.assign(c, set); insertMain(d, c, 0); });
    return [p, mainTrack(p).clips[0] as VideoClip];
  };
  it('a silent video at 2× (pitch kept), with noise reduction, enhanced or with a voice: nothing to make', () => {
    for (const set of [{ speed: 2 }, { denoise: true }, { enhance: true }, { voice: 'robot' as const }]) {
      const [p, c] = withClip(false, set);
      expect(expectedAudioKey(c), JSON.stringify(set)).not.toBe('');
      expect(needsSoundJob(p, c), JSON.stringify(set)).toBe(false);
    }
  });
  it('the same settings on a video with sound still make it', () => {
    for (const set of [{ speed: 2 }, { denoise: true }]) {
      const [p, c] = withClip(true, set);
      expect(needsSoundJob(p, c), JSON.stringify(set)).toBe(true);
    }
    const [p, c] = withClip(true, {});
    expect(needsSoundJob(p, c), 'plain settings: the source plays').toBe(false);
  });
});
