import { describe, expect, it } from 'vitest';
import { captionSource } from './captions';
import { createAudioClip, createProject, createVideoClip } from './defaults';
import type { Asset, AudioClip, Project } from './types';

const asset = (id: string, extra: Partial<Asset> = {}): Asset => ({
  id, kind: 'audio', name: id, mime: 'audio/mp4', size: 1, duration: 10, width: 0, height: 0, hasAudio: true, ...extra,
});

/** A talking video on the main track and the given clips on an audio track. */
function project(assets: Asset[], clips: (p: Project) => AudioClip[]): Project {
  const p = createProject('t', '9:16', 0);
  const video = asset('talk', { kind: 'video', mime: 'video/mp4', width: 720, height: 1280 });
  p.assets = Object.fromEntries([video, ...assets].map((a) => [a.id, a]));
  p.tracks[0].clips.push(createVideoClip(video));
  p.tracks.push({ id: 'aud', kind: 'audio', clips: clips(p) });
  return p;
}
const heard = (p: Project) => captionSource(p).tracks.flatMap((t) => t.clips.map((c) => (c.kind === 'audio' || c.kind === 'video' ? c.assetId : '')));

describe('what captions listen to (v1.4.1)', () => {
  it('leaves out library music, ducked music and guide tracks; keeps the voice', () => {
    const lib = asset('lib', { library: { id: 'x', title: 'Calm', artist: 'A', license: 'CC0', licenseUrl: '', source: '' } });
    const song = asset('song'), guide = asset('trend'), voice = asset('voiceover');
    const p = project([lib, song, guide, voice], (q) => [
      createAudioClip(q.assets.lib),
      { ...createAudioClip(q.assets.song), duck: 0.7 },
      { ...createAudioClip(q.assets.trend), guide: true },
      createAudioClip(q.assets.voiceover),
    ]);
    expect(heard(p)).toEqual(['talk', 'voiceover']);
    expect(p.tracks[1].clips).toHaveLength(4); // the project itself is untouched
  });

  it('returns the same project when there is no background sound', () => {
    const p = project([asset('voiceover')], (q) => [createAudioClip(q.assets.voiceover)]);
    expect(captionSource(p)).toBe(p);
  });

  it('keeps the whole mix when the music is all there is to hear (a muted video under a song)', () => {
    const p = project([asset('song')], (q) => [{ ...createAudioClip(q.assets.song), duck: 0.5 }]);
    const video = p.tracks[0].clips[0];
    if (video.kind === 'video') video.muted = true;
    expect(captionSource(p)).toBe(p);
  });
});
