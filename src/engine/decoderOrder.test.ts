// A decoder that hands frames out of order (audit V-105: iOS 26.0–26.3 on ordinary files). Mediabunny puts back a
// frame that comes one place late; one that comes two places late reached the pool after a later frame, and the
// picture stepped back — a jerk in the preview and in the file. The codec layer is replaced here; what is tested is
// which frame the pool shows at each moment.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const FPS = 30;
let order: number[] = [];
const closed = new Set<number>();

/** A decoded frame as Mediabunny gives it, `n` frames in. */
function frame(n: number) {
  return {
    timestamp: n / FPS, duration: 1 / FPS, codedWidth: 640, codedHeight: 360, displayWidth: 640, displayHeight: 360,
    rotation: 0, flip: false, colorSpace: { matrix: 'bt709' },
    toVideoFrame: () => ({ n, close: () => undefined }),
    drawWithFit: () => undefined,
    close: () => { closed.add(n); },
  };
}

vi.mock('mediabunny', () => {
  class Input { async getPrimaryVideoTrack() { return { getColorSpace: async () => ({}), getDisplayWidth: async () => 640, getDisplayHeight: async () => 360 }; } dispose() { /* nothing */ } }
  class BlobSource { constructor(readonly blob: Blob) {} }
  class VideoSampleSink { async *samples() { for (const n of order) yield frame(n); } }
  class EncodedPacketSink { }
  return { BlobSource, EncodedPacketSink, Input, VideoSampleSink };
});
vi.mock('./formats', () => ({ READABLE: [] }));
vi.mock('./thumbs.worker', () => ({ renderThumbs: vi.fn() }));
vi.mock('./sound', () => ({ ResilientSink: class {}, playableAudioTrack: async () => null }));
vi.mock('../storage/db', () => { const file = async (id: string) => new Blob([], { type: id }); return { getBlob: file, openReader: file, getPeaks: vi.fn(), putPeaks: vi.fn() }; });

import { MediaPool } from './media';

beforeEach(() => { closed.clear(); });

/** The frame the pool shows at each frame's time, from the start, as the preview and the export ask for them. */
async function shown(decoded: number[]): Promise<number[]> {
  order = decoded;
  const pool = new MediaPool(1280);
  const out: number[] = [];
  for (let n = 0; n < decoded.length; n++) {
    const p = await pool.picture('c', 'a', n / FPS + 1e-3, false, 4096);
    out.push(Math.round((p?.timestamp ?? NaN) * FPS));
  }
  pool.dispose();
  return out;
}

describe('a decoder that hands frames out of order (audit V-105)', () => {
  it('never steps the picture back: a frame two places late is let go, and each moment shows no frame from its future', async () => {
    const got = await shown([0, 2, 3, 1, 4, 5, 7, 8, 6, 9]);
    for (let n = 1; n < got.length; n++) expect(got[n], `frame shown at ${n}: ${got.join(' ')}`).toBeGreaterThanOrEqual(got[n - 1]);
    got.forEach((f, n) => expect(f, `at ${n}`).toBeLessThanOrEqual(n));
    expect(got.at(-1), 'the end is reached').toBe(9);
    expect(closed.has(1) && closed.has(6), 'the late frames are closed, not kept').toBe(true);
  });

  it('frames in order are all shown, each at its own time', async () => {
    expect(await shown([0, 1, 2, 3, 4, 5])).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
