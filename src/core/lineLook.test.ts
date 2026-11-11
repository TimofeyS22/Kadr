import { expect, it } from 'vitest';
import { editLine, lineSize, lineView, setLineSize } from './lineLook';
import type { TextStyle } from './types';

const pair = (): TextStyle => ({
  font: 'tenor', size: 0.05, weight: 400, italic: false, color: '#ffffff', align: 'center', stroke: null, background: null, shadow: true,
  lines: [{ font: 'greatVibes', scale: 2.2 }, { font: 'tenor', scale: 0.5, uppercase: true, letterSpacing: 0.25 }],
});

it('a line shows its own fields over the block', () => {
  const v = lineView(pair(), 1);
  expect(v).toMatchObject({ font: 'tenor', uppercase: true, letterSpacing: 0.25, color: '#ffffff' });
  expect(lineView(pair(), 'all')).toEqual(pair());
});

it('on one line, its own fields go to its look and the rest to the block', () => {
  const s = pair();
  editLine(s, 0, (v) => { v.italic = true; v.color = '#ffd60a'; v.stroke = { color: '#000000', width: 0.08 }; });
  expect(s.lines![0]).toMatchObject({ italic: true, color: '#ffd60a' });
  expect(s.italic).toBe(false);
  expect(s.color).toBe('#ffffff');
  expect(s.stroke, 'the outline is the block\'s').toEqual({ color: '#000000', width: 0.08 });
  expect(s.lines![1].color, 'the other line untouched').toBeUndefined();
});

it('a field taken off on a line is taken off its look, not the block', () => {
  const s = pair();
  editLine(s, 1, (v) => { delete v.uppercase; });
  expect(s.lines![1].uppercase).toBeUndefined();
  expect(s.lines![1].letterSpacing).toBe(0.25);
});

it('on the whole text, the edit reaches every line: a field the lines set for themselves is cleared', () => {
  const s = pair();
  editLine(s, 'all', (v) => { v.letterSpacing = 0.1; v.uppercase = false; });
  expect(s.letterSpacing).toBe(0.1);
  expect(s.lines!.every((l) => l.letterSpacing === undefined && l.uppercase === undefined)).toBe(true);
  expect(s.lines![0].font, 'the faces stay').toBe('greatVibes');
});

it('the size slider of a line sets its share of the block, held to 0.3–3', () => {
  const s = pair();
  expect(lineSize(s, 0)).toBeCloseTo(0.11);
  setLineSize(s, 0, 0.1);
  expect(s.lines![0].scale).toBeCloseTo(2);
  setLineSize(s, 1, 0.5);
  expect(s.lines![1].scale).toBe(3);
  setLineSize(s, 'all', 0.07);
  expect(s.size).toBe(0.07);
});
