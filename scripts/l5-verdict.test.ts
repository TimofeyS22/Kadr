// @ts-expect-error a plain ES module script, no types
import * as V from './l5-verdict.mjs';
// @ts-expect-error a plain ES module script, no types
import { picked } from './l5-sweep.mjs';
import { describe, expect, it } from 'vitest';

type Check = { name: string; ok: boolean; value: unknown; limit: string };
type Row = { name: string; ok: boolean; note?: unknown; error?: string; toasts?: string[]; errors?: string[]; crashed?: string };

describe('a threshold and a row', () => {
  it('holds the queue’s words: ≤, ≥, ±, and a missing value never passes', () => {
    expect(V.atMost('p90', 100, 100, ' мс').ok).toBe(true);
    expect(V.atMost('p90', 101, 100).ok).toBe(false);
    expect(V.atMost('p90', null, 100).ok).toBe(false);
    expect(V.atMost('p90', NaN, 100).ok).toBe(false);
    expect(V.atLeast('fps', 29, 29).ok).toBe(true);
    expect(V.below('скачок', 1.3, 1.3).ok).toBe(false);
    expect(V.near('LUFS', -13, -14, 1).ok).toBe(true);
    expect(V.near('LUFS', -12.9, -14, 1).ok).toBe(false);
    expect(V.near('LUFS', -14, -14, 1).limit).toBe('-14 ± 1');
    expect(V.none('тосты', ['a', 'b']).ok).toBe(false);
    expect(V.record('пик', 5).ok).toBe(true);
  });

  it('writes numbers as the reports do: a decimal comma, two decimals at most, a dash for nothing', () => {
    expect(V.fmt(0.8333)).toBe('0,83');
    expect(V.fmt(120)).toBe('120');
    expect(V.fmt(null)).toBe('—');
    expect(V.fmt(Infinity)).toBe('—');
    expect(V.fmt(true)).toBe('да');
  });

  it('judges a row: FAIL beats LOOK, nothing measured is ERROR, not PASS', () => {
    const ok = V.atMost('a', 1, 2), bad = V.atMost('b', 3, 2);
    expect(V.judge('X', [ok]).status).toBe('PASS');
    expect(V.judge('X', [ok, bad]).status).toBe('FAIL');
    expect(V.judge('X', [ok], { look: 'снимок' }).status).toBe('LOOK');
    expect(V.judge('X', [bad], { look: 'снимок' }).status).toBe('FAIL');
    expect(V.judge('X', []).status).toBe('ERROR');
    expect(V.judge('X', [ok], { error: 'button not found' }).status).toBe('ERROR');
    expect(V.judge('X', [null, ok]).checks).toHaveLength(1);
  });

  it('prints the measured value beside its threshold, and the journal row escapes the table’s bars', () => {
    const r = V.judge('V-248', [V.atMost('p90', 84, 100, ' мс'), V.none('тосты', ['a | b'])]);
    expect(V.line(r)).toContain('FAIL  V-248 — p90 84 мс (порог ≤ 100 мс); ✗ тосты 1 (порог = 0): a | b');
    expect(V.mdRow(r)).toBe('| V-248 | **не прошла** | p90 84 мс; ✗ тосты 1 | p90 ≤ 100 мс; тосты = 0 |');
    expect(V.mdRow(V.judge('Y', [], { error: 'a|b' }))).toContain('a/b');
    expect(V.totals([r, V.judge('Z', [V.atMost('a', 1, 2)])])).toEqual({ PASS: 1, FAIL: 1, ERROR: 0, LOOK: 0 });
  });

  it('counts «k из n» and takes the nearest-rank percentile', () => {
    expect(V.kOfN('целый', [1, 2, 3], (x: number) => x > 0, 3)).toMatchObject({ value: '3 из 3', ok: true });
    expect(V.kOfN('целый', [1, 2], (x: number) => x > 0, 3).ok).toBe(false); // fewer runs than the row asks for
    expect(V.kOfN('целый', [1, -2, 3], (x: number) => x > 0, 3).ok).toBe(false);
    const xs = Array.from({ length: 40 }, (_, i) => i + 1);
    expect(V.percentile(xs, 0.9)).toBe(36);
    expect(V.percentile(xs, 0.95)).toBe(38);
    expect(V.percentile([], 0.9)).toBeNaN();
  });
});

