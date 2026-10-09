import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { CAPTION_LAYOUTS, DEFAULT_VAD, captionAt, dropArtifacts, captionLayout, captionPages, parseSubtitles, setCaptionLayout, toSrt, wordsFromSegment } from './captions';
import { createCaptionClip, createProject, createVideoClip } from './defaults';
import { buildFrame } from './frame';
import { CAPTION_PRESETS } from './presets';
import { findClip, insertFreezeFrame, insertMain, mainTrack, placeClip, remapAssets, splitClip, trimClip } from './timeline';
import type { Asset, CaptionClip, CaptionWord, Project } from './types';

const w = (t0: number, t1: number, text: string): CaptionWord => ({ t0, t1, text });
const words = [w(0, 0.4, 'Hello'), w(0.4, 0.8, 'there.'), w(2, 2.3, 'New'), w(2.3, 2.6, 'line'), w(2.6, 2.9, 'here')];

describe('caption pages', () => {
  it('breaks on sentence end, long pause and max words', () => {
    expect(captionPages(words, 5).map((p) => p.map((x) => x.text).join(' '))).toEqual(['Hello there.', 'New line here']);
    expect(captionPages(words, 2).map((p) => p.length)).toEqual([2, 2, 1]);
  });

  it('shows the page and the spoken word, and nothing in long gaps', () => {
    const c = { words, wordsPerPage: 5 };
    expect(captionAt(c, 0.5)).toMatchObject({ words: ['Hello', 'there.'], active: 1, shown: 2 });
    expect(captionAt(c, 1.1)).toMatchObject({ words: ['Hello', 'there.'], active: -1 }); // held 0.5 s after last word
    expect(captionAt(c, 1.6)).toBeNull();
    expect(captionAt(c, 2.4)?.active).toBe(1);
  });

  it('layouts: phrase, word by word, highlight, reveal (v1.0)', () => {
    const c: { wordsPerPage: number; highlight: string | null; reveal?: boolean } = { wordsPerPage: 3, highlight: '#ff0000' };
    for (const l of CAPTION_LAYOUTS) { setCaptionLayout(c, l, '#00ff00'); expect(captionLayout(c)).toBe(l); }
    setCaptionLayout(c, 'word', '#00ff00');
    expect([c.wordsPerPage, c.highlight, c.reveal]).toEqual([1, null, undefined]);
    setCaptionLayout(c, 'reveal', '#00ff00');
    expect(c.highlight).toBe('#00ff00');
    // Reveal: only the words already spoken are counted as shown.
    expect(captionAt({ words, wordsPerPage: 5 }, words[0].t0 + 0.01)?.shown).toBe(1);
  });

  it('drops Whisper artifacts: credit lines and decoding loops, keeps real repeats', () => {
    const w = (s: string) => s.split(' ').map((text, i) => ({ t0: i, t1: i + 0.5, text }));
    expect(dropArtifacts(w('Привет всем. Субтитры сделал DimaTorzok')).map((x) => x.text)).toEqual(['Привет', 'всем.']);
    expect(dropArtifacts(w('ну да да да да да ладно')).map((x) => x.text)).toEqual(['ну', 'да', 'ладно']);
    expect(dropArtifacts(w('да да да')).length).toBe(3); // a real "yes yes yes" stays
    expect(dropArtifacts(w('I am here I am here I am here I am here')).map((x) => x.text)).toEqual(['I', 'am', 'here']);
  });

  it('spreads a phrase over its time proportionally to word length', () => {
    const r = wordsFromSegment(10, 12, 'a bbb');
    expect(r[0].t0).toBe(10);
    expect(r[1].t1).toBeCloseTo(12);
    expect(r[1].t1 - r[1].t0).toBeGreaterThan(r[0].t1 - r[0].t0);
  });
});

