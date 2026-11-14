// Sweep lane E2 (docs/21 §5): a reproducing test for audit V-211 — one failing track gave a storm of identical toasts,
// one per frame: "Details" could not be pressed and the error log was overwritten within a second.
import { beforeEach, describe, expect, it } from 'vitest';
import { errorMessage } from '../lib/telemetry';
import { useEditor } from './store';

const s = () => useEditor.getState();

describe('one failing track is one toast, not one per frame (audit V-211)', () => {
  beforeEach(() => useEditor.setState({ toasts: [], sheet: null }));

  it('the same decoder error on every frame of a second of playback leaves one toast, the first one, with its details', () => {
    const fail = new Error('Decoder failure');
    s().toast(errorMessage(fail), 'error');
    const first = s().toasts[0];
    expect(first.detail?.message, 'the toast keeps what support needs').toContain('Decoder failure');
    for (let frame = 1; frame < 60; frame++) s().toast(errorMessage(fail), 'error'); // the preview fails again each frame
    expect(s().toasts.map((x) => x.text), 'one toast on screen').toEqual([first.text]);
    // The toast under the finger is the one shown first: it is not replaced each frame, so "Details" can be pressed.
    expect(s().toasts[0].id).toBe(first.id);
    s().keep(first.id); // "Details" opened
    s().toast(errorMessage(fail), 'error');
    expect(s().toasts).toHaveLength(1);
    expect(s().toasts[0]).toMatchObject({ id: first.id, kept: true });
  });

  it('a different message still gets its own toast', () => {
    s().toast('The video decoder of this device stopped.', 'error');
    s().toast('Could not save the project.', 'error');
    expect(s().toasts).toHaveLength(2);
  });
});
