// Verification of audit V-154 (docs/21 §5): the "Slideshow" card promised music ("music fades out at the end"), but
// music comes only from a file the person picks with the photos; without one the video came out silent, and nothing
// had said so. A template card may promise music only as the person's pick when the template's music is optional.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { RU } from '../lib/locale-ru';
import { createProject } from './defaults';
import { TEMPLATES, buildTemplate } from './templates';
import type { Asset } from './types';

const photo = (id: string): Asset => ({ id, kind: 'image', name: `${id}.jpg`, mime: 'image/jpeg', size: 1, duration: 0, width: 1080, height: 1920, hasAudio: false });
const song: Asset = { id: 'm', kind: 'audio', name: 'song.mp3', mime: 'audio/mpeg', size: 1, duration: 60, width: 0, height: 0, hasAudio: true };
const hasSound = (p: ReturnType<typeof createProject>) => p.tracks.some((tr) => tr.clips.some((c) => c.kind === 'audio'));

describe('a template card says what the video will have (audit V-154)', () => {
  it('the slideshow has music only from a file the person picks, and its card says so', () => {
    const slideshow = TEMPLATES.find((t) => t.id === 'slideshow')!;
    const build = (music?: Asset) => {
      const p0 = createProject('s', slideshow.aspect);
      const pics = [photo('a'), photo('b'), photo('c')];
      p0.assets = Object.fromEntries([...pics, ...(music ? [music] : [])].map((a) => [a.id, a]));
      return produce(p0, (d) => { buildTemplate(d, 'slideshow', pics, music); });
    };
    // What the builder does: photos alone give a silent video; with a music file it is under the photos.
    expect(hasSound(build()), 'photos alone').toBe(false);
    expect(hasSound(build(song)), 'photos and a song').toBe(true);
    // So the card may not promise music as a given: it says to pick the file.
    expect(slideshow.music).toBe('optional');
    expect(slideshow.description).toMatch(/\b(pick|choose|select)\b[^.]*\bmusic\b/i);
    expect(RU[slideshow.description], 'the Russian card').toMatch(/Выберите[^.]*музык/);
  });

  it('no card with optional music promises it as a given', () => {
    for (const t of TEMPLATES.filter((x) => x.music === 'optional' && /music/i.test(x.description))) {
      expect(t.description, t.id).toMatch(/\b(pick|choose|select)\b[^.]*\bmusic\b/i);
    }
  });
});