describe('SRT', () => {
  const clip = createCaptionClip(words.map((x) => ({ ...x, t0: x.t0 + 5, t1: x.t1 + 5 })), CAPTION_PRESETS[1]);

  it('exports pages in timeline time', () => {
    const srt = toSrt([clip]);
    expect(srt).toContain('1\n00:00:05,000 --> 00:00:05,800\nHello there.');
    expect(srt).toContain('2\n00:00:07,000 --> 00:00:07,900\nNew line here');
  });

  it('round-trips through the parser (also VTT, CRLF, tags)', () => {
    const back = parseSubtitles(toSrt([clip]));
    expect(back.map((x) => x.text)).toEqual(['Hello', 'there.', 'New', 'line', 'here']);
    expect(back[0].t0).toBe(5);
    const vtt = parseSubtitles('WEBVTT\r\n\r\n00:01.500 --> 00:02.000\r\n<b>Hi</b> you\r\n');
    expect(vtt.map((x) => x.text)).toEqual(['Hi', 'you']);
    expect(vtt[0].t0).toBe(1.5);
  });
});

const asset = (id: string, duration = 10): Asset => ({ id, kind: 'video', name: id, mime: 'video/mp4', size: 1, duration, width: 1920, height: 1080, hasAudio: true });

describe('captions on the timeline', () => {
  it('split and trim keep words aligned with the clip', () => {
    let p = createProject('c', '9:16');
    const clip = createCaptionClip(words, CAPTION_PRESETS[0]);
    p = produce(p, (d) => { placeClip(d, clip); });
    let right = '';
    p = produce(p, (d) => { right = splitClip(d, clip.id, 1.5)!; });
    const [l, r] = [findClip(p, clip.id)!.clip as CaptionClip, findClip(p, right)!.clip as CaptionClip];
    expect(l.words.map((x) => x.text)).toEqual(['Hello', 'there.']);
    expect(r.words[0]).toMatchObject({ text: 'New', t0: 0.5 });
    p = produce(p, (d) => { trimClip(d, right, 'start', 2.3); });
    expect((findClip(p, right)!.clip as CaptionClip).words[0].t0).toBeCloseTo(-0.3);
  });
});

describe('freeze frame, crop and backups', () => {
  function oneClip(): Project {
    const p = createProject('f', '9:16');
    p.assets = { a: asset('a') };
    return produce(p, (d) => { insertMain(d, createVideoClip(d.assets.a), 0); });
  }

  it('freeze frame splits the main clip and inserts a still with the same look', () => {
    const still: Asset = { ...asset('still', 0), kind: 'image' };
    let p = produce(oneClip(), (d) => { mainTrack(d).clips[0].kind === 'video' && ((mainTrack(d).clips[0] as { crop?: object }).crop = { x: 0.1, y: 0, w: 0.5, h: 1 }); });
    p = produce(p, (d) => { insertFreezeFrame(d, mainTrack(d).clips[0].id, 4, still, 2); });
    const clips = mainTrack(p).clips;
    expect(clips.map((c) => [c.kind, c.start, c.duration])).toEqual([['video', 0, 4], ['image', 4, 2], ['video', 6, 6]]);
    expect(clips[1].kind === 'image' && clips[1].crop).toEqual({ x: 0.1, y: 0, w: 0.5, h: 1 });
  });

  it('crop reaches the rendered layer', () => {
    const p = produce(oneClip(), (d) => { const c = mainTrack(d).clips[0]; if (c.kind === 'video') c.crop = { x: 0.25, y: 0, w: 0.5, h: 1 }; });
    expect(buildFrame(p, 1).layers[0].crop).toEqual({ x: 0.25, y: 0, w: 0.5, h: 1 });
  });

  it('remapAssets rewrites every reference, including processed audio', () => {
    const p = produce(oneClip(), (d) => {
      d.assets.clean = { ...asset('clean'), kind: 'audio' };
      d.assets.a.derived = { denoise: 'clean' };
      const c = mainTrack(d).clips[0];
      if (c.kind === 'video') c.audioAssetId = 'clean';
    });
    const q = produce(p, (d) => { remapAssets(d, (id) => `n-${id}`); });
    const c = mainTrack(q).clips[0];
    expect(Object.keys(q.assets).sort()).toEqual(['n-a', 'n-clean']);
    expect(c.kind === 'video' && [c.assetId, c.audioAssetId]).toEqual(['n-a', 'n-clean']);
    expect(q.assets['n-a'].derived).toEqual({ denoise: 'n-clean' });
  });
});

