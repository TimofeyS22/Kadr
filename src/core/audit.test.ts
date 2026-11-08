// Findings of the independent audit (docs/13), each written to fail on the code the audit read.
import { produce } from 'immer';
import { describe, expect, it } from 'vitest';
import { evalAnim } from './anim';
import { createCaptionClip, createProject, createVideoClip } from './defaults';
import { buildFrame } from './frame';
import { CAPTION_PRESETS } from './presets';
import { DEFAULT_PAUSES, removedSeconds, silenceLevel, speechRanges } from './silence';
import { parseSubtitles } from './captions';
import { fitRects } from './faceTiles';
import { withoutGuides } from './music';
import { detachAudio, findClip, forwardIn, insertFreezeFrame, insertMain, mainTrack, placeClip, removeSourceGaps, setSpeed, soundAssetId, splitClip, trimClip, usedAssetIds, withUsedAssets } from './timeline';
import type { Asset, CaptionClip, ImageClip, Project, VideoClip } from './types';

const video = (id: string, duration = 10): Asset => ({ id, kind: 'video', name: id, mime: 'video/mp4', size: 1, duration, width: 1920, height: 1080, hasAudio: true });
const image = (id: string): Asset => ({ id, kind: 'image', name: id, mime: 'image/jpeg', size: 1, duration: 0, width: 640, height: 360, hasAudio: false });

function oneClip(prep?: (c: VideoClip) => void): { p: Project; id: string } {
  let id = '';
  const p = produce(createProject('a', '9:16'), (d) => {
    const a = video('v');
    d.assets[a.id] = a;
    const c = createVideoClip(a, 0);
    prep?.(c);
    insertMain(d, c, 0);
    id = c.id;
  });
  return { p, id };
}

/** A hidden area moving from x 0.1 to 0.9 over the clip's ten seconds: at source second s it is at 0.1 + 0.08 s. */
const moving = (c: VideoClip) => {
  c.privacy = { faces: false, style: 'blur', areas: [{ x: { v: 0.1, k: [{ t: 0, v: 0.1 }, { t: 10, v: 0.9 }] }, y: { v: 0.5 }, w: 0.2, h: 0.2 }] };
};
/** Where the area is drawn on the frame showing `source` seconds of the video. */
function areaAt(p: Project, source: number): number {
  for (const c of mainTrack(p).clips as VideoClip[]) {
    const span = c.duration * c.speed;
    if (source >= c.in && source < c.in + span) return buildFrame(p, c.start + (source - c.in) / c.speed + 1e-4).layers.find((l) => l.privacy)!.privacy!.areas[0][0];
  }
  throw new Error('no clip shows that second');
}

describe('a hidden area stays on what it hides after a time edit (audit V-213)', () => {
  const at8 = 0.1 + 0.08 * 8;
  it('split', () => {
    const { p, id } = oneClip(moving);
    const q = produce(p, (d) => { splitClip(d, id, 5); });
    expect(areaAt(q, 8)).toBeCloseTo(at8, 2);
    expect(areaAt(q, 2)).toBeCloseTo(0.1 + 0.08 * 2, 2);
  });
  it('trimming the start', () => {
    const { p, id } = oneClip(moving);
    expect(areaAt(produce(p, (d) => { trimClip(d, id, 'start', 2); }), 8)).toBeCloseTo(at8, 2);
  });
  it('speed', () => {
    const { p, id } = oneClip(moving);
    expect(areaAt(produce(p, (d) => { setSpeed(d, id, 2); }), 8)).toBeCloseTo(at8, 2);
  });
  it('removing pauses', () => {
    const { p, id } = oneClip(moving);
    expect(areaAt(produce(p, (d) => { removeSourceGaps(d, id, [[0, 2], [5, 10]]); }), 8)).toBeCloseTo(at8, 2);
  });
});

