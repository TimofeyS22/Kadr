// The decoder pool (audit V-160, V-198, V-190, V-257), with the codec layer replaced: what is tested is how many
// decoders exist, for which file, and that nobody waits forever.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const made: { file: string }[] = [];
let samples: () => AsyncGenerator<never, void, unknown> = async function* () { /* empty */ };

vi.mock('mediabunny', () => {
  class Input { source: { blob: Blob }; constructor(o: { source: { blob: Blob } }) { this.source = o.source; } async getPrimaryVideoTrack() { await new Promise((r) => setTimeout(r, 1)); return { file: this.source.blob.type, getColorSpace: async () => ({}), getDisplayWidth: async () => 640, getDisplayHeight: async () => 360 }; } dispose() { /* nothing */ } }
  class BlobSource { constructor(readonly blob: Blob) {} }
  class VideoSampleSink { constructor(t: { file: string }) { made.push({ file: t.file }); } samples() { return samples(); } }
  class EncodedPacketSink { }
  return { BlobSource, EncodedPacketSink, Input, VideoSampleSink };
});
vi.mock('./formats', () => ({ READABLE: [] }));
vi.mock('./thumbs.worker', () => ({ renderThumbs: vi.fn() }));
vi.mock('./sound', () => ({ ResilientSink: class {}, playableAudioTrack: async () => null }));
vi.mock('../storage/db', () => { const file = async (id: string) => new Blob([], { type: id }); return { getBlob: file, openMedia: file, getPeaks: vi.fn(), putPeaks: vi.fn() }; });

import { MediaError, MediaPool } from './media';

beforeEach(() => { made.length = 0; samples = async function* () { /* empty */ }; });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('video streams', () => {
  it('callers arriving together share one stream (V-160)', async () => {
    const pool = new MediaPool(1280);
    await Promise.all([1, 2, 3, 4, 5].map(() => pool.picture('c', 'a', 0)));
    expect(made).toHaveLength(1);
    pool.dispose();
  });

  it('a clip that now shows another file reads that file (V-198)', async () => {
    const pool = new MediaPool(1280);
    await pool.picture('c', 'forward', 0);
    await pool.picture('c', 'reversed', 0);
    expect(made.map((m) => m.file)).toEqual(['forward', 'reversed']);
    pool.dispose();
  });

  it('a decoder that goes silent ends in an error the player can show, not a wait for ever (V-257)', async () => {
    vi.useFakeTimers();
    samples = async function* () { await new Promise(() => undefined); };
    const pool = new MediaPool(1280);
    const got = pool.picture('c', 'a', 0).then(() => 'answered', (e) => e);
    await vi.advanceTimersByTimeAsync(120_000);
    expect(await got).toBeInstanceOf(MediaError);
    pool.dispose();
  });

  it('closing a stream lets go of whoever waits for it (V-257)', async () => {
    samples = async function* () { await new Promise(() => undefined); };
    const pool = new MediaPool(1280);
    const got = pool.picture('c', 'a', 0);
    await new Promise((r) => setTimeout(r, 20));
    pool.dispose();
    await expect(Promise.race([got, new Promise((r) => setTimeout(() => r('still waiting'), 300))])).resolves.toBeNull();
  });
});

describe('leaving a project (V-137)', () => {
  it('lets go of everything, and the pool still works for the next one', async () => {
    const pool = new MediaPool(1280);
    await pool.picture('c', 'a', 0);
    pool.release();
    await pool.picture('c', 'a', 0);
    expect(made, 'opened anew').toHaveLength(2);
    pool.dispose();
  });
});

describe('photos (V-190)', () => {
  it('the oldest go when the budget is passed, the ones on screen stay', async () => {
    const closed: number[] = [];
    vi.stubGlobal('createImageBitmap', async (b: Blob) => ({ width: 1000, height: 1000, id: b.type, close() { closed.push(1); } }));
    const pool = new MediaPool(4096);
    const a = await pool.image('a'); await new Promise((r) => setTimeout(r, 2));
    await pool.image('b'); await new Promise((r) => setTimeout(r, 2));
    await pool.image('c');
    pool.trimImages(new Set(['a']), 8_000_000); // room for two
    expect(closed).toHaveLength(1);
    expect(await pool.image('a'), 'on screen: the same picture').toBe(a);
    pool.trimImages(new Set(), 0);
    expect(closed).toHaveLength(3);
    pool.dispose();
  });
});