import { speechRanges } from './silence';
import { keepSourceRanges } from './timeline';

describe('remove pauses', () => {
  const pps = 10;
  // 0-1 s silence, 1-3 speech, 3-4 silence, 4-5 speech, 5-6 silence
  const peaks = new Float32Array(60).map((_, i) => ((i >= 10 && i < 30) || (i >= 40 && i < 50) ? 0.5 : 0.001));

  it('keeps speech with padding, including before the first and after the last word', () => {
    const keep = speechRanges(peaks, pps, 0, 6, { threshold: 0.03, minPause: 0.45, pad: 0.1 });
    expect(keep.map(([a, b]) => [+a.toFixed(2), +b.toFixed(2)])).toEqual([[0.9, 3.1], [3.9, 5.1]]);
  });

  it('ignores pauses shorter than minPause', () => {
    expect(speechRanges(peaks, pps, 0.5, 5.5, { threshold: 0.03, minPause: 1.5, pad: 0.1 })).toEqual([[0.5, 5.5]]);
  });

  it('rebuilds the main track from the kept pieces (ripple)', () => {
    let p = createProject('s', '9:16');
    p.assets = { a: asset('a', 6) };
    p = produce(p, (d) => { insertMain(d, createVideoClip(d.assets.a), 0); insertMain(d, createVideoClip(d.assets.a), 99); });
    const id = mainTrack(p).clips[0].id;
    p = produce(p, (d) => { keepSourceRanges(d, id, [[1, 3], [4, 5]]); });
    expect(mainTrack(p).clips.map((c) => [c.start, c.duration, c.kind === 'video' && c.in])).toEqual([[0, 2, 1], [2, 1, 4], [3, 6, 0]]);
  });
});

import { CURVE_PRESETS, curveIntegral, timeFractionToU, uToTimeFraction } from './speed';
import { rateAt, sourceSpan, sourceTime, timelineTimeOf } from './timeline';
import type { VideoClip as VC } from './types';

describe('speed curves', () => {
  const hero = CURVE_PRESETS.find((c) => c.id === 'hero')!.points;

  it('a flat curve behaves like constant speed', () => {
    expect(curveIntegral([1, 1, 1])).toBeCloseTo(1, 6);
    expect(timeFractionToU([2, 2, 2], 0.5)).toBeCloseTo(0.5, 6);
  });

  it('time ↔ source mapping round-trips and slow parts take longer', () => {
    for (const f of [0.1, 0.37, 0.5, 0.93]) expect(uToTimeFraction(hero, timeFractionToU(hero, f))).toBeCloseTo(f, 6);
    // the middle of hero is slow-mo, so the middle 20 % of the source takes far more than 20 % of the time
    expect(uToTimeFraction(hero, 0.6) - uToTimeFraction(hero, 0.4)).toBeGreaterThan(0.4);
  });

  function curved(): Project {
    let p = createProject('c', '16:9');
    p.assets = { a: asset('a', 20) };
    p = produce(p, (d) => {
      const c = createVideoClip(d.assets.a);
      c.in = 2; c.curve = hero; c.duration = 10 * curveIntegral(hero); // 10 s of source
      insertMain(d, c, 0);
    });
    return p;
  }

  it('clip maps its whole source range and inverts exactly', () => {
    const c = mainTrack(curved()).clips[0] as VC;
    expect(sourceSpan(c)).toBeCloseTo(10, 6);
    expect(sourceTime(c, 0)).toBeCloseTo(2, 6);
    expect(sourceTime(c, c.duration)).toBeCloseTo(12, 6);
    for (const t of [0.5, 3, c.duration - 0.2]) expect(timelineTimeOf(c, sourceTime(c, t))).toBeCloseTo(t, 4);
    expect(rateAt(c, c.duration / 2)).toBeCloseTo(0.25, 1);
  });

  it('split keeps the picture continuous and the total length', () => {
    let p = curved();
    const c = mainTrack(p).clips[0] as VC;
    const at = c.duration * 0.4, s = sourceTime(c, at), total = c.duration;
    p = produce(p, (d) => { splitClip(d, c.id, at); });
    const [l, r] = mainTrack(p).clips as VC[];
    expect(Math.abs(l.duration + r.duration - total) / total).toBeLessThan(0.01); // re-sampling changes length < 1 %
    expect(r.in).toBeCloseTo(s, 4);
    expect(sourceTime(l, l.duration)).toBeCloseTo(r.in, 6); // no jump at the cut
    expect(r.start).toBeCloseTo(l.duration, 6);
  });

  it('trimming an end keeps the curve and respects the source length', () => {
    let p = curved();
    const c = mainTrack(p).clips[0] as VC;
    p = produce(p, (d) => { trimClip(d, c.id, 'end', c.duration / 2); });
    const half = mainTrack(p).clips[0] as VC;
    expect(half.duration).toBeCloseTo(c.duration / 2, 1);
    p = produce(p, (d) => { trimClip(d, c.id, 'end', 999); });
    const full = mainTrack(p).clips[0] as VC;
    expect(full.in + sourceSpan(full)).toBeCloseTo(20, 1); // extended to the end of the 20 s source
  });
});

