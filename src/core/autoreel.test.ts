import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { useEditor } from '../state/store';
import { JUMP_ZOOM, fillerCuts, fitWordsToPauses, hookClip, hookText, jumpZoom, pauseCuts, withoutIndices } from './autoreel';
import { createCaptionClip, createProject, createVideoClip } from './defaults';
import { CAPTION_PRESETS } from './presets';
import { cutTimelineRanges, endWithContent, insertMain, mainTrack, placeClip, projectDuration } from './timeline';
import type { Asset, CaptionClip, CaptionWord, VideoClip } from './types';

const PPS = 50;
const asset = (id: string, duration: number, w = 1080, h = 1920): Asset => ({ id, name: id, mime: 'video/mp4', size: 1, kind: 'video', duration, width: w, height: h, hasAudio: true });
/** Peaks: loud where `speech` says, silent elsewhere. */
function peaks(duration: number, speech: [number, number][]): Float32Array {
  const p = new Float32Array(Math.ceil(duration * PPS) + 1);
  for (const [a, b] of speech) for (let i = Math.floor(a * PPS); i < b * PPS; i++) p[i] = 0.5;
  return p;
}
const words = (s: string, t0 = 0, step = 0.5): CaptionWord[] => s.split(' ').map((text, i) => ({ t0: t0 + i * step, t1: t0 + i * step + 0.4, text }));

describe('reel in one tap: planning', () => {
  it('cuts pauses and dead air, keeps padding around speech, and never cuts a clip with no speech', () => {
    const c = createVideoClip(asset('a', 10)) as VideoClip;
    const cuts = pauseCuts(c, peaks(10, [[1, 3], [5, 8]]), PPS);
    expect(cuts.length).toBe(3); // start, middle, end
    expect(cuts[0][0]).toBe(0);
    expect(cuts[1][0]).toBeCloseTo(3.12, 1); // pad kept after speech
    expect(cuts[1][1]).toBeCloseTo(4.88, 1);
    expect(cuts[2][1]).toBeCloseTo(10, 5);
    expect(pauseCuts(c, peaks(10, []), PPS)).toEqual([]);
  });

  it('cuts filler words at quiet points and keeps the other words for captions', () => {
    const c = createVideoClip(asset('a', 10)) as VideoClip;
    const w = words('so um this is is great');
    const { ranges, indices } = fillerCuts(w, [c], () => peaks(10, w.map((x) => [x.t0, x.t1] as [number, number])), PPS);
    expect(indices).toEqual([1, 3]); // "um" and the first "is"
    expect(ranges.length).toBe(2);
    expect(withoutIndices(w, indices).map((x) => x.text)).toEqual(['so', 'this', 'is', 'great']);
  });

  it('jump zoom fills a vertical frame with a horizontal video and zooms every other piece', () => {
    const p = produce(createProject('t', '9:16'), (d) => {
      d.assets.h = asset('h', 9, 1920, 1080);
      insertMain(d, createVideoClip(d.assets.h), 0);
      cutTimelineRanges(d, [[2, 3], [5, 6]]); // three pieces
    });
    let zoomed = 0;
    const q = produce(p, (d) => { zoomed = jumpZoom(d); });
    const scales = mainTrack(q).clips.map((c) => (c.kind === 'video' ? c.transform.scale.v : 0));
    expect(zoomed).toBe(1);
    expect(scales[1] / scales[0]).toBeCloseTo(JUMP_ZOOM, 5);
    expect(scales[0]).toBeGreaterThan(3); // cover: 16:9 into 9:16
  });

  it('hook is the first phrase, at most seven words', () => {
    expect(hookText(words('сегодня покажу как монтировать. дальше'))).toBe('Сегодня покажу как монтировать.');
    expect(hookText(words('one two three four five six seven eight nine'))).toBe('One two three four five six seven');
    expect(hookText(words('hi'))).toBeNull();
  });
});

/** A talk with dead air at the start, two long pauses, an "um" and a repeat: words in timeline seconds. */
const TALK: CaptionWord[] = [
  { t0: 1.0, t1: 1.4, text: 'hello' }, { t0: 1.5, t1: 1.9, text: 'everyone.' },
  { t0: 3.5, t1: 3.9, text: 'today,' }, { t0: 4.0, t1: 4.4, text: 'um,' }, { t0: 4.5, t1: 4.9, text: 'we' },
  { t0: 5.0, t1: 5.4, text: 'cut' }, { t0: 5.5, t1: 5.9, text: 'cut' }, { t0: 6.0, t1: 6.4, text: 'pauses.' },
  { t0: 8.5, t1: 8.9, text: 'bye!' },
];
const talkPeaks = () => peaks(10, TALK.map((w) => [w.t0, w.t1]));
const talkProject = () => produce(createProject('t', '9:16'), (d) => {
  d.assets.a = asset('a', 10);
  insertMain(d, createVideoClip(d.assets.a), 0);
});

