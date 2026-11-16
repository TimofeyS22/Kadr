// The decoder pool (audit V-160, V-198, V-190, V-257), with the codec layer replaced: what is tested is how many
// decoders exist, for which file, and that nobody waits forever.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const made: { file: string }[] = [];
let samples: () => AsyncGenerator<never, void, unknown> = async function* () { /* empty */ };
let audioCheck: () => Promise<null> = async () => null;
/** Decoders Mediabunny would make for keyframes: one per `getSample` call, one per `samplesAtTimestamps` iterator. */
const decoders = { made: 0, open: 0 };
/** What the keyframe decoder does at a time: a frame, or an error. */
let keyFails: (t: number) => Error | null = () => null;
const keySample = (t: number) => ({
  timestamp: t, displayWidth: 640, displayHeight: 360, codedWidth: 640, codedHeight: 360, rotation: 0, flip: false,
  colorSpace: { matrix: 'bt709' }, drawWithFit() { /* drawn */ }, close() { /* closed */ },
});

vi.mock('mediabunny', () => {
  class Input { source: { blob: Blob }; constructor(o: { source: { blob: Blob } }) { this.source = o.source; } async getPrimaryVideoTrack() { await new Promise((r) => setTimeout(r, 1)); return { file: this.source.blob.type, getColorSpace: async () => ({}), getDisplayWidth: async () => 640, getDisplayHeight: async () => 360 }; } dispose() { /* nothing */ } }
  class BlobSource { constructor(readonly blob: Blob) {} }
  class VideoSampleSink {
    constructor(t: { file: string }) { made.push({ file: t.file }); }
    samples() { return samples(); }
    // As Mediabunny: a decoder for each call, closed once the frame is out.
    async getSample(t: number) { decoders.made++; const e = keyFails(t); if (e) throw e; return t < 0 ? null : keySample(t); }
    // As Mediabunny: one decoder while the times come, closed when they end, the iterator is returned or it fails.
    samplesAtTimestamps(times: AsyncIterable<number>) {
      decoders.made++; decoders.open++;
      return (async function* () {
        try {
          for await (const t of times) { const e = keyFails(t); if (e) throw e; yield t < 0 ? null : keySample(t); }
        } finally { decoders.open--; }
      })();
    }
  }
  class EncodedPacketSink { async getKeyPacket(t: number) { return { timestamp: Math.floor(t) }; } }
  return { BlobSource, EncodedPacketSink, Input, VideoSampleSink };
});
vi.mock('./formats', () => ({ READABLE: [] }));
vi.mock('./thumbs.worker', () => ({ renderThumbs: vi.fn() }));
vi.mock('./sound', () => ({ ResilientSink: class {}, playableAudioTrack: () => audioCheck() }));
vi.mock('../storage/db', () => { const file = async (id: string) => new Blob([], { type: id }); return { getBlob: file, openReader: file, getPeaks: vi.fn(), putPeaks: vi.fn() }; });

import { DECODER_FAILED, MediaError, MediaPool } from './media';
import { MediaReadError } from '../storage/reader';

beforeEach(() => {
  made.length = 0; samples = async function* () { /* empty */ }; audioCheck = async () => null;
  decoders.made = decoders.open = 0; keyFails = () => null;
});
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

