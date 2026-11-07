import { describe, expect, it } from 'vitest';
import { buildFrame } from './frame';
import { lineWords, lowerStart } from './captions';
import { createCaptionClip, createImageClip, createProject, createTextClip, createVideoClip } from './defaults';
import { CAPTION_PRESETS } from './presets';
import { layerPlace, moveClip, moveLayer, placeClip } from './timeline';
import type { Asset, Project } from './types';

const asset = (id: string, kind: Asset['kind'] = 'video'): Asset => ({
  id, kind, name: id, mime: kind === 'image' ? 'image/png' : 'video/mp4', size: 1, duration: kind === 'image' ? 0 : 30, width: 720, height: 1280, hasAudio: false,
});

/** A 30 s video on the main track and captions over all of it. */
function withCaptions(): { p: Project; captionId: string } {
  const p = createProject('t', '9:16', 0);
  for (const a of [asset('main'), asset('broll'), asset('photo', 'image')]) p.assets[a.id] = a;
  p.tracks[0].clips.push(createVideoClip(p.assets.main));
  const cap = createCaptionClip([{ t0: 0, t1: 29, text: 'Привет' }], CAPTION_PRESETS[0]);
  placeClip(p, cap);
  return { p, captionId: cap.id };
}
const drawn = (p: Project, t: number) => buildFrame(p, t).layers.map((l) => l.source.kind);

describe('layers (v1.6): an overlay lies under the captions', () => {
  it('a video or photo added after the captions is drawn under them', () => {
    const { p } = withCaptions();
    placeClip(p, createVideoClip(p.assets.broll, 5));
    placeClip(p, createImageClip(p.assets.photo, 6));
    expect(drawn(p, 7)).toEqual(['video', 'video', 'image', 'caption']);
  });

  it('a picture still goes over text when nothing with words is there yet, and text added later goes on top', () => {
    const p = createProject('t', '9:16', 0);
    p.assets.main = asset('main');
    p.assets.broll = asset('broll');
    p.tracks[0].clips.push(createVideoClip(p.assets.main));
    placeClip(p, createVideoClip(p.assets.broll, 0));
    placeClip(p, createTextClip(1));
    expect(drawn(p, 2)).toEqual(['video', 'video', 'text']);
  });

  it('moving an overlay in time keeps it under the captions', () => {
    const { p } = withCaptions();
    const b = createVideoClip(p.assets.broll, 0);
    placeClip(p, b);
    moveClip(p, b.id, 12);
    expect(drawn(p, 13)).toEqual(['video', 'video', 'caption']);
  });

  it('Layers moves a clip over and under the clips it shares the screen with, and says when there is nothing to pass', () => {
    const { p, captionId } = withCaptions();
    const b = createVideoClip(p.assets.broll, 5);
    placeClip(p, b);
    expect(layerPlace(p, b.id)).toEqual({ above: 1, below: 0 });
    expect(moveLayer(p, b.id, 'down')).toBe(false); // the main video is the base, not a layer
    expect(moveLayer(p, b.id, 'front')).toBe(true);
    expect(drawn(p, 7)).toEqual(['video', 'caption', 'video']);
    expect(layerPlace(p, b.id)).toEqual({ above: 0, below: 1 });
    expect(moveLayer(p, b.id, 'up')).toBe(false);
    expect(moveLayer(p, captionId, 'front')).toBe(true);
    expect(drawn(p, 7)).toEqual(['video', 'video', 'caption']);
    expect(p.tracks.every((t) => t.kind === 'main' || t.clips.length)).toBe(true); // no empty tracks left behind
  });

  it('up and down pass one clip at a time; clips at other times do not count', () => {
    const { p } = withCaptions();
    const a = createImageClip(p.assets.photo, 5, 4), b = createImageClip(p.assets.photo, 5, 4), far = createImageClip(p.assets.photo, 20, 2);
    for (const c of [a, b, far]) placeClip(p, c);
    expect(layerPlace(p, a.id)).toEqual({ above: 2, below: 0 }); // b and the captions
    expect(moveLayer(p, a.id, 'up')).toBe(true);
    expect(layerPlace(p, a.id)).toEqual({ above: 1, below: 1 });
    expect(moveLayer(p, a.id, 'up')).toBe(true);
    expect(layerPlace(p, a.id)).toEqual({ above: 0, below: 2 });
    expect(moveLayer(p, a.id, 'back')).toBe(true);
    expect(layerPlace(p, a.id)).toEqual({ above: 2, below: 0 });
    expect(layerPlace(p, far.id)).toEqual({ above: 1, below: 0 });
  });
});

describe('caption lines start with a small letter (v1.6)', () => {
  it('lowers the first letter, keeps abbreviations, "I" and quotes', () => {
    expect(lowerStart('Привет,')).toBe('привет,');
    expect(lowerStart('«Когда')).toBe('«когда');
    expect(lowerStart('МГУ')).toBe('МГУ');
    expect(lowerStart('NASA')).toBe('NASA');
    expect(lowerStart('I')).toBe('I');
    expect(lowerStart("I'm")).toBe("I'm");
    expect(lowerStart('It')).toBe('it');
    expect(lowerStart('Я')).toBe('я');
    expect(lowerStart('15')).toBe('15');
    expect(lowerStart('ёлка')).toBe('ёлка');
  });

  it('applies to the first word of a line only, and only when the clip asks for it', () => {
    expect(lineWords({ lowerStart: true }, ['Сегодня', 'Москва'])).toEqual(['сегодня', 'Москва']);
    expect(lineWords({}, ['Сегодня', 'Москва'])).toEqual(['Сегодня', 'Москва']);
  });

  it('what the frame draws is the lowered line (preview and export share it)', () => {
    const p = createProject('t', '9:16', 0);
    const cap = createCaptionClip([{ t0: 0, t1: 1, text: 'Это' }, { t0: 1, t1: 2, text: 'Кадр.' }], { ...CAPTION_PRESETS[0], wordsPerPage: 4 });
    cap.lowerStart = true;
    placeClip(p, cap);
    const layer = buildFrame(p, 0.5).layers.find((l) => l.source.kind === 'caption')!;
    expect(layer.source.kind === 'caption' && layer.source.words).toEqual(['это', 'Кадр.']);
  });
});