import { estimateBeats, onsetEnvelope } from './beats';
import { duckBreakpoints, duckGain, mergeRanges } from './duck';
import { TEMPLATES, buildTemplate } from './templates';
import { cutMainToBeats, setCurve } from './timeline';

describe('beats', () => {
  it('finds tempo and phase of a 120 BPM click track', () => {
    const hop = 0.01, dur = 20;
    const energy = new Float32Array(dur / hop).fill(0.001);
    for (let t = 0.2; t < dur; t += 0.5) for (let k = 0; k < 5; k++) energy[Math.round(t / hop) + k] = 0.5 - k * 0.08;
    const g = estimateBeats(onsetEnvelope(energy), hop, dur)!;
    expect(g.bpm).toBeGreaterThan(118);
    expect(g.bpm).toBeLessThan(122);
    expect(g.times[0]).toBeCloseTo(0.2, 1);
  });

  it('returns null without a pulse', () => {
    expect(estimateBeats(onsetEnvelope(new Float32Array(2000).fill(0.2)), 0.01, 20)).toBeNull();
  });

  it('cutMainToBeats moves each cut onto the beat grid', () => {
    let p = createProject('b', '9:16');
    p.assets = { img: { ...asset('img', 0), kind: 'image' } };
    p = produce(p, (d) => { for (let i = 0; i < 3; i++) insertMain(d, createImageClip(d.assets.img, 0, 2), 99); });
    p = produce(p, (d) => { cutMainToBeats(d, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4], 2); });
    expect(mainTrack(p).clips.map((c) => [c.start, c.duration])).toEqual([[0, 1], [1, 1], [2, 1]]);
  });
});

describe('ducking', () => {
  it('merges close speech and ramps the gain', () => {
    const r = mergeRanges([[5, 6], [1, 2], [2.2, 3]]);
    expect(r).toEqual([[1, 3], [5, 6]]);
    expect(duckGain(0, r, 0.7)).toBe(1);
    expect(duckGain(2, r, 0.7)).toBeCloseTo(0.3);
    expect(duckGain(3.2, r, 0.7)).toBeGreaterThan(0.3);
    expect(duckGain(3.2, r, 0.7)).toBeLessThan(1);
    expect(duckBreakpoints(r, 0, 4)).toEqual(expect.arrayContaining([1, 3]));
  });
});

