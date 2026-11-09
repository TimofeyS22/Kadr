// Media kept in chunks is read a chunk at a time and never held whole (audit V-253): the reader over a fake storage.
import { describe, expect, it } from 'vitest';
import { CHUNK, ChunkCache, chunkedMedia, type Chunked } from './chunks';

/** The byte at `offset` of the test file. The period is a prime: the same place of two chunks never holds the same byte. */
const PERIOD = 251;
const byteAt = (offset: number) => offset % PERIOD;
const SIZE = 2 * CHUNK + 5 * 1024 * 1024 + 123; // two whole chunks and a last one cut short
const META: Chunked = { type: 'video/mp4', size: SIZE, chunks: 3 };

const patterns = new Map<number, ArrayBuffer>();
/** Chunk `i` of the test file, whole (filled once: a test reads the same chunk many times). */
function pattern(i: number): ArrayBuffer {
  let made = patterns.get(i);
  if (!made) {
    const bytes = new Uint8Array(CHUNK);
    for (let k = 0; k < PERIOD; k++) bytes[k] = byteAt(i * CHUNK + k);
    for (let n = PERIOD; n < CHUNK; n *= 2) bytes.copyWithin(n, 0, Math.min(n, CHUNK - n)); // one period, doubled until full
    patterns.set(i, made = bytes.buffer);
  }
  return made;
}

/** A storage of chunks made when asked for, which counts what is read and how many reads are under way at once. */
function fakeStore(meta = META, delayMs = 0) {
  const s = {
    loads: [] as number[], reading: 0, mostReading: 0, gone: new Set<number>(), short: new Set<number>(),
    onLoad: () => undefined as void,
    load: async (i: number): Promise<ArrayBuffer | undefined> => {
      s.loads.push(i);
      s.mostReading = Math.max(s.mostReading, ++s.reading);
      s.onLoad();
      try {
        await new Promise((r) => setTimeout(r, delayMs));
        if (s.gone.has(i)) return undefined;
        const length = Math.min(CHUNK, meta.size - i * CHUNK) - (s.short.has(i) ? 1 : 0);
        return pattern(i).slice(0, length); // a buffer of its own each time, as a storage gives
      } finally {
        s.reading--;
      }
    },
  };
  return s;
}

/** Do the bytes equal the file's from `start` on? */
function sameAsFile(got: Uint8Array, start: number): boolean {
  for (let k = 0; k < got.length; k++) if (got[k] !== byteAt(start + k)) return false;
  return true;
}

