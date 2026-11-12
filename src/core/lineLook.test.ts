import { produce } from 'immer';
import { expect, it } from 'vitest';
import { canSwap, editLine, lineSize, lineView, setLineSize, swapLines } from './lineLook';
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

it('works on an immer draft, as the store hands it (a draft cannot be structuredClone-d)', () => {
  for (const choice of ['all', 0, 1] as const) {
    const s = produce(pair(), (d) => { editLine(d, choice, (v) => { v.letterSpacing = 0.3; v.lineHeight = 2; }); });
    expect(s.lineHeight, `choice ${choice}`).toBe(2);
    if (choice === 'all') expect([s.letterSpacing, s.lines![1].letterSpacing]).toEqual([0.3, undefined]);
    else expect(s.lines![choice].letterSpacing).toBe(0.3);
  }
});

it('«Поменять местами»: the lines trade places with their looks, and a second tap gives back the first', () => {
  const s0 = pair(), text0 = 'Лето\nв городе';
  let text = text0;
  const s = produce(s0, (d) => { text = swapLines(text, d); });
  expect(text).toBe('в городе\nЛето');
  expect(s.lines!.map((l) => l.font)).toEqual(['tenor', 'greatVibes']);
  expect(s.lines![0], 'the small line keeps its capitals and spacing').toMatchObject({ uppercase: true, letterSpacing: 0.25, scale: 0.5 });
  const back = produce(s, (d) => { text = swapLines(text, d); });
  expect(text).toBe(text0);
  expect(back).toEqual(s0);
});

it('«Поменять местами» is offered only on two lines in two faces', () => {
  expect(canSwap('Лето\nв городе', pair())).toBe(true);
  expect(canSwap('Лето в городе', pair()), 'one line').toBe(false);
  expect(canSwap('a\nb\nc', pair()), 'three lines').toBe(false);
  const { lines: _, ...one } = pair();
  expect(canSwap('Лето\nв городе', one), 'one face').toBe(false);
  let text = 'Лето в городе';
  const same = produce(pair(), (d) => { text = swapLines(text, d); });
  expect([text, same]).toEqual(['Лето в городе', pair()]);
});
