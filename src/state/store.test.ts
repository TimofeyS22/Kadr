import { beforeEach, describe, expect, it } from 'vitest';
import { createProject } from '../core/defaults';
import { useEditor } from './store';

const s = () => useEditor.getState();

describe('editor history', () => {
  beforeEach(() => s().open(createProject('h', '9:16')));

  it('undo/redo walk through commits', () => {
    s().commit((d) => { d.name = 'a'; });
    s().commit((d) => { d.name = 'b'; });
    s().undo();
    expect(s().project!.name).toBe('a');
    s().redo();
    expect(s().project!.name).toBe('b');
    s().undo();
    s().undo();
    expect(s().project!.name).toBe('h');
    expect(s().past.length).toBe(0);
  });

  it('amend (background results) adds no undo step and keeps redo', () => {
    s().commit((d) => { d.name = 'a'; });
    s().amend((d) => { d.settings.fps = 25; }); // e.g. processed sound attached later
    expect(s().past.length).toBe(1);
    s().undo();
    expect(s().project!.name).toBe('h');
    s().redo();
    expect(s().project!.name).toBe('a');
    expect(s().project!.settings.fps).toBe(25);
    s().undo();
    s().amend((d) => { d.settings.fps = 24; });
    expect(s().future.length).toBe(1); // redo survives
  });

  it('commits with the same key coalesce into one undo step', () => {
    for (const n of ['x', 'xy', 'xyz']) s().commit((d) => { d.name = n; }, 'name');
    expect(s().past.length).toBe(1);
    s().undo();
    expect(s().project!.name).toBe('h');
  });

  it('gesture edits re-apply to the base snapshot instead of accumulating', () => {
    const base = s().project!;
    for (let i = 1; i <= 3; i++) s().commit((d) => { d.settings.fps = 30 + i; }, 'g', base);
    expect(s().project!.settings.fps).toBe(33);
    expect(s().past).toEqual([base]);
  });

  it('no-op commits do not touch history', () => {
    s().commit(() => undefined);
    expect(s().past.length).toBe(0);
  });

  it('a new commit clears the redo stack', () => {
    s().commit((d) => { d.name = 'a'; });
    s().undo();
    s().commit((d) => { d.name = 'c'; });
    expect(s().future.length).toBe(0);
  });
});
