import { describe, expect, it } from 'vitest';
import { filmFrames, roundLeft, timeLeft } from './exportProgress';

describe('filmFrames', () => {
  it('spreads the slots evenly, each at the start of its part', () => {
    expect([...filmFrames(240, 8)]).toEqual([[0, [0]], [30, [1]], [60, [2]], [90, [3]], [120, [4]], [150, [5]], [180, [6]], [210, [7]]]);
  });
  it('fills every slot of a film shorter than its slots', () => {
    const at = filmFrames(3, 8);
    expect([...at.values()].flat().sort()).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(Math.max(...at.keys())).toBeLessThan(3);
  });
  it('takes nothing from an empty film', () => {
    expect(filmFrames(0, 8).size).toBe(0);
  });
});

describe('timeLeft and roundLeft', () => {
  it('says nothing in the first 5% or 2 s, nor when done', () => {
    expect(timeLeft(10, 0.04)).toBeNull();
    expect(timeLeft(1.9, 0.5)).toBeNull();
    expect(timeLeft(10, 1)).toBeNull();
  });
  it('goes at the pace so far', () => {
    expect(timeLeft(10, 0.5)).toBe(10);
    expect(timeLeft(4, 0.2)).toBe(16);
  });
  it('rounds up to 5 s, and to whole minutes from a minute', () => {
    expect(roundLeft(0.4)).toEqual({ s: 5 });
    expect(roundLeft(11)).toEqual({ s: 15 });
    expect(roundLeft(59.5)).toEqual({ s: 60 });
    expect(roundLeft(61)).toEqual({ min: 2 });
  });
});