describe('a freeze frame looks like its clip (audit V-174)', () => {
  it('keeps what is hidden, the mask, effect, LUT, cutout and mirror', () => {
    const { p, id } = oneClip((c) => {
      moving(c);
      c.privacy!.faces = true;
      c.mask = { shape: 'circle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, rotation: 0, feather: 0, roundness: 0, invert: false };
      c.effect = { id: 'vhs', amount: 0.5 };
      c.lut = { id: 'l', intensity: 0.7 };
      c.removeBg = true;
      c.flipX = true;
      c.flipY = true;
    });
    let still = '';
    const q = produce(p, (d) => { still = insertFreezeFrame(d, id, 5, image('still'))!; });
    const c = findClip(q, still)!.clip as ImageClip;
    expect(c.privacy?.faces).toBe(true);
    expect(c.privacy?.style).toBe('blur');
    expect(evalAnim(c.privacy!.areas[0].x, 0), 'the area where the clip had it at that moment').toBeCloseTo(0.5, 2);
    expect(evalAnim(c.privacy!.areas[0].x, 1.5), 'and it stays there: the picture does not move').toBeCloseTo(0.5, 2);
    expect(c.mask?.shape).toBe('circle');
    expect(c.effect?.id).toBe('vhs');
    expect(c.lut).toEqual({ id: 'l', intensity: 0.7 });
    expect(c.removeBg).toBe(true);
    expect([c.flipX, c.flipY]).toEqual([true, true]);
  });
});

describe('"Remove pauses" keeps captions on the speech (audit V-178)', () => {
  it('words after a cut move with it, and nothing hangs past the video', () => {
    const { p, id } = oneClip();
    let cap = '';
    const q = produce(p, (d) => {
      const c = createCaptionClip([{ t0: 1, t1: 1.5, text: 'one' }, { t0: 6, t1: 6.5, text: 'two' }, { t0: 9, t1: 9.5, text: 'three' }], CAPTION_PRESETS[0]);
      c.duration = 9;
      placeClip(d, c);
      cap = c.id;
      removeSourceGaps(d, id, [[0, 2], [5, 10]]);
    });
    const c = findClip(q, cap)!.clip as CaptionClip;
    expect(c.words.map((w) => [w.text, c.start + w.t0]), 'where each word is on the timeline').toEqual([['one', 1], ['two', 3], ['three', 6]]);
    expect(c.start + c.duration, 'the captions end with the video').toBeLessThanOrEqual(7.001);
    expect(mainTrack(q).clips.reduce((n, x) => n + x.duration, 0)).toBeCloseTo(7, 3);
  });

  it('cuts at the right place at a speed, and at both ends of the clip', () => {
    const { p, id } = oneClip((c) => { c.speed = 2; c.duration = 5; });
    const q = produce(p, (d) => { removeSourceGaps(d, id, [[1, 4], [6, 8]]); });
    const pieces = mainTrack(q).clips as VideoClip[];
    expect(pieces.map((x) => [x.in, x.duration])).toEqual([[1, 1.5], [6, 1]]);
  });

  it('a clip off the main track is cut in place', () => {
    const { p } = oneClip();
    let id = '';
    const q = produce(p, (d) => {
      const c = createVideoClip(video('o', 6), 1);
      d.assets.o = video('o', 6);
      c.muted = false;
      placeClip(d, c);
      id = c.id;
      removeSourceGaps(d, id, [[0, 1], [3, 6]]);
    });
    expect(findClip(q, id)!.clip.duration).toBe(1);
    expect(mainTrack(q).clips[0].duration, 'the main track is left alone').toBe(10);
  });
});

describe('"Detach audio" keeps what the sound was (audit V-108)', () => {
  it('voice, clean-up, ducking and the processed sound go with it', () => {
    const { p, id } = oneClip((c) => {
      c.voice = 'robot'; c.enhance = true; c.duck = 0.6; c.keepPitch = false; c.audioAssetId = 'proc'; c.audioKey = 'evrobot~2'; c.speed = 2; c.duration = 5;
    });
    let aid = '';
    const q = produce(p, (d) => { d.assets.proc = { ...video('proc'), kind: 'audio' }; aid = detachAudio(d, id)!; });
    const a = findClip(q, aid)!.clip;
    expect(a).toMatchObject({ voice: 'robot', enhance: true, duck: 0.6, keepPitch: false, audioAssetId: 'proc', audioKey: 'evrobot~2', muted: false });
    expect(soundAssetId(a as never), 'the same sound as before the detach').toBe('proc');
  });
});

describe('"Remove pauses" on a quiet recording (audit V-260)', () => {
  const pps = 50;
  /** Speech with pauses: words at `level` for 2 s, then 1 s of room noise, ten times. */
  const recording = (level: number, noise: number) => {
    const p = new Float32Array(30 * pps).fill(noise);
    for (let s = 0; s < 10; s++) for (let i = 0; i < 2 * pps; i++) p[s * 3 * pps + i] = level * (0.7 + 0.3 * Math.sin(i));
    return p;
  };
  const cut = (p: Float32Array) => removedSeconds(speechRanges(p, pps, 0, 30, { ...DEFAULT_PAUSES, threshold: silenceLevel(p, pps, 0, 30) }), 0, 30);

  it('finds the same pauses at -28 dB as at normal level', () => {
    const normal = cut(recording(0.5, 0.004));
    const quiet = cut(recording(0.04, 0.0004));
    expect(normal).toBeGreaterThan(5);
    expect(normal).toBeLessThan(10.1); // the ten seconds of pauses, less what stays around the words
    expect(quiet).toBeCloseTo(normal, 0);
  });

  it('a recording of normal level keeps the default', () => {
    expect(silenceLevel(recording(0.5, 0.004), pps, 0, 30)).toBe(DEFAULT_PAUSES.threshold);
  });

  it('noise with no pauses in it stays whole', () => {
    expect(cut(new Float32Array(30 * pps).fill(0.02))).toBe(0);
  });
});

describe('media no clip uses (audit V-126)', () => {
  const two = () => {
    let keep = '', drop = '';
    const p = produce(createProject('a', '9:16'), (d) => {
      for (const id of ['k', 'gone']) d.assets[id] = video(id);
      d.assets.k.derived = { denoise: 'dn', pitch: { 2: 'p2' }, voice: { robot: 'vr' } };
      d.assets.gone.derived = { denoise: 'dn2' };
      for (const id of ['dn', 'p2', 'vr', 'dn2', 'rev', 'proc']) d.assets[id] = { ...video(id), kind: id === 'rev' ? 'video' : 'audio' };
      const a = createVideoClip(d.assets.k, 0);
      a.reversedFrom = { assetId: 'rev', in: 0 };
      a.audioAssetId = 'proc';
      insertMain(d, a, 0);
      keep = a.id;
      drop = 'gone';
    });
    return { p, keep, drop };
  };

  it('lists what clips reach: the file, its forward copy, the processed sounds', () => {
    const { p } = two();
    expect([...usedAssetIds(p)].sort()).toEqual(['dn', 'k', 'p2', 'proc', 'rev', 'vr']);
  });

  it('a copy of the project does not carry the deleted video', () => {
    const { p, drop } = two();
    const q = withUsedAssets(p);
    expect(q.assets[drop]).toBeUndefined();
    expect(q.assets.dn2).toBeUndefined();
    expect(q.assets.k).toBeDefined();
    expect(withUsedAssets(q), 'nothing left to drop: the same object').toBe(q);
  });
});

describe('a hostile subtitle file (audit V-119)', () => {
  it('a line of two million digits is read at once', () => {
    const t0 = performance.now();
    parseSubtitles(`1\n${'9'.repeat(2_000_000)}:00:01,000 --> 00:00:02,000\nhi\n`);
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it('a cue with a million words does not overflow the stack', () => {
    expect(() => parseSubtitles(`1\n00:00:01,000 --> 00:00:02,000\n${'a '.repeat(1_000_000)}\n`)).not.toThrow();
  });
  it('hours still read', () => {
    expect(parseSubtitles('1\n01:00:01,000 --> 01:00:02,000\nhi\n')[0].t0).toBeCloseTo(3601, 3);
  });
});

describe('more faces than the shader has room for (audit V-163)', () => {
  const twelve = Array.from({ length: 12 }, (_, i) => [(i % 4) / 4 + 0.1, Math.floor(i / 4) / 3 + 0.1, 0.1, 0.1] as const);
  it('every face stays inside some rectangle', () => {
    const r = fitRects(twelve, 8);
    expect(r).toHaveLength(8);
    for (const f of twelve) {
      expect(r.some((x) => f[0] - f[2] / 2 >= x[0] - x[2] / 2 - 1e-9 && f[0] + f[2] / 2 <= x[0] + x[2] / 2 + 1e-9 && f[1] - f[3] / 2 >= x[1] - x[3] / 2 - 1e-9 && f[1] + f[3] / 2 <= x[1] + x[3] / 2 + 1e-9)).toBe(true);
    }
  });
  it('eight or fewer are left as they are', () => {
    expect(fitRects(twelve.slice(0, 8), 8)).toEqual(twelve.slice(0, 8));
  });
});

describe('turning a piece of a reversed clip back (audit V-209)', () => {
  it('each piece goes back to its own part of the video', () => {
    // A 10 s clip from second 2 of a long video, reversed, then cut in half: the first piece shows the last 5 s, the other the first 5 s.
    let right = '';
    const { p, id } = oneClip((c) => { c.assetId = 'rev'; c.in = 0; c.reversedFrom = { assetId: 'v', in: 2 }; });
    const q = produce(p, (d) => { d.assets.rev = { ...video('rev'), duration: 10 }; right = splitClip(d, id, 5)!; });
    expect(forwardIn(q, findClip(q, id)!.clip as VideoClip)).toBe(7);
    expect(forwardIn(q, findClip(q, right)!.clip as VideoClip)).toBe(2);
  });
  it('a forward video that is gone gives no way back', () => {
    const { p, id } = oneClip((c) => { c.assetId = 'v'; c.reversedFrom = { assetId: 'nope', in: 2 }; });
    expect(forwardIn(p, findClip(p, id)!.clip as VideoClip)).toBeNull();
  });
});

describe('a guide is not a voice (audit V-130)', () => {
  it('the mix without guides has one less sound to duck under', () => {
    const { p, id } = oneClip((c) => { c.guide = true; });
    expect(findClip(withoutGuides(p), id)).toBeNull();
  });
});
