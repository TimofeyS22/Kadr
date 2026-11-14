// A clip whose file has no sound has no sound to process (SW-D-1). Its settings still ask for some: natural pitch is on
// by default, so 2× on a screen recording asked for a pitch-kept copy of nothing, and the export failed with
// "This clip has no sound" on both engines.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { prepareClipSound as Prepare } from './audiofx';
import type { Asset, Project, VideoClip } from '../core/types';

let prepareClipSound: typeof Prepare;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
  vi.stubGlobal('self', globalThis);
  ({ prepareClipSound } = await import('./audiofx'));
}, 120_000); // the engine's imports take seconds to load on a busy Mac

const silent: Asset = { id: 'a1', kind: 'video', name: 'screen.mp4', duration: 4, width: 640, height: 360, hasAudio: false } as Asset;
const clip = (over: Partial<VideoClip>): VideoClip => ({
  kind: 'video', id: 'c1', assetId: 'a1', start: 0, duration: 2, in: 0, speed: 2, volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
  ...over,
} as VideoClip);
const project = { assets: { a1: silent }, tracks: [] } as unknown as Project;

describe('sound settings on a clip without sound', () => {
  for (const [name, over] of [
    ['2× with natural pitch (the default)', {}],
    ['enhance voice', { speed: 1, enhance: true }],
    ['noise reduction', { speed: 1, denoise: true }],
    ['a voice effect at 1.5×', { speed: 1.5, voice: 'robot' }],
  ] as const) {
    it(`${name}: nothing to make, no error`, async () => {
      const r = await prepareClipSound(project, clip(over as Partial<VideoClip>), () => undefined, new AbortController().signal);
      expect(r.assetId).toBeNull();
      expect(r.created).toEqual([]);
    });
  }
});
