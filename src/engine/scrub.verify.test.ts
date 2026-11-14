// Sweep lane E2 (docs/21 §5): a reproducing test for audit V-173 — a scrub across a file with few keyframes lagged by
// seconds: a short jump forward decoded every frame up to the exact one before anything was shown. Now a finger that
// moves gets the nearest keyframe (one decode), and the exact frame follows once it rests. The codec layer is replaced
// by a file of 6 s at 30 fps with one keyframe, at 0 s; what is counted is how many frames are decoded for each picture.
// The same in a browser, with the real decoder: e2e/qa-verify-media.spec.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const decoded: number[] = [];
const sample = (t: number) => ({
  timestamp: t, duration: 1 / 30, displayWidth: 640, displayHeight: 360, codedWidth: 640, codedHeight: 360, rotation: 0, flip: false,
  colorSpace: { matrix: 'bt709' }, close() {}, drawWithFit() {}, toVideoFrame: () => ({ close() {} }),
});
vi.mock('mediabunny', () => {
  class Input {
    async getPrimaryVideoTrack() { return { getColorSpace: async () => ({}), getDisplayWidth: async () => 640, getDisplayHeight: async () => 360 }; }
    dispose() { /* nothing */ }
  }
  class BlobSource { constructor(readonly blob: Blob) {} }
  // One keyframe, at 0 s: every frame is decoded from there.
  class VideoSampleSink {
    async *samples(start: number) { for (let i = 0; i < 180; i++) { decoded.push(i / 30); if (i / 30 >= start - 1e-4) yield sample(i / 30); } }
    async getSample(t: number) { for (let i = 0; i <= Math.round(t * 30); i++) decoded.push(i / 30); return sample(Math.round(t * 30) / 30); }
  }
  class EncodedPacketSink { async getKeyPacket() { return { timestamp: 0 }; } }
  return { BlobSource, EncodedPacketSink, Input, VideoSampleSink };
});
vi.mock('./formats', () => ({ READABLE: [] }));
vi.mock('./thumbs.worker', () => ({ renderThumbs: vi.fn() }));
vi.mock('./sound', () => ({ ResilientSink: class {}, playableAudioTrack: async () => null }));
vi.mock('../storage/db', () => { const file = async (id: string) => new Blob([], { type: id }); return { getBlob: file, openReader: file, getPeaks: vi.fn(), putPeaks: vi.fn() }; });

import { MediaPool } from './media';

beforeEach(() => {
  decoded.length = 0;
  // A keyframe while scrubbing comes as a canvas.
  vi.stubGlobal('document', { hidden: false, createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() {} }) }) });
});
afterEach(() => vi.unstubAllGlobals());

describe('a scrub forward on a file with one keyframe (audit V-173)', () => {
  it('a finger moving 1 s on gets a picture after one decode; the exact frame follows once it rests', async () => {
    const pool = new MediaPool(1280);
    expect((await pool.picture('c', 'a', 0))!.exact).toBe(true); // resting at 0 s
    for (const to of [1, 2, 3]) {
      const n = decoded.length;
      const moving = (await pool.picture('c', 'a', to, true))!;
      expect(decoded.length - n, `frames decoded before a picture of the scrub to ${to} s`).toBeLessThanOrEqual(1);
      expect(moving.exact, 'the nearest keyframe, for now').toBe(false);
      const rested = (await pool.picture('c', 'a', to))!;
      expect(rested.exact).toBe(true);
      expect(rested.timestamp).toBeCloseTo(to, 3);
    }
    pool.dispose();
  });
});