describe('curve apply and templates', () => {
  it('setCurve keeps the source range and changes the duration', () => {
    let p = createProject('c', '9:16');
    p.assets = { a: asset('a', 10) };
    p = produce(p, (d) => { insertMain(d, createVideoClip(d.assets.a), 0); });
    const id = mainTrack(p).clips[0].id;
    p = produce(p, (d) => { setCurve(d, id, [0.5, 0.5, 0.5]); });
    expect(mainTrack(p).clips[0].duration).toBeCloseTo(20, 4);
    p = produce(p, (d) => { setCurve(d, id, null); });
    expect(mainTrack(p).clips[0].duration).toBeCloseTo(10, 4);
  });

  it('every template builds a playable edit', () => {
    for (const t of TEMPLATES) {
      const p0 = createProject(t.name, t.aspect);
      const img: Asset = { ...asset('img', 0), kind: 'image', width: 1080, height: 1350 };
      const vid = asset('vid', 8);
      const music: Asset = { ...asset('mus', 30), kind: 'audio', width: 0, height: 0 };
      p0.assets = { img, vid, mus: music };
      const visuals = [img, vid, img].slice(0, t.visuals[1]);
      const p = produce(p0, (d) => { buildTemplate(d, t.id, visuals, music, [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]); });
      const tracks = p.tracks.flatMap((tr) => tr.clips);
      expect(tracks.length, t.id).toBeGreaterThanOrEqual(2);
      expect(projectDurationOf(p), t.id).toBeGreaterThan(1);
      expect(p.tracks.some((tr) => tr.kind === 'audio'), t.id).toBe(true);
    }
  });
});

import { projectDuration as projectDurationOf, projectDuration } from './timeline';

import { createImageClip } from './defaults';

import { speechWindows, vadSegments, wordsInSpeech } from './captions';

describe('speech detection for captions', () => {
  it('turns probabilities into padded speech segments with hysteresis', () => {
    const f = 0.032;
    const probs = new Float32Array(100);
    for (let i = 10; i < 40; i++) probs[i] = 0.9;
    for (let i = 42; i < 45; i++) probs[i] = 0.9; // short gap → merged
    probs[70] = 0.9; // single frame blip → dropped (too short)
    const seg = vadSegments(probs, f);
    expect(seg.length).toBe(1);
    expect(seg[0][0]).toBeCloseTo(10 * f - DEFAULT_VAD.pad, 5);
    expect(seg[0][1]).toBeCloseTo(45 * f + DEFAULT_VAD.pad, 5);
  });

  it('groups speech into ≤ 28 s windows and filters words outside speech', () => {
    expect(speechWindows([[0, 5], [10, 20], [25, 40]])).toEqual([[0, 20], [25, 40]]);
    expect(speechWindows([[0, 60]])).toEqual([[0, 28], [28, 56], [56, 60]]);
    const kept = wordsInSpeech([w(1, 1.5, 'real'), w(12, 12.4, 'invented')], [[0, 3]]);
    expect(kept.map((x) => x.text)).toEqual(['real']);
  });
});

import { coverScale, fillerIndices, maskCentroid, reframeKeys } from './reframe';
import { cutTimelineRanges } from './timeline';

describe('edit by text', () => {
  it('ripple-cuts the main track and shifts caption words', () => {
    let p = createProject('t', '9:16');
    p.assets = { a: asset('a', 10) };
    const cap = createCaptionClip([w(1, 1.5, 'Hello'), w(2, 2.4, 'um'), w(3, 3.5, 'world')], CAPTION_PRESETS[0]);
    p = produce(p, (d) => { insertMain(d, createVideoClip(d.assets.a), 0); placeClip(d, cap); });
    let removed = 0;
    p = produce(p, (d) => { removed = cutTimelineRanges(d, [[2, 2.4]]); });
    expect(removed).toBeCloseTo(0.4, 6);
    expect(mainTrack(p).clips.map((c) => [c.start, c.duration, c.kind === 'video' && c.in])).toEqual([[0, 2, 0], [2, 7.6, 2.4]]);
    const c = findClip(p, cap.id)!.clip as CaptionClip;
    expect(c.words.map((x) => [x.text, +(x.t0 + c.start).toFixed(2)])).toEqual([['Hello', 1], ['world', 2.6]]);
  });

  it('marks fillers and stutters', () => {
    expect(fillerIndices([{ text: 'So,' }, { text: 'um,' }, { text: 'I' }, { text: 'I' }, { text: 'think' }, { text: 'ээ' }])).toEqual([1, 2, 5]);
  });
});

