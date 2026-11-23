// Where the parts of a speech model are kept on the device, and what happens when a store stops answering (SW-S-2).
//
// The owner, 2026-11-23: in Kadr opened from an iPhone's Home Screen the model's bar «зависла в самом начале», while
// Safari on the same phone had the model in 15 s. The Home Screen app has its own storage, apart from Safari's, and
// every call to it here had no limit: one that never finished left the download standing for ever. Now each call has
// a limit, and a store that does not answer gives way to the next one — the Cache Storage, then the origin's private
// file system, then this session's memory — so the captions are made whatever the storage does. Keeping the model for
// the next time is wanted, not required.

export type StoreName = 'cache' | 'opfs' | 'memory';
export const PARTS_CACHE = 'kadr-model-parts';
const PARTS_DIR = 'kadr-model-parts';
/** A part (16 MiB) is written in well under a second; one not written in this long has hung. */
export const WRITE_MS = 15_000;
/** Opening a store, looking a part up, reading it. */
const QUICK_MS = 10_000;
/** Writes in a row a store may fail before the next store takes over. */
const STRIKES = 2;

/** What a store did not do, as it is logged: «cache stalled → fallback opfs». */
export interface StoreEvent { store: StoreName; op: 'open' | 'look' | 'read' | 'write'; stalled: boolean; next: StoreName | null; message: string }

interface Store {
  name: StoreName;
  has(id: string, size: number): Promise<boolean>;
  read(id: string): Promise<Uint8Array<ArrayBuffer> | undefined>;
  write(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<void>;
  /** Removes every part whose id starts with `prefix`. */
  drop(prefix: string): Promise<void>;
}

class Stalled extends Error {}
/** `p`, or a Stalled error when it has not settled in `ms`. */
function limited<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Stalled(`${what} did not answer for ${ms / 1000} s`)), ms); });
  return Promise.race([p, late]).finally(() => clearTimeout(timer));
}

const partUrl = (id: string) => new URL(`/__kadr-model-parts/${id}`, self.location.origin).href;

let opened: Promise<Cache> | null = null;
const cacheStore: Store = {
  name: 'cache',
  async has(id, size) {
    const hit = await (await open()).match(partUrl(id));
    return !!hit && Number(hit.headers.get('content-length')) === size;
  },
  async read(id) {
    const hit = await (await open()).match(partUrl(id));
    return hit ? new Uint8Array(await hit.arrayBuffer()) : undefined;
  },
  async write(id, bytes) {
    await (await open()).put(partUrl(id), new Response(bytes, { headers: { 'content-length': String(bytes.byteLength), 'content-type': 'application/octet-stream' } }));
  },
  async drop(prefix) {
    const cache = await open();
    const at = partUrl(prefix);
    await Promise.all((await cache.keys()).filter((r) => r.url.startsWith(at)).map((r) => cache.delete(r)));
  },
};
function open(): Promise<Cache> {
  opened ??= caches.open(PARTS_CACHE);
  opened.catch(() => { opened = null; });
  return opened;
}

type SyncHandle = { truncate(n: number): void; write(b: Uint8Array, o: { at: number }): number; flush(): void; close(): void };
const fileName = (id: string) => encodeURIComponent(id);
const dir = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(PARTS_DIR, { create: true });
const missing = (e: unknown) => (e as Error).name === 'NotFoundError';
const opfsStore: Store = {
  name: 'opfs',
  async has(id, size) {
    try { return (await (await (await dir()).getFileHandle(fileName(id))).getFile()).size === size; } catch (e) { if (missing(e)) return false; throw e; }
  },
  async read(id) {
    try { return new Uint8Array(await (await (await (await dir()).getFileHandle(fileName(id))).getFile()).arrayBuffer()); } catch (e) { if (missing(e)) return undefined; throw e; }
  },
  async write(id, bytes) {
    const handle = await (await dir()).getFileHandle(fileName(id), { create: true });
    // In a worker the synchronous handle (WebKit has had it far longer than createWritable); on a page the stream.
    const sync = (handle as unknown as { createSyncAccessHandle?: () => Promise<SyncHandle> }).createSyncAccessHandle;
    if (sync && typeof document === 'undefined') {
      const h = await sync.call(handle);
      try { h.truncate(0); h.write(bytes, { at: 0 }); h.flush(); } finally { h.close(); }
      return;
    }
    const w = await handle.createWritable();
    await w.write(bytes);
    await w.close();
  },
  async drop(prefix) {
    const d = await dir();
    const at = fileName(prefix);
    for await (const name of (d as unknown as { keys(): AsyncIterable<string> }).keys()) if (name.startsWith(at)) await d.removeEntry(name).catch(() => undefined);
  },
};

const held = new Map<string, Uint8Array<ArrayBuffer>>();
const memoryStore: Store = {
  name: 'memory',
  has: async (id, size) => held.get(id)?.byteLength === size,
  read: async (id) => held.get(id),
  write: async (id, bytes) => { held.set(id, bytes); },
  drop: async (prefix) => { for (const id of held.keys()) if (id.startsWith(prefix)) held.delete(id); },
};

