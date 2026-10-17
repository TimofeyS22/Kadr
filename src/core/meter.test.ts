import { describe, expect, it } from 'vitest';
import { METER_IDLE, meterStep } from './meter';

describe('recording meter (docs/09 Q5)', () => {
  it('holds the peak for a second, then follows the signal down', () => {
    let s = meterStep(METER_IDLE, 0.7, 0);
    s = meterStep(s, 0.2, 500);
    expect(s.hold).toBe(0.7);
    s = meterStep(s, 0.2, 1200);
    expect(s.hold).toBe(0.2);
  });

  it('a full-scale sample lights the clip mark for 1.5 s; loud but clean speech never does', () => {
    let s = meterStep(METER_IDLE, 0.9, 0);
    expect(s.clip).toBe(false);
    s = meterStep(s, 0.99, 100);
    expect(s.clip).toBe(true);
    s = meterStep(s, 0.3, 1500);
    expect(s.clip).toBe(true);
    s = meterStep(s, 0.3, 1700);
    expect(s.clip).toBe(false);
  });
});