describe('auto reframe', () => {
  it('covers a vertical canvas with a horizontal source', () => {
    expect(coverScale(16 / 9, 9 / 16)).toBeCloseTo(3.1605, 3);
  });

  it('pans toward the subject, smoothly and within the frame', () => {
    const width = coverScale(16 / 9, 9 / 16);
    const samples = Array.from({ length: 11 }, (_, i) => ({ t: i * 0.5, u: 0.2 + i * 0.06 })); // subject walks right
    const keys = reframeKeys(samples, width);
    expect(keys[0].v).toBeGreaterThan(0); // subject left of center → layer moves right
    expect(keys[keys.length - 1].v).toBeLessThan(0);
    for (const k of keys) expect(Math.abs(k.v)).toBeLessThanOrEqual((width - 1) / 2 + 1e-9);
    const still = reframeKeys(samples.map((s) => ({ ...s, u: 0.5 + (s.t % 1 ? 0.01 : -0.01) })), width);
    expect(still.length).toBe(1); // jitter inside the dead zone makes no moves
  });

  it('finds the horizontal center of a mask', () => {
    const m = new Uint8Array(10 * 4);
    for (let y = 0; y < 4; y++) { m[y * 10 + 7] = 255; m[y * 10 + 8] = 255; }
    expect(maskCentroid(m, 10, 4)).toBeCloseTo(7.5 / 9, 5);
    expect(maskCentroid(new Uint8Array(40), 10, 4)).toBeNull();
  });
});

import { alignToSpeech, speechOnset } from './captions';
import { snapToQuiet, wordCutRange } from './silence';

describe('word timing refinement', () => {
  it('removes Whisper lag per speech segment', () => {
    const out = alignToSpeech([w(0.56, 0.8, 'Hello'), w(0.9, 1.2, 'there')], [[0, 2]], [0.2]);
    expect(out[0].t0).toBeCloseTo(0.2, 6);
    expect(out[1].t0).toBeCloseTo(0.54, 6);
    expect(alignToSpeech([w(1.5, 2, 'x')], [[0, 3]], [0.2])[0].t0).toBe(1.5); // implausible lag is left alone
  });

  it('measures the voice onset from energy', () => {
    const sr = 16000, a = new Float32Array(sr * 2);
    for (let i = Math.round(0.37 * sr); i < sr * 2; i++) a[i] = 0.3 * Math.sin(i / 5);
    expect(speechOnset(a, sr, 0, 2)).toBeCloseTo(0.37, 1);
  });

  it('snaps a cut to the nearest quiet point', () => {
    const peaks = new Float32Array(100).fill(0.5);
    peaks[52] = 0.01; // a dip between words at 1.04–1.06 s (50 bins/s)
    expect(snapToQuiet(peaks, 50, 1.0)).toBeCloseTo(1.05, 6);
    expect(snapToQuiet(peaks, 50, 1.5)).toBeCloseTo(1.5 + 0.5 / 50, 2); // nothing quieter nearby: stays
    const [a, b] = wordCutRange(peaks, 50, 1.0, 1.2); // one dip near the start: the end must not collapse onto it
    expect(a).toBeCloseTo(1.05, 6);
    expect(b).toBeGreaterThan(1.14);
  });
});

describe('edit by text regressions', () => {
  it('a very short range cuts only itself (never the whole clip)', () => {
    let p = createProject('t', '9:16');
    p.assets = { a: asset('a', 10) };
    p = produce(p, (d) => { insertMain(d, createVideoClip(d.assets.a), 0); });
    let removed = 0;
    p = produce(p, (d) => { removed = cutTimelineRanges(d, [[4.81, 4.83], [2.61, 2.91]]); });
    expect(removed).toBeCloseTo(0.32, 6);
    expect(projectDuration(p)).toBeCloseTo(9.68, 6);
  });
});

describe('subtitle import keeps cues', () => {
  it('never merges two SRT cues into one line', () => {
    const words = parseSubtitles('1\n00:00:00,500 --> 00:00:02,000\nHello from Kadr\n\n2\n00:00:02,500 --> 00:00:04,000\nSecond line\n');
    expect(captionPages(words, 16).map((p) => p.map((x) => x.text).join(' '))).toEqual(['Hello from Kadr', 'Second line']);
  });
});