describe('reel in one tap: cuts keep the speech', () => {
  it('pause and filler cuts merge into one cut that removes no spoken word', () => {
    const p = talkProject();
    const c = mainTrack(p).clips[0] as VideoClip;
    const filler = fillerCuts(TALK, [c], () => talkPeaks(), PPS);
    const cuts = [...pauseCuts(c, talkPeaks(), PPS), ...filler.ranges];
    const spoken = withoutIndices(TALK, filler.indices);
    expect(spoken.map((w) => w.text)).toEqual(['hello', 'everyone.', 'today,', 'we', 'cut', 'pauses.', 'bye!']);
    for (const w of spoken) for (const [a, b] of cuts) expect(a < w.t1 - 0.02 && b > w.t0 + 0.02, `${w.text} cut by ${a}–${b}`).toBe(false);
    // On the timeline: captions move with the video and keep every spoken word.
    const q = produce(p, (d) => {
      placeClip(d, createCaptionClip(spoken, CAPTION_PRESETS[0]));
      cutTimelineRanges(d, cuts);
    });
    const cap = q.tracks.flatMap((t) => t.clips).find((x): x is CaptionClip => x.kind === 'caption')!;
    expect(cap.words.map((w) => w.text)).toEqual(spoken.map((w) => w.text));
    expect(projectDuration(q)).toBeLessThan(7.5); // 10 s → about 6 s of speech with padding
    expect(projectDuration(q)).toBeGreaterThan(spoken.length * 0.4);
  });

  it('a caption word stretched into a cut pause stays, clamped to the cut; a word mostly inside a cut goes', () => {
    const p = produce(talkProject(), (d) => {
      placeClip(d, createCaptionClip([
        { t0: 1, t1: 2.2, text: 'pauses' }, // the sound ends at 1.6; Whisper says 2.2
        { t0: 3.0, t1: 3.4, text: 'um' },
        { t0: 4.0, t1: 4.4, text: 'next' },
      ], CAPTION_PRESETS[0]));
      cutTimelineRanges(d, [[1.72, 3.9], [2.95, 3.45]]);
    });
    const cap = p.tracks.flatMap((t) => t.clips).find((x): x is CaptionClip => x.kind === 'caption')!;
    expect(cap.words.map((w) => w.text)).toEqual(['pauses', 'next']);
    expect(cap.words[0].t1).toBeCloseTo(0.72, 5); // clip-relative: cut start 1.72 − clip start 1
    expect(cap.words[1].t0).toBeCloseTo(4 - 1 - 2.18, 5);
  });

  it('words that Whisper ran into a pause are fitted to the speech side and survive the pause cut', () => {
    const late: CaptionWord[] = [
      { t0: 1.5, t1: 3.2, text: 'everyone.' }, // the sound ends at 1.9, the pause runs to 3.5
      { t0: 2.6, t1: 3.3, text: 'today,' }, // starts inside the pause: mostly silence by the sound
      { t0: 4.0, t1: 4.4, text: 'we' },
    ];
    const pauses: [number, number][] = [[2.02, 3.38]];
    const fit = fitWordsToPauses(late, pauses);
    expect(fit.map((w) => [w.t0, w.t1])).toEqual([[1.5, 2.02], [3.38, 3.63], [4.0, 4.4]]);
    const q = produce(talkProject(), (d) => { placeClip(d, createCaptionClip(fit, CAPTION_PRESETS[0])); cutTimelineRanges(d, pauses); });
    const cap = q.tracks.flatMap((t) => t.clips).find((x): x is CaptionClip => x.kind === 'caption')!;
    expect(cap.words.map((w) => w.text)).toEqual(['everyone.', 'today,', 'we']);
  });

  it('captions and the title never make the project longer than its media', () => {
    const p = produce(talkProject(), (d) => { // a 10 s video
      const cap = createCaptionClip([{ t0: 8.5, t1: 9.8, text: 'bye!' }], CAPTION_PRESETS[0]); // tail to 10.3
      endWithContent(d, cap);
      placeClip(d, cap);
      const hook = hookClip('Hello there');
      hook.start = 9;
      endWithContent(d, hook);
      placeClip(d, hook);
    });
    expect(projectDuration(p)).toBe(10);
  });

  it('every step is its own history entry, and undoing them all restores the project', () => {
    const s = () => useEditor.getState();
    const p0 = talkProject();
    s().open(p0);
    const c = mainTrack(p0).clips[0] as VideoClip;
    const filler = fillerCuts(TALK, [c], () => talkPeaks(), PPS);
    const spoken = withoutIndices(TALK, filler.indices);
    s().commit((d) => { placeClip(d, createCaptionClip(spoken, CAPTION_PRESETS[0])); });
    s().commit((d) => { cutTimelineRanges(d, [...pauseCuts(c, talkPeaks(), PPS), ...filler.ranges]); });
    s().commit((d) => { jumpZoom(d); });
    s().commit((d) => { placeClip(d, hookClip(hookText(spoken)!)); });
    expect(s().past.length).toBe(4);
    const kinds = () => s().project!.tracks.flatMap((t) => t.clips.map((x) => x.kind)).sort().join(',');
    const scales = () => mainTrack(s().project!).clips.map((x) => (x.kind === 'video' ? x.transform.scale.v : 0));
    s().undo(); // the title
    expect(kinds()).not.toContain('text');
    expect(Math.max(...scales())).toBeCloseTo(JUMP_ZOOM, 5);
    s().undo(); // the zooms
    expect(Math.max(...scales())).toBe(1);
    expect(mainTrack(s().project!).clips.length).toBeGreaterThan(1);
    s().undo(); // the cuts
    expect(mainTrack(s().project!).clips.length).toBe(1);
    expect(kinds()).toContain('caption');
    s().undo(); // the captions
    expect(s().project).toBe(p0);
  });
});