describe('the rows of l5-tools', () => {
  it('reads its JSON lines and skips its other words and a line cut by a killed process', () => {
    const text = 'L5: something\n{"name":"scrub","ok":true,"note":{"firstP90":80}}\n{"name":"cut\n{"name":"s1-journal","ok":false,"error":"x"}\n';
    expect(V.toolsRows(text).map((r: Row) => r.name)).toEqual(['scrub', 's1-journal']);
  });

  const run = (extra: Partial<Row> & { note?: Record<string, unknown> } = {}): Row => ({ name: 's1-camera', ok: true, toasts: [], errors: [], ...extra,
    note: { takes: Array.from({ length: 5 }, (_, i) => ({ take: i + 1, got: 'clip', said: [] })), strips: { clips: 5, thumbs: 5 }, leases: { renewed: 0, failed: 0 }, ...extra.note } });
  const runs = (n: number, f: (i: number) => Row = () => run()) => Array.from({ length: n }, (_, i) => f(i));
  const statuses = (rows: Row[]) => V.cameraRuns(rows, 60).map((r: { status: string }) => r.status);

  it('S-1-13 and S-1-12 pass on 60 quiet runs of five takes', () => {
    expect(statuses(runs(60))).toEqual(['PASS', 'PASS']);
  });
  it('one error on screen, one empty film strip or a dead tab fails S-1-13', () => {
    expect(statuses(runs(60, (i) => (i === 7 ? run({ ok: false, toasts: ['This file could not be read'] }) : run())))[0]).toBe('FAIL');
    expect(statuses(runs(60, (i) => (i === 7 ? run({ note: { strips: { clips: 5, thumbs: 4 } } }) : run())))[0]).toBe('FAIL');
    expect(statuses(runs(60, (i) => (i === 7 ? run({ note: { takes: [{ take: 1, got: 'clip', said: ['The video decoder of this device stopped'] }] } }) : run())))[0]).toBe('FAIL');
    expect(statuses(runs(60, (i) => (i === 7 ? run({ ok: false, crashed: 'the page lost its state' }) : run())))[0]).toBe('FAIL');
  });
  it('new leases are allowed in 2 runs of 60, not in 3', () => {
    const leased = (k: number) => runs(60, (i) => (i < k ? run({ note: { leases: { renewed: 1, failed: 0 } } }) : run()));
    expect(statuses(leased(2))[0]).toBe('PASS');
    expect(statuses(leased(3))[0]).toBe('FAIL');
  });
  it('runs lost to the cable are not counted, but at most 2 of the planned may be lost', () => {
    const lost = (k: number) => runs(60, (i) => (i < k ? { name: 's1-camera', ok: false, error: 'TypeError: fetch failed' } : run()));
    expect(statuses(lost(2))).toEqual(['PASS', 'PASS']);
    expect(statuses(lost(3))[0]).toBe('FAIL');
  });
  it('a take that did not land fails S-1-12; fewer than 100 takes is not enough to say', () => {
    const [, s112] = V.cameraRuns(runs(60, (i) => (i === 3 ? { name: 's1-camera', ok: false, error: 'takes that did not land: [{"take":2,"got":"no clip in 40 s"}]' } : run())), 60);
    expect(s112.status).toBe('FAIL');
    expect(V.cameraRuns(runs(19), 19)[1].status).toBe('FAIL'); // 95 takes
  });
});

