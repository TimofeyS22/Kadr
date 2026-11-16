// SW-E2-1 (found by lane E2): past 500 steps the start of the history was let go without a word, and Undo then stood
// still at the cut. The limit stays (a phone's memory); the person is told once, and an Undo at the cut says why.
import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../core/defaults';
import { useEditor } from './store';

const s = () => useEditor.getState();
const said = (part: string) => s().toasts.filter((x) => x.text.includes(part)).length;
const edits = (n: number, from = 0) => { for (let i = from; i < from + n; i++) s().commit((d) => { d.name = `n${i}`; }); };

describe('SW-E2-1: the history keeps the last 500 steps and says so', () => {
  beforeEach(() => { useEditor.setState({ toasts: [] }); s().open(createProject('h', '9:16')); });

  it('500 steps are kept whole and nothing is said', () => {
    edits(500);
    expect(s().past.length).toBe(500);
    expect(said('500')).toBe(0);
    for (let i = 0; i < 500; i++) s().undo();
    expect(s().project!.name).toBe('h');
  });

  it('the 501st step lets the first one go and says so once; 1000 steps still say it once', () => {
    edits(501);
    expect(s().past.length).toBe(500);
    expect(said('Undo keeps the last 500 steps')).toBe(1);
    edits(499, 501);
    expect(said('Undo keeps the last 500 steps')).toBe(1);
  });

  it('Undo at the cut says that earlier steps are not kept, instead of standing still', () => {
    edits(600);
    for (let i = 0; i < 500; i++) s().undo();
    expect(s().past.length).toBe(0);
    expect(s().project!.name).toBe('n99'); // the oldest kept step
    s().undo();
    expect(s().project!.name).toBe('n99');
    expect(said('Earlier steps are not kept')).toBe(1);
  });

  it('a new project starts with its whole history and nothing said', () => {
    edits(501);
    s().open(createProject('k', '9:16'));
    edits(10);
    for (let i = 0; i < 10; i++) s().undo();
    s().undo();
    expect(said('Earlier steps are not kept')).toBe(0);
  });
});
