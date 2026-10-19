// QA (docs/11 §3.6, §3.15): subtitle files come from anywhere; the parser must stay sane and fast on any of them.
import { describe, expect, it } from 'vitest';
import { parseSubtitles } from './captions';

describe('parseSubtitles on hostile files', () => {
  it('a cue that ends before it starts gives no word that ends before it starts', () => {
    const w = parseSubtitles('1\n00:00:05,000 --> 00:00:02,000\nbackwards cue here\n');
    for (const x of w) expect(x.t1).toBeGreaterThanOrEqual(x.t0);
  });

  it('garbage, binary and an empty file give no words and do not throw', () => {
    expect(parseSubtitles('')).toEqual([]);
    expect(parseSubtitles('not subtitles at all\n\njust text')).toEqual([]);
    expect(parseSubtitles(String.fromCharCode(...Array.from({ length: 5000 }, (_, i) => (i * 7919) % 256)))).toEqual([]);
  });

  it('10 000 cues parse in well under a second', () => {
    const t = (s: number) => `00:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')},000`;
    const srt = Array.from({ length: 10_000 }, (_, i) => `${i + 1}\n${t(i)} --> ${t(i + 1)}\nword number ${i}\n`).join('\n');
    const t0 = performance.now();
    const w = parseSubtitles(srt);
    expect(performance.now() - t0).toBeLessThan(1000);
    expect(w.length).toBe(30_000);
  });

  it('a pathological tag line does not hang the tag stripper', () => {
    const t0 = performance.now();
    parseSubtitles(`1\n00:00:01,000 --> 00:00:02,000\n${'<'.repeat(200_000)}x\n`);
    expect(performance.now() - t0).toBeLessThan(1000);
  });
});
