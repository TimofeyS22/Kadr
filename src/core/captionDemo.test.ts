import { describe, expect, it } from 'vitest';
import { demoCaptionTime, demoCaptionWords, demoPhase, demoSettledTimes } from './captionDemo';
import { captionAt } from './captions';
import { createCaptionClip, createProject } from './defaults';
import { visualLayer } from './frame';
import { CAPTION_PRESETS } from './presets';

// The loop of the picker's animated previews (ui/picker.tsx, DEMO_LOOP_S) and its tick.
const LOOP_S = 2.4, TICK_S = 0.08;

describe('the demo of a caption template (the owner, 2026-11-13: every tile went black at the end of each loop)', () => {
  const project = createProject('demo', '9:16');
  const words = demoCaptionWords(['Смотри', 'до', 'конца']);

  it('has words on screen at every moment of the loop, for every template', () => {
    for (const pr of CAPTION_PRESETS) {
      const clip = createCaptionClip(words, pr);
      for (let time = 0; time < LOOP_S; time += TICK_S / 2) {
        const layer = visualLayer(project, clip, clip.start + demoCaptionTime(time, words));
        const s = layer.source;
        if (s.kind !== 'caption') throw new Error('not a caption');
        const at = `${pr.id} at ${time.toFixed(2)} s`;
        expect(s.words.length, at).toBeGreaterThan(0);
        expect(s.shown, at).toBeGreaterThan(0);
        // A word of a word-by-word template comes in from clear, as on the video: judged once it has started to show.
        const since = captionAt(clip, demoCaptionTime(time, words))!.since;
        if (since < 0.05) continue;
        expect(layer.opacity, at).toBeGreaterThan(0.1);
        expect(layer.scale, at).toBeGreaterThan(0.3);
      }
    }
  });

  it('holds the whole settled line from the last word to the end of the loop', () => {
    const end = demoCaptionTime(Infinity, words);
    expect(demoCaptionTime(LOOP_S - 0.001, words)).toBe(end);
    expect(demoCaptionTime(words.at(-1)!.t1 + 0.6, words)).toBe(end);
    for (const pr of CAPTION_PRESETS) {
      const clip = createCaptionClip(words, pr);
      const s = visualLayer(project, clip, clip.start + end).source;
      if (s.kind !== 'caption') throw new Error('not a caption');
      // Word by word shows its last word; every other layout the whole line.
      expect(s.shown, pr.id).toBe(s.words.length);
      expect(s.enter, pr.id).toBe(1);
    }
  });

  it('follows the loop time while the words are said', () => {
    expect(demoCaptionTime(0.7, words)).toBe(0.7);
    expect(demoCaptionTime(0, words)).toBeGreaterThan(0);
  });

  it('starts neighbouring tiles apart, so the strip never restarts as one', () => {
    const phases = [0, 1, 2, 3].map((i) => demoPhase(i, LOOP_S));
    expect(phases[0]).not.toBe(phases[1]);
    expect(phases[1]).not.toBe(phases[2]);
    expect(phases[3]).toBe(phases[0]);
    for (const p of phases) expect(p).toBeLessThan(LOOP_S);
  });

  it('sizes the tile on settled lines only', () => {
    for (const t of demoSettledTimes(words)) expect(t).toBeLessThanOrEqual(demoCaptionTime(Infinity, words));
    expect(demoSettledTimes(words)).toHaveLength(words.length + 1);
  });
});