describe('what ffmpeg says, as numbers', () => {
  it('reads ebur128’s summary: integrated loudness, sample and true peak', () => {
    const said = '[Parsed_ebur128_0 @ 0x1] t: 1 M: -20\n[Parsed_ebur128_0 @ 0x1] Summary:\n\n  Integrated loudness:\n    I:         -14.3 LUFS\n    Threshold: -24.5 LUFS\n\n  Loudness range:\n    LRA:         5.1 LU\n\n  Sample peak:\n    Peak:       -1.2 dBFS\n\n  True peak:\n    Peak:       -0.7 dBFS\n';
    expect(V.parseEbur128(said)).toEqual({ lufs: -14.3, samplePeak: -1.2, truePeak: -0.7 });
    expect(V.parseEbur128('Summary:\n    I:         -inf LUFS').lufs).toBe(-Infinity);
    expect(V.parseVolume('mean_volume: -23.4 dB\nmax_volume: -3.0 dB')).toEqual({ mean: -23.4, max: -3 });
  });

  it('pairs each white frame with its beep and holds them to a frame', () => {
    const luma = [[0.967, 16], [1.0, 235], [1.033, 16], [5.0, 235], [5.033, 16]].map(([t, y]) => `frame:0 pts:0 pts_time:${t}\nlavfi.signalstats.YAVG=${y}`).join('\n');
    const quiet = 'silence_end: 1.02 | silence_duration: 1\nsilence_end: 5.05 | silence_duration: 3.9';
    const s = V.avOffsets(luma, quiet);
    expect(s).toEqual({ flashes: [1, 5], offsets: [20, 50] });
    expect(V.inSync(s, 2).map((c: Check) => c.ok)).toEqual([true, false]);
    expect(V.avOffsets(luma, '').offsets).toEqual([Infinity, Infinity]);
  });

  it('finds AAC packets that are not 1024 samples, but the last', () => {
    expect(V.brokenPackets('0,1024\n1024,1024\n2048,512\n2560,300\n', 48000)).toEqual(['0.043 s: 512']);
    expect(V.brokenPackets('0,1024\n1024,200\n', 48000)).toEqual([]);
  });

  it('reads ffprobe as the facts a row checks, and a whole file is its length with its streams', () => {
    const p = V.probeSummary({ streams: [{ codec_type: 'video', codec_name: 'h264', profile: 'High', width: 1080, height: 1920, nb_read_frames: '300' }, { codec_type: 'audio', codec_name: 'aac' }], format: { duration: '10.0' } });
    expect(p).toMatchObject({ codec: 'h264', profile: 'High', frames: 300, fps: 30, audio: 'aac' });
    expect(V.wholeFile(p, { duration: 10.05, minHeight: 1080 }).every((c: Check) => c.ok)).toBe(true);
    expect(V.wholeFile(p, { duration: 10.2 }).every((c: Check) => c.ok)).toBe(false);
    expect(V.wholeFile({ ...p, frames: 290 }, {}).every((c: Check) => c.ok)).toBe(false);
    expect(V.wholeFile({ ...p, audio: null }, {}).every((c: Check) => c.ok)).toBe(false);
  });
});

describe('V-153: the joins of the export’s sound', () => {
  const tone = (dip = 1) => Float32Array.from({ length: 12 * 48000 }, (_, i) => Math.sin((2 * Math.PI * 1000 * i) / 48000) * 0.5 * (i >= 4 * 48000 - 240 && i < 4 * 48000 + 240 ? dip : 1));
  it('a steady tone passes at every join', () => {
    const rows = V.joins(tone());
    expect(rows.map((r: { at: number }) => r.at)).toEqual([2, 4, 6, 8, 10]);
    expect(V.joinChecks(rows).every((c: Check) => c.ok)).toBe(true);
  });
  it('a dip at 4 s fails', () => {
    expect(V.joinChecks(V.joins(tone(0.5))).every((c: Check) => c.ok)).toBe(false);
  });
});

describe('WYSIWYG of the preview, the photo and the frame', () => {
  const pic = (f: (i: number) => number) => Uint8Array.from({ length: 135 * 240 * 3 }, (_, i) => f(i));
  it('the same picture passes, a red cast fails', () => {
    const a = pic((i) => (i * 7) % 200);
    expect(V.sameFrame('x', a, a, a).every((c: Check) => c.ok)).toBe(true);
    const red = pic((i) => ((i * 7) % 200) + (i % 3 === 0 ? 3 : 0));
    expect(V.colourCast(red, a)).toBeCloseTo(3, 5);
    expect(V.sameFrame('x', red, a, a).map((c: Check) => c.ok)).toEqual([true, true, true, false]);
  });
  it('a block that differs fails the worst block, not the mean', () => {
    const a = pic(() => 100), b = pic((i) => { const px = Math.floor(i / 3), x = px % 135, y = Math.floor(px / 135); return x < 15 && y < 15 ? 140 : 100; });
    expect(V.meanAbsDiff(a, b)).toBeLessThan(4);
    expect(V.worstBlockCast(a, b)).toBeCloseTo(40, 5);
  });
});

describe('captions and the run’s choice of rows', () => {
  it('counts the words the captions got wrong as captions-eval does', () => {
    expect(V.wer('Привет, мир! Всё хорошо.', 'привет мир все хорошо')).toBe(0);
    expect(V.wer('один два три четыре', 'один три четыре пять')).toBe(50);
  });
  it('picks rows by ID and by the price of their failure', () => {
    expect(picked('V-248', 4, undefined, undefined)).toBe(true);
    expect(picked('V-248', 4, 'V-24', undefined)).toBe(true);
    expect(picked(['S-1-13, S-1-13-1 (М3)', 'S-1-12'], 1, 'S-1-12', undefined)).toBe(true);
    expect(picked('V-248', 4, 'V-171', undefined)).toBe(false);
    expect(picked('V-248', 4, undefined, '1,2')).toBe(false);
    expect(picked('SW-A-19', 1, undefined, '1,2')).toBe(true);
  });
});