describe('sound (V-248)', () => {
  it('a clip shows its picture without waiting for the check of its sound, which runs after it, once', async () => {
    let asked = 0;
    audioCheck = () => { asked++; return new Promise(() => undefined); };
    const pool = new MediaPool(1280);
    const got = await Promise.race([pool.picture('c', 'a', 0).then(() => 'picture'), new Promise((r) => setTimeout(() => r('waits for the sound'), 300))]);
    expect(got).toBe('picture');
    await new Promise((r) => setTimeout(r, 10));
    expect(asked, 'checked once the picture is there, so Play does not wait for it').toBe(1);
    await pool.picture('c', 'a', 1);
    void pool.audioSink('a');
    await new Promise((r) => setTimeout(r, 10));
    expect(asked, 'made once').toBe(1);
    pool.dispose();
  });

  it('a picture that comes after the project was left does not open the file again for its sound', async () => {
    let asked = 0;
    audioCheck = async () => { asked++; return null; };
    samples = async function* () { await new Promise((r) => setTimeout(r, 50)); };
    const pool = new MediaPool(1280);
    const got = pool.picture('c', 'a', 0);
    await new Promise((r) => setTimeout(r, 10));
    pool.release();
    await got;
    await new Promise((r) => setTimeout(r, 10));
    expect(asked).toBe(0);
    pool.dispose();
  });

  it('a sound check that failed is made again when the sound is asked for again', async () => {
    let asked = 0;
    audioCheck = async () => { asked++; if (asked === 1) throw new Error('refused'); return null; };
    const pool = new MediaPool(1280);
    await expect(pool.audioSink('a')).rejects.toThrow('refused');
    await expect(pool.audioSink('a')).resolves.toBeNull();
    expect(asked).toBe(2);
    pool.dispose();
  });
});

