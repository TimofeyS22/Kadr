// Sweep lane E2 (docs/21 §5): a reproducing test for audit V-144 — reversing a clip with a speed curve took the source
// range as duration × speed, which a curve does not play: other frames, or a picture that froze. The range a reverse
// takes is seen at its limit (60 s of source): a curve that plays more source than duration × speed is refused, and one
// that plays less is not. The whole path, frames included, is in e2e/qa-verify-media.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { CURVE_PRESETS } from '../core/speed';
import { sourceSpan } from '../core/timeline';
import type { Project, VideoClip } from '../core/types';

vi.mock('../storage/db', () => ({ openMedia: async () => ({}) }));
vi.mock('./thumbs.worker', () => ({ renderThumbs: () => undefined })); // its worker entry runs where there is no document
vi.mock('./source', () => ({ openInput: () => { throw new Error('opened the file'); } }));
const { MAX_REVERSE_S, reverseClipSource } = await import('./reverse');

const curve = (id: string) => CURVE_PRESETS.find((p) => p.id === id)!.points;
const reverse = (duration: number, points: number[]) => {
  const clip = { id: 'c', kind: 'video', assetId: 'a', in: 0, start: 0, duration, speed: 1, curve: points } as unknown as VideoClip;
  const p = { assets: { a: { id: 'a', duration: 200 } } } as unknown as Project;
  return { span: sourceSpan(clip), run: reverseClipSource(p, clip, () => undefined, new AbortController().signal) };
};

describe('reversing a clip with a speed curve takes the source the curve plays (audit V-144)', () => {
  it('fast at first: 50 s on the timeline play over 60 s of source, too long to reverse', async () => {
    const r = reverse(50, curve('flashIn'));
    expect(r.span).toBeGreaterThan(MAX_REVERSE_S);
    await expect(r.run).rejects.toThrow(/Reverse works on clips up to/);
  });
  it('slow in the middle: 70 s on the timeline play under 60 s of source, which is reversed', async () => {
    const r = reverse(70, curve('hero'));
    expect(r.span).toBeLessThan(MAX_REVERSE_S);
    await expect(r.run).rejects.toThrow('opened the file');
  });
});