describe('a file kept in chunks', () => {
  it('reads a range inside one chunk from that chunk alone', async () => {
    const store = fakeStore(), media = chunkedMedia('a', META, store.load, new ChunkCache());
    const got = await media.read(CHUNK + 1000, CHUNK + 9000);
    expect(got.length).toBe(8000);
    expect(sameAsFile(got, CHUNK + 1000)).toBe(true);
    expect(store.loads).toEqual([1]);
    expect([media.size, media.type]).toEqual([SIZE, 'video/mp4']);
  });

  it('reads across a chunk boundary, byte for byte', async () => {
    const store = fakeStore(), media = chunkedMedia('a', META, store.load, new ChunkCache());
    const got = await media.read(CHUNK - 70_000, CHUNK + 70_000);
    expect(got.length).toBe(140_000);
    expect(sameAsFile(got, CHUNK - 70_000)).toBe(true);
    expect([...got.subarray(69_998, 70_002)]).toEqual([CHUNK - 2, CHUNK - 1, CHUNK, CHUNK + 1].map(byteAt)); // the seam itself
    expect(store.loads).toEqual([0, 1]);
  });

  it('reads the last, shorter chunk to the end of the file and nothing past it', async () => {
    const store = fakeStore(), media = chunkedMedia('a', META, store.load, new ChunkCache());
    const tail = await media.read(SIZE - 1000, SIZE);
    expect(tail.length).toBe(1000);
    expect(sameAsFile(tail, SIZE - 1000)).toBe(true);
    const across = await media.read(2 * CHUNK - 10, SIZE); // from the chunk before into the whole last one
    expect(across.length).toBe(SIZE - 2 * CHUNK + 10);
    expect(sameAsFile(across, 2 * CHUNK - 10)).toBe(true);
    expect((await media.read(SIZE, SIZE)).length).toBe(0);
    await expect(media.read(SIZE - 10, SIZE + 1)).rejects.toBeInstanceOf(RangeError);
    await expect(media.read(-1, 10)).rejects.toBeInstanceOf(RangeError);
  });

  it('hands out bytes of their own: a read keeps no chunk alive', async () => {
    const media = chunkedMedia('a', META, fakeStore().load, new ChunkCache());
    const got = await media.read(10, 20);
    expect(got.buffer.byteLength).toBe(10);
  });

  it('never holds more than two chunks, and lets the least recently used one go', async () => {
    const stats = { peak: 0, loads: 0 };
    const cache = new ChunkCache(2, stats), store = fakeStore();
    const sizes: number[] = [];
    store.onLoad = () => { sizes.push(cache.size); };
    const media = chunkedMedia('a', META, store.load, cache);
    const touch = async (i: number) => { await media.read(i * CHUNK + 5, i * CHUNK + 6); sizes.push(cache.size); };
    await touch(0);
    await touch(1);
    await touch(0); // held: no read, and now chunk 1 is the older one
    expect(store.loads).toEqual([0, 1]);
    await touch(2); // chunk 1 goes
    await touch(0);
    expect(store.loads).toEqual([0, 1, 2]);
    await touch(1); // read again: it was let go
    expect(store.loads).toEqual([0, 1, 2, 1]);
    await media.read(0, SIZE); // the whole file in one read still goes a chunk at a time
    expect(Math.max(...sizes, cache.size)).toBe(2);
    expect(stats).toEqual({ peak: 2, loads: store.loads.length });
  });

  it('readers asking for three chunks at once wait: a third chunk is not read while two are', async () => {
    const cache = new ChunkCache(2), store = fakeStore(META, 5);
    const sizes: number[] = [];
    store.onLoad = () => { sizes.push(cache.size); };
    const a = chunkedMedia('a', META, store.load, cache), b = chunkedMedia('b', META, store.load, cache);
    const got = await Promise.all([a.read(100, 200), a.read(CHUNK + 100, CHUNK + 200), b.read(2 * CHUNK + 100, 2 * CHUNK + 200), a.read(150, 250), b.read(CHUNK - 50, CHUNK + 50)]);
    expect(got.map((g, k) => sameAsFile(g, [100, CHUNK + 100, 2 * CHUNK + 100, 150, CHUNK - 50][k]))).toEqual([true, true, true, true, true]);
    expect(store.mostReading).toBeLessThanOrEqual(2);
    expect(Math.max(...sizes, cache.size)).toBeLessThanOrEqual(2);
  });

  it('a missing chunk is an error, not silence, and is asked for again next time', async () => {
    const store = fakeStore(), cache = new ChunkCache(), media = chunkedMedia('a', META, store.load, cache);
    store.gone.add(1);
    await expect(media.read(CHUNK + 10, CHUNK + 20)).rejects.toThrow(/Chunk 1 of 3 .* is missing/);
    await expect(media.read(CHUNK - 10, CHUNK + 10)).rejects.toThrow(/missing/); // the part that is there is not passed off as the range
    expect(cache.size).toBe(1); // chunk 0; the failed read holds no place
    store.gone.clear();
    expect(sameAsFile(await media.read(CHUNK + 10, CHUNK + 20), CHUNK + 10)).toBe(true);
  });

  it('a chunk of the wrong length is an error', async () => {
    const store = fakeStore(), media = chunkedMedia('a', META, store.load, new ChunkCache());
    store.short.add(2);
    await expect(media.read(2 * CHUNK, 2 * CHUNK + 10)).rejects.toThrow(/bytes long, not/);
  });

  it('lets go of one file\'s chunks, or of all', async () => {
    const cache = new ChunkCache(), store = fakeStore();
    const a = chunkedMedia('a', META, store.load, cache), ab = chunkedMedia('ab', META, store.load, cache);
    await a.read(0, 1);
    await ab.read(0, 1);
    cache.drop('a:'); // not the file whose name only starts the same
    expect(cache.size).toBe(1);
    await ab.read(1, 2);
    expect(store.loads).toHaveLength(2);
    cache.drop();
    expect(cache.size).toBe(0);
  });
});
