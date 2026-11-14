// Sweep lane C (docs/21): defects found by the clip-tool checks of the QA matrix, each with the class it belongs to.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { createProject, createVideoClip } from './defaults';
import { detachAudio, insertMain, mainTrack } from './timeline';
import type { Asset, Project } from './types';

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

