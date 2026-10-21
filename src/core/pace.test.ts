import { describe, expect, it } from 'vitest';
import { finishPace, paceAt, reportPace, startPace } from './pace';

const stages = [{ id: 'model', expected: 10 }, { id: 'prepare', expected: 2 }, { id: 'transcribe', expected: 20 }];

describe('honest progress (docs/09 Q4)', () => {
  it('lays stages out by expected time, each with a visible slice', () => {
    const p = startPace([...stages, { id: 'tiny', expected: 0 }], 0);
    expect(p.spans[0].a).toBe(0);
    expect(p.spans.at(-1)!.b).toBeCloseTo(1, 9);
    expect(p.spans[2].b - p.spans[2].a).toBeGreaterThan(p.spans[0].b - p.spans[0].a); // 20 s > 10 s
    expect(p.spans[3].b - p.spans[3].a).toBeGreaterThan(0.02); // a quick stage still shows
  });

  it('creeps while the job is silent, never reaching the stage end, never going back', () => {
    const p = startPace(stages, 0);
    const end = p.spans[0].b;
    let last = 0;
    for (let t = 0; t <= 600_000; t += 500) { // ten minutes of silence in the first stage
      const v = paceAt(p, t);
      expect(v).toBeGreaterThanOrEqual(last);
      expect(v).toBeLessThan(end);
      last = v;
    }
    expect(last).toBeGreaterThan(p.spans[0].a + 0.8 * (end - p.spans[0].a));
  });

  it('a report that lands below what is shown does not pull the bar back; a later stage moves it on', () => {
    const p = startPace(stages, 0);
    const v1 = paceAt(p, 8000);
    reportPace(p, 'model', 0.1, 8000); // the download reports late and low
    expect(paceAt(p, 8001)).toBeGreaterThanOrEqual(v1);
    reportPace(p, 'transcribe', 0, 9000); // the model was cached: "prepare" skipped
    expect(paceAt(p, 9000)).toBeGreaterThanOrEqual(p.spans[2].a);
    reportPace(p, 'prepare', null, 9500); // a stale report for an earlier stage is ignored
    expect(p.i).toBe(2);
    reportPace(p, 'transcribe', 0.5, 15_000);
    expect(paceAt(p, 15_000)).toBeGreaterThanOrEqual(p.spans[2].a + 0.5 * (p.spans[2].b - p.spans[2].a));
    expect(paceAt(p, 100_000)).toBeLessThan(1);
  });

  it('records how long each stage took, so the next run can expect it', () => {
    const p = startPace(stages, 0);
    reportPace(p, 'prepare', null, 4000);
    reportPace(p, 'transcribe', null, 5000);
    const took = finishPace(p, 12_000);
    expect(took).toEqual({ model: 4, prepare: 1, transcribe: 7 });
    expect(paceAt(p, 12_000)).toBe(1);
  });

  it('a stage the job reports as fully measured still waits for the job: the bar never reads 100% before the end', () => {
    const p = startPace([{ id: 'transcribe', expected: 4 }, { id: 'music', expected: 2.5 }], 0);
    reportPace(p, 'music', 1, 1000); // the track is downloaded; it still has to be read and placed
    for (const t of [1000, 2000, 10_000, 600_000]) expect(Number(paceAt(p, t).toFixed(4)), `at ${t} ms`).toBeLessThan(1);
    finishPace(p, 600_001);
    expect(paceAt(p, 600_002)).toBe(1);
  });
});
