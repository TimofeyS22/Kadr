// Media kept as chunks, read a chunk at a time (audit V-253). Where IndexedDB refuses Blobs (a private Safari tab) a file
// is stored as 16 MB ArrayBuffers. Reading used to put all of them into one Blob that stayed while the project was
// open: a long take lived in the page's memory whole, on top of its stored copy, and took the tab down. Here a read
// fetches only the chunks its range touches, and all the readers of the page share a cache of two chunks.

export const CHUNK = 16 * 1024 * 1024;
/** How many chunks the page holds at once, counting the ones being read. */
export const HELD_CHUNKS = 2;
/** The record of a file kept in chunks (`c:<id>`); the chunks are `c:<id>:<i>`, each `CHUNK` long but the last. */
export interface Chunked { type: string; size: number; chunks: number }

/** A stored file read on demand. It holds nothing itself: the chunks are in the cache its storage shares. */
export interface ChunkedMedia {
  readonly size: number;
  readonly type: string;
  /** Bytes `start` (inclusive) to `end` (exclusive) as an array of its own, so no chunk stays alive through it. */
  read(start: number, end: number): Promise<Uint8Array<ArrayBuffer>>;
}
/** A stored file: the Blob the browser keeps on disk, or a reader of its chunks. */
export type StoredMedia = Blob | ChunkedMedia;

interface Held { data: Promise<ArrayBuffer>; ready: boolean }

/**
 * The chunks in memory, least recently used first. A chunk being read counts: when every place is taken by a read in
 * progress the next one waits, so three readers asking at once never make three chunks exist together.
 */
export class ChunkCache {
  private held = new Map<string, Held>();

  /** `stats`: the most chunks ever held at once and the reads from storage, for whoever measures (`__kadrPerf.chunks`). */
  constructor(private readonly max = HELD_CHUNKS, private readonly stats?: { peak: number; loads: number }) {}

  get size(): number { return this.held.size; }

  async get(key: string, load: () => Promise<ArrayBuffer>): Promise<ArrayBuffer> {
    for (;;) {
      const hit = this.held.get(key);
      if (hit) {
        this.held.delete(key);
        this.held.set(key, hit); // the most recently used is last
        return hit.data;
      }
      if (this.held.size < this.max) break;
      const idle = [...this.held].find(([, h]) => h.ready);
      if (idle) this.held.delete(idle[0]);
      else await Promise.race([...this.held.values()].map((h) => h.data.catch(() => undefined)));
    }
    const made: Held = { data: load(), ready: false };
    this.held.set(key, made);
    if (this.stats) {
      this.stats.loads++;
      this.stats.peak = Math.max(this.stats.peak, this.held.size);
    }
    // A read that failed is not kept: the next one asks the storage again.
    made.data.then(() => { made.ready = true; }, () => { if (this.held.get(key) === made) this.held.delete(key); });
    return made.data;
  }

  /** Lets go of the chunks whose key starts with `prefix` (all of them without one). */
  drop(prefix = ''): void {
    for (const key of this.held.keys()) if (key.startsWith(prefix)) this.held.delete(key);
  }
}

/**
 * A reader of the file `id` whose chunks `load(i)` fetches. A chunk that is not there, or is not as long as the file's
 * record says, fails the read: bytes that are not the file's must never reach a decoder as if they were.
 */
export function chunkedMedia(id: string, meta: Chunked, load: (i: number) => Promise<ArrayBuffer | undefined>, cache: ChunkCache): ChunkedMedia {
  const chunk = (i: number) => cache.get(`${id}:${i}`, async () => {
    const data = await load(i);
    if (!data) throw new Error(`Chunk ${i} of ${meta.chunks} of a stored media file is missing`);
    const length = Math.min(CHUNK, meta.size - i * CHUNK);
    if (data.byteLength !== length) throw new Error(`Chunk ${i} of a stored media file is ${data.byteLength} bytes long, not ${length}`);
    return data;
  });
  return {
    size: meta.size,
    type: meta.type,
    async read(start, end) {
      if (!(start >= 0 && start <= end && end <= meta.size)) throw new RangeError(`Bytes ${start} to ${end} are outside a stored file of ${meta.size}`);
      const out = new Uint8Array(end - start);
      // One chunk at a time, copied before the next is asked for: a read across a boundary holds neither.
      for (let i = Math.floor(start / CHUNK); i * CHUNK < end; i++) {
        const from = Math.max(start, i * CHUNK), to = Math.min(end, (i + 1) * CHUNK);
        out.set(new Uint8Array(await chunk(i), from - i * CHUNK, to - from), from - start);
      }
      return out;
    },
  };
}
