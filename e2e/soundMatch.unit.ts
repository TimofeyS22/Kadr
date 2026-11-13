import { describe, expect, it } from 'vitest';
import { compareSound } from './soundMatch';

// The scene of the Q-24 e2e test, made of numbers: a whoosh (noise) at 0.5 s and a voice-over at 2.5 s, which the test
// records from a fake microphone, a 330 Hz tone that swells and fades four times a second. Where the swell is when the
// compared window starts and ends depends on when the recording began, so every phase of it is a run of that test.
const rate = 48000;
const ws = 0.52, wd = 0.67, vs = 2.52, vd = 2.1;

function scene(phase: number) {
  let seed = 7;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const exported = new Float32Array(Math.round(5.5 * rate));
  for (let i = Math.round(ws * rate); i < Math.round((ws + wd) * rate); i++) exported[i] = 0.3 * noise();
  const v0 = Math.round(vs * rate);
  for (let i = v0; i < Math.round((vs + vd) * rate); i++) {
    const t = (i - v0) / rate;
    exported[i] = (0.25 + 0.2 * Math.sin(2 * Math.PI * 4 * t + phase)) * Math.sin(2 * Math.PI * 330 * t);
  }
  return exported;
}

/** What the preview played: the export after the clock's wait, with the voice-over `voiceLate` samples late, and AAC's
 * few tenths of a percent of noise on top. From `silentFrom` seconds of the export on, nothing: a starved realtime engine
 * that stopped sounding mid-sentence. */
function preview(exported: Float32Array, voiceLate = 0, silentFrom = Infinity) {
  let seed = 11;
  const noise = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const wait = 9637; // 200 ms and a bit: the line-up must find it, not assume it
  const played = new Float32Array(wait + exported.length + rate);
  const v0 = Math.round(vs * rate), v1 = Math.round((vs + vd) * rate);
  for (let i = 0; i < exported.length; i++) {
    const voice = i >= v0 && i < v1;
    played[wait + i + (voice ? voiceLate : 0)] += exported[i];
  }
  for (let i = 0; i < played.length; i++) played[i] += 0.003 * noise();
  if (silentFrom < Infinity) played.fill(0, wait + Math.round(silentFrom * rate));
  return played;
}

const windows = [['whoosh', ws + 0.05, ws + wd - 0.05], ['voice-over', vs + 0.1, vs + vd - 0.1]] as const;
const timing = (played: Float32Array, exported: Float32Array) => {
  const { stats: [whoosh, voice], drops } = compareSound(played, exported, rate, windows);
  return { whoosh, voice, drops };
};
type Stat = ReturnType<typeof timing>['voice'];
/** What the e2e test asserts for each sound (`editor.spec.ts`, Q-24). */
const fails = (s: Stat) => Math.abs(s.shiftMs) >= 0.05 || Math.abs(s.gain - 1) >= 0.03 || Math.abs(s.envGain - 1) >= 0.03 || s.envRest >= 0.04 || (s.name === 'voice-over' && s.rest >= 0.06);

describe('compareSound: the timing of each sound', () => {
  // Q-24-1: the e2e test failed now and then with the voice-over 3.021 ms early (145 samples, one period of 330 Hz),
  // though the preview matched the file to the sample. Each phase of the swell is one such run.
  it.each([0, 45, 90, 135, 180, 225, 270, 315])('a preview equal to the file is on time, whatever the swell (%i°)', (deg) => {
    const exported = scene((deg * Math.PI) / 180);
    const { whoosh, voice } = timing(preview(exported), exported);
    expect(whoosh.shiftMs).toBe(0);
    expect(voice.shiftMs).toBe(0);
    expect(fails(whoosh) || fails(voice)).toBe(false);
  }, 120_000);

  // The control (docs/11 §5): what the test is there to catch, it still catches. One sound late against the other, so
  // the measure is their difference (the mix lines up on one of them).
  it.each([
    [1, 'one sample, under the threshold', false],
    [48, '1 ms', true],
    [145, 'one period of the tone, the size of Q-24-1', true],
  ])('a voice-over %i samples late (%s) is found that late', (late, _, failsE2e) => {
    const exported = scene(Math.PI / 2);
    const { whoosh, voice } = timing(preview(exported, late), exported);
    expect(voice.shiftMs - whoosh.shiftMs).toBeCloseTo(late / 48, 3);
    expect(fails(whoosh) || fails(voice)).toBe(failsE2e);
  }, 120_000);

  it('a voice-over 50 ms late, beyond the ±5 ms the timing looks in, still fails the test', () => {
    const exported = scene(Math.PI / 2);
    const { whoosh, voice } = timing(preview(exported, 2400), exported);
    expect(fails(whoosh) || fails(voice)).toBe(true);
  }, 120_000);

  it.each([0, 90, 180, 270])('a preview that stops mid-sentence fails for the dropout, not for its timing (%i°)', (deg) => {
    // As a run did at load average 300: the preview played the first 1.1 s of the voice-over and then nothing, and the
    // block where it broke off (here 3.6137 s, in the middle of one) pulled the line-up a period early.
    const exported = scene((deg * Math.PI) / 180);
    const { whoosh, voice, drops } = timing(preview(exported, 0, vs + 1.0937), exported);
    expect(drops.length).toBeGreaterThan(40);
    expect(whoosh.shiftMs).toBe(0);
    expect(voice.shiftMs).toBe(0);
  }, 120_000);
});
