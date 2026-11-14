// Sweep lane C (docs/21): defects found by the clip-tool checks of the QA matrix, each with the class it belongs to.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createProject, createVideoClip } from './defaults';
import { detachAudio, expectedAudioKey, insertMain, mainTrack, needsSoundJob } from './timeline';
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