describe('scrubbing (V-248)', () => {
  // A keyframe while scrubbing is drawn on the stream's canvas.
  const canvasDoc = { createElement: () => ({ width: 0, height: 0, getContext: () => ({ clearRect() { /* cleared */ } }) }) };
  const settled = () => new Promise((r) => setTimeout(r, 0));
  const STEPS = [12.4, 31.7, 5.2, 47.9, 22.3, 39.1, 55.6, 8.8];

  it('the steps of a scrub inside a clip share one decoder for their keyframes, closed with the stream', async () => {
    vi.stubGlobal('document', canvasDoc);
    const pool = new MediaPool(1280);
    for (const t of STEPS) {
      const p = await pool.picture('c', 'a', t, true);
      expect(p && { exact: p.exact, timestamp: p.timestamp }, `the keyframe before ${t} s`).toEqual({ exact: false, timestamp: Math.floor(t) });
    }
    expect(decoders.made, `decoders made for ${STEPS.length} steps`).toBe(1);
    pool.dispose();
    await settled();
    expect(decoders.open, 'closed with the stream').toBe(0);
  });

  it('that decoder is let go once the finger rests, and the next scrub makes one again', async () => {
    vi.stubGlobal('document', canvasDoc);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pool = new MediaPool(1280);
    const step = async (t: number) => { const p = pool.picture('c', 'a', t, true); await vi.advanceTimersByTimeAsync(5); return p; };
    await step(3.5);
    await step(9.5);
    expect(decoders, 'kept between steps').toEqual({ made: 1, open: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    expect(decoders.open, 'a pause of a second keeps it').toBe(1);
    await vi.advanceTimersByTimeAsync(600);
    expect(decoders.open, 'rested').toBe(0);
    expect((await step(20.5))?.timestamp).toBe(20);
    expect(decoders).toEqual({ made: 2, open: 1 });
    pool.dispose();
    await vi.advanceTimersByTimeAsync(5);
    expect(decoders.open).toBe(0);
  });

  it('the rest counts from the exact frame after a step, however long that frame takes', async () => {
    vi.stubGlobal('document', canvasDoc);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const pool = new MediaPool(1280);
    const key = pool.picture('c', 'a', 3.5, true);
    await vi.advanceTimersByTimeAsync(5);
    expect((await key)?.exact).toBe(false);
    // The exact frame of a far seek decodes a whole group of pictures: 2.5 s here, longer than the rest.
    samples = async function* () { await new Promise((r) => setTimeout(r, 2500)); yield keySample(3.5) as never; };
    const exact = pool.picture('c', 'a', 3.5);
    await vi.advanceTimersByTimeAsync(2600);
    expect((await exact)?.exact, 'the exact frame, 2.5 s later').toBe(true);
    expect(decoders.open, 'kept while the exact frame was decoded').toBe(1);
    await vi.advanceTimersByTimeAsync(1000);
    const next = pool.picture('c', 'a', 9.5, true);
    await vi.advanceTimersByTimeAsync(5);
    expect((await next)?.timestamp).toBe(9);
    expect(decoders.made, 'the next step a second after that frame uses the same decoder').toBe(1);
    pool.dispose();
    await vi.advanceTimersByTimeAsync(5);
    expect(decoders.open).toBe(0);
  });

  it('playing after a scrub lets the keyframe decoder go at once (a phone has few decoders)', async () => {
    vi.stubGlobal('document', canvasDoc);
    const pool = new MediaPool(1280);
    await pool.picture('c', 'a', 3.5, true);
    samples = async function* () { for (let i = 0; i < 30; i++) yield keySample(3.5 + i / 30) as never; };
    await pool.picture('c', 'a', 3.5);
    expect(decoders.open, 'the exact frame after a step is still the scrub').toBe(1);
    await pool.picture('c', 'a', 3.5 + 1 / 30);
    await settled();
    expect(decoders.open, 'the next frame of playback').toBe(0);
    pool.dispose();
  });

  it('the same frame drawn again between steps (the screen changed around it) keeps the keyframe decoder', async () => {
    vi.stubGlobal('document', canvasDoc);
    const pool = new MediaPool(1280);
    await pool.picture('c', 'a', 3.5, true);
    samples = async function* () { for (let i = 0; i < 30; i++) yield keySample(3.5 + i / 30) as never; };
    await pool.picture('c', 'a', 3.5);
    await pool.picture('c', 'a', 3.5); // drawn again: a sheet opened, the autosave took a snapshot
    await settled();
    expect(decoders.open, 'kept').toBe(1);
    expect((await pool.picture('c', 'a', 9.5, true))?.timestamp).toBe(9);
    expect(decoders.made, 'the next step uses the same decoder').toBe(1);
    pool.dispose();
  });

  it('a keyframe decoder that fails is made again; a storage error is not taken for a decoder that stopped', async () => {
    vi.stubGlobal('document', canvasDoc);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pool = new MediaPool(1280);
    await pool.picture('c', 'a', 3.5, true);
    let fails = 1;
    keyFails = () => (fails-- > 0 ? new Error('Decoder failure') : null);
    expect((await pool.picture('c', 'a', 9.5, true))?.timestamp, 'shown by a new decoder').toBe(9);
    await settled();
    expect(decoders, 'the failed one is closed').toEqual({ made: 2, open: 1 });

    keyFails = () => new MediaReadError('NotReadableError');
    await expect(pool.picture('c', 'a', 20.5, true)).rejects.toBeInstanceOf(MediaReadError);
    await settled();
    expect(decoders.open).toBe(0);

    keyFails = () => new Error('Decoder failure');
    await expect(pool.picture('c', 'a', 30.5, true)).rejects.toThrow(DECODER_FAILED);
    await settled();
    expect(decoders.open, 'none left behind').toBe(0);
    pool.dispose();
    vi.restoreAllMocks();
  });

  it('a decoder that fails while the finger rests lets go of the keyframe decoder too (a phone has none to spare)', async () => {
    vi.stubGlobal('document', canvasDoc);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const pool = new MediaPool(1280);
    await pool.picture('c', 'a', 3.5, true);
    expect(decoders.open, 'kept after a scrub step').toBe(1);
    let fails = 1;
    samples = async function* () { if (fails-- > 0) throw new Error('Codec reclaimed'); yield keySample(9.5) as never; };
    expect((await pool.picture('c', 'a', 9.5))?.exact, 'the exact frame, from the decoder made again').toBe(true);
    await settled();
    expect(decoders.open, 'the idle keyframe decoder went with the failed one').toBe(0);
    expect((await pool.picture('c', 'a', 20.5, true))?.timestamp, 'the next scrub makes its own').toBe(20);
    expect(decoders).toEqual({ made: 2, open: 1 });
    pool.dispose();
    await settled();
    expect(decoders.open).toBe(0);
    vi.restoreAllMocks();
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
