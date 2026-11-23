import { afterEach, describe, expect, it, vi } from 'vitest';
import { WRITE_MS, onStoreEvent, partStore, readPart, resetStores, smallCache, writePart, type StoreEvent } from './modelStore';

const ORIGIN = 'https://example.test';
const never = <T>() => new Promise<T>(() => undefined);
/** The Cache Storage as the store uses it; `put` may be made to never finish. */
function fakeCaches(put: 'works' | 'hangs') {
  const kept = new Map<string, Response>();
  const cache = {
    match: async (url: string) => kept.get(url)?.clone(),
    put: (url: string, res: Response) => (put === 'hangs' ? never<void>() : Promise.resolve(void kept.set(url, res))),
    keys: async () => [...kept.keys()].map((url) => ({ url })),
    delete: async (r: { url: string }) => kept.delete(r.url),
  };
  vi.stubGlobal('caches', { open: async () => cache });
  return kept;
}
const bytes = (n: number) => new Uint8Array(n).fill(7);

describe('model parts: a store that does not answer gives way (SW-S-2)', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); onStoreEvent(null); resetStores(); });

  it('keeps a part in the Cache Storage and reads it back', async () => {
    vi.stubGlobal('self', { location: { origin: ORIGIN } });
    fakeCaches('works');
    expect(await writePart('repo/file/0', bytes(64))).toBe('cache');
    expect(await partStore('repo/file/0', 64)).toBe('cache');
    expect(await partStore('repo/file/0', 65)).toBeNull(); // a part of another size is not this part
    expect((await readPart('repo/file/0', 64))?.byteLength).toBe(64);
  });

  it('a Cache Storage whose write never finishes: two tries, then the part is held in memory, and the cache is not asked again', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('self', { location: { origin: ORIGIN } });
    fakeCaches('hangs');
    const events: StoreEvent[] = [];
    onStoreEvent((e) => events.push(e));
    const first = writePart('repo/file/0', bytes(64));
    await vi.advanceTimersByTimeAsync(WRITE_MS * 2 + 10);
    expect(await first).toBe('memory'); // no file system in this test: memory is next
    expect(events.map((e) => `${e.store} ${e.stalled ? 'stalled' : 'failed'}${e.next ? ` → fallback ${e.next}` : ''}`)).toEqual(['cache stalled', 'cache stalled → fallback memory']);
    // The next part goes straight to the store that works: nothing more is waited for.
    expect(await writePart('repo/file/1', bytes(64))).toBe('memory');
    expect(await partStore('repo/file/1', 64)).toBe('memory');
    expect(await partStore('repo/file/1', 64, true)).toBeNull(); // held for this session only: still to come next time
    expect((await readPart('repo/file/0', 64))?.byteLength).toBe(64);
  });

  it('a slow store is not a hung one: a look-up that takes 15 s is waited for, and one that hung once gets a second try', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('self', { location: { origin: ORIGIN } });
    const kept = fakeCaches('works');
    await writePart('repo/file/0', bytes(64));
    const fast = { match: async (url: string) => kept.get(url)?.clone() };
    let looks = 0;
    // The first look never answers, the second takes 15 s: the part is on the device, and it is found there.
    vi.stubGlobal('caches', { open: async () => ({ match: (url: string) => (++looks === 1 ? never<Response>() : new Promise<Response | undefined>((r) => setTimeout(() => void fast.match(url).then(r), 15_000))) }) });
    resetStores(); // a new worker over the same device: the store is asked afresh
    const events: StoreEvent[] = [];
    onStoreEvent((e) => events.push(e));
    const where = partStore('repo/file/0', 64, true);
    await vi.advanceTimersByTimeAsync(20_000 + 15_000 + 100);
    expect(await where).toBe('cache');
    expect(events.map((e) => e.next)).toEqual([null]); // one stall noted, the store not given up on
  });

  it('"no room" is not another store\'s to fix: it is said', async () => {
    vi.stubGlobal('self', { location: { origin: ORIGIN } });
    vi.stubGlobal('caches', { open: async () => ({ put: async () => { throw new DOMException('full', 'QuotaExceededError'); } }) });
    await expect(writePart('repo/file/0', bytes(8))).rejects.toMatchObject({ name: 'QuotaExceededError' });
  });

  it('a small-file cache that does not answer is done without: the file comes from the network instead', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('caches', { open: async () => ({ match: () => never<Response>(), put: () => never<void>() }) });
    const small = smallCache('any');
    const hit = small.match('https://example.test/config.json');
    await vi.advanceTimersByTimeAsync(21_000);
    expect(await hit).toBeUndefined();
    expect(await small.match('https://example.test/vocab.txt')).toBeUndefined(); // at once: the cache is not asked again
    await small.put('https://example.test/vocab.txt', new Response('x'));
  });
});