/** Stores that stopped answering in this page or worker: not asked again until it is loaded anew. */
const dead = new Set<StoreName>();
const strikes: Partial<Record<StoreName, number>> = {};
let listener: ((e: StoreEvent) => void) | null = null;
/** Told of every store that failed or was given up on (the speech worker passes it to the page's log). */
export const onStoreEvent = (fn: ((e: StoreEvent) => void) | null) => { listener = fn; };

/** The stores this place has, in order, without the ones given up on. `keeps`: only the ones that outlive the session. */
function stores(keeps = false): Store[] {
  const all: Store[] = [];
  if (typeof caches !== 'undefined') all.push(cacheStore);
  if (typeof navigator !== 'undefined' && typeof navigator.storage?.getDirectory === 'function') all.push(opfsStore);
  if (!keeps) all.push(memoryStore);
  return all.filter((s) => !dead.has(s.name));
}

/** Notes that `s` did not do `op`; `giveUp` takes it out of use. */
function failed(s: Store, op: StoreEvent['op'], e: unknown, giveUp: boolean): void {
  if (giveUp) dead.add(s.name);
  const next = giveUp ? stores()[0]?.name ?? null : null;
  const stalled = e instanceof Stalled;
  const message = `${s.name} ${stalled ? 'stalled' : 'failed'}${next ? ` → fallback ${next}` : ''}: ${op}, ${(e as Error).message}`;
  console.warn(`model parts: ${message}`);
  listener?.({ store: s.name, op, stalled, next, message });
}

/** A failure that another store cannot help with: the device is out of room, and they share it. */
const noRoom = (e: unknown) => (e as Error).name === 'QuotaExceededError';

/** The store that keeps part `id` whole, if any does. A store that does not answer is given up on. */
export async function partStore(id: string, size: number, keeps = false): Promise<StoreName | null> {
  for (const s of stores(keeps)) {
    try { if (await limited(s.has(id, size), QUICK_MS, `${s.name}: looking a part up`)) return s.name; } catch (e) { failed(s, 'look', e, true); }
  }
  return null;
}

/** Part `id` from the store that keeps it, or undefined. */
export async function readPart(id: string, size: number): Promise<Uint8Array<ArrayBuffer> | undefined> {
  for (const s of stores()) {
    try {
      const bytes = await limited(s.read(id), QUICK_MS * 2, `${s.name}: reading a part`);
      if (bytes?.byteLength === size) return bytes;
    } catch (e) { failed(s, 'read', e, true); }
  }
  return undefined;
}

/**
 * Keeps part `id` in the first store that takes it, and says which. A store whose write fails or does not finish
 * gets a second try (a blip is not a broken store); after two in a row the next store takes over for good. The last
 * one is this session's memory, which cannot fail: the model is then used and not kept. Throws only for "no room".
 */
export async function writePart(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<StoreName> {
  for (;;) {
    const s = stores()[0];
    try {
      await limited(s.write(id, bytes), WRITE_MS, `${s.name}: writing a part`);
      strikes[s.name] = 0;
      return s.name;
    } catch (e) {
      if (noRoom(e)) throw e;
      const n = (strikes[s.name] = (strikes[s.name] ?? 0) + 1);
      failed(s, 'write', e, n >= STRIKES);
    }
  }
}

/** Removes the parts whose ids start with `prefix` from every store. Never throws. */
export async function dropParts(prefix: string): Promise<void> {
  for (const s of stores()) await limited(s.drop(prefix), QUICK_MS, `${s.name}: removing parts`).catch(() => undefined);
}

/**
 * A named Cache Storage for the small files of a model (configs, vocabularies), with the same limit: a cache that
 * does not open, look up or write in time is done without from then on — the file comes from the network, checked,
 * as on a first visit. These are the first calls of a load: with no limit, a storage that did not answer left the
 * bar at its very start.
 */
export function smallCache(name: string): { match(url: string): Promise<Response | undefined>; put(url: string, res: Response): Promise<void> } {
  let cache: Promise<Cache> | null = typeof caches === 'undefined' ? null : caches.open(name);
  cache?.catch(() => { cache = null; });
  const gone = (op: StoreEvent['op'], e: unknown) => {
    cache = null;
    const stalled = e instanceof Stalled;
    const message = `cache ${stalled ? 'stalled' : 'failed'}: small files, ${op}, ${(e as Error).message}`;
    console.warn(`model parts: ${message}`);
    listener?.({ store: 'cache', op, stalled, next: null, message });
  };
  return {
    async match(url) {
      if (!cache) return undefined;
      try { return await limited(cache.then((c) => c.match(url)), QUICK_MS, 'cache: looking a small file up'); } catch (e) { gone('look', e); return undefined; }
    },
    async put(url, res) {
      if (!cache) return;
      try { await limited(cache.then((c) => c.put(url, res)), QUICK_MS, 'cache: writing a small file'); } catch (e) { if (e instanceof Stalled) gone('write', e); }
    },
  };
}

/** For tests: every store in use again, nothing held in memory. */
export function resetStores(): void {
  dead.clear();
  for (const k of Object.keys(strikes) as StoreName[]) delete strikes[k];
  held.clear();
  opened = null;
}
