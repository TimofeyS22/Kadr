import { describe, expect, it } from 'vitest';
import { formatTime } from './format';

describe('timeline time (S-1-5)', () => {
  it('minutes and seconds under an hour, as before', () => {
    expect(formatTime(0)).toBe('0:00.0');
    expect(formatTime(4.2156)).toBe('0:04.2');
    expect(formatTime(125.3)).toBe('2:05.3');
    expect(formatTime(125.9, false)).toBe('2:05');
  });
  it('hours from an hour: ten hours are 10:00:00.0, not 600:00.0', () => {
    expect(formatTime(3600)).toBe('1:00:00.0');
    expect(formatTime(36000)).toBe('10:00:00.0');
    expect(formatTime(3725.4)).toBe('1:02:05.4');
    expect(formatTime(3725.4, false)).toBe('1:02:05');
  });
  it('rounds as a whole: no 0:60.0', () => {
    expect(formatTime(59.96)).toBe('1:00.0');
    expect(formatTime(3599.96)).toBe('1:00:00.0');
  });
});
