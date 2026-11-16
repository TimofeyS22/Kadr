// Takes in storage and their locks (SW-A-19, SW-A-17, SW-A-18): a take being recorded holds a Web Lock in its name, the recovery
// brings back only takes whose lock is free, and a voice-over comes back with its place and type.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mem = vi.hoisted(() => {
  // The page db.ts listens to for pagehide and pageshow (SW-A-18); the rest of it needs no window in these tests.
  (globalThis as { window?: EventTarget }).window ??= new EventTarget();
  return new Map<string, unknown>();
});
vi.mock('idb-keyval', () => ({
  get: async (k: string) => mem.get(k),
  set: async (k: string, v: unknown) => { mem.set(k, v); },
  del: async (k: string) => { mem.delete(k); },
  keys: async () => [...mem.keys()],
  promisifyRequest: async () => undefined,
}));

const { TakeWriter, recoverTakes, saveUnfinishedTake } = await import('./db');

type Grant = (lock: { name: string } | null) => Promise<unknown>;
/** Exclusive locks as a browser keeps them for one origin; `dead()` is every tab holding one going away. */
class Locks {
  held = new Set<string>();
  asked: string[] = [];
  /** While set, a request waits for it before it is granted. */
  gate: Promise<void> | null = null;
  async request(name: string, a: { ifAvailable?: boolean } | Grant, b?: Grant): Promise<unknown> {
    const opts = typeof a === 'function' ? {} : a;
    const grant = (typeof a === 'function' ? a : b)!;
    this.asked.push(name);
    if (this.held.has(name)) {
      if (opts.ifAvailable) return grant(null);
      throw new Error('a test waits on a held lock');
    }
    if (this.gate) await this.gate;
    this.held.add(name);
    try { return await grant({ name }); } finally { this.held.delete(name); }
  }
  dead() { this.held.clear(); }
}

let locks: Locks;
beforeEach(() => {
  mem.clear();
  locks = new Locks();
  Object.defineProperty(globalThis.navigator, 'locks', { value: locks, configurable: true });
});
afterEach(() => { Reflect.deleteProperty(globalThis.navigator, 'locks'); });

const piece = (n: number, fill = 1) => new Blob([new Uint8Array(n).fill(fill)]);
const pieceKeys = (project: string) => [...mem.keys()].filter((k) => k.startsWith(`t:${project}:`) && /:\d+$/.test(k));
const lockName = (project: string, take: string) => `kadr-take:${project}:${take}`;

describe('a take in storage and its lock', () => {
  it('holds the lock before its first second is written (SW-A-17)', async () => {
    let open = () => undefined as void;
    locks.gate = new Promise<void>((r) => { open = r; });
    const take = new TakeWriter('p');
    take.add(piece(10));
    await new Promise((r) => setTimeout(r, 20));
    expect(pieceKeys('p'), 'nothing written before the lock is held').toEqual([]);
    open();
    await vi.waitFor(() => expect(pieceKeys('p')).toHaveLength(1));
    expect(locks.held.has(lockName('p', take.id))).toBe(true);
  });

  it('a take another tab is recording is left alone; a crash\'s leftover is brought back, once (SW-A-17)', async () => {
    const live = new TakeWriter('p');
    live.add(piece(10));
    await vi.waitFor(() => expect(pieceKeys('p')).toHaveLength(1));
    mem.set('t:p:old:000000', new Uint8Array(5).buffer); // a crash left this one: nobody holds its lock

    const brought: string[] = [];
    const bring = async (take: string) => { brought.push(take); await new Promise((r) => setTimeout(r, 10)); mem.delete(`t:p:${take}:000000`); };
    await Promise.all([recoverTakes('p', bring), recoverTakes('p', bring)]); // two tabs opening the project at once
    expect(brought, 'the leftover once, the take being recorded not at all').toEqual(['old']);
    expect(pieceKeys('p'), 'the recording keeps its seconds').toEqual([`t:p:${live.id}:000000`]);

    // The recording tab goes (a crash): its take is now a leftover and comes back.
    locks.dead();
    await recoverTakes('p', bring);
    expect(brought).toEqual(['old', live.id]);
  });

  it('discard deletes the seconds and lets the lock go; release keeps them for the next open', async () => {
    const kept = new TakeWriter('p');
    kept.add(piece(4));
    await kept.release();
    expect(locks.held.has(lockName('p', kept.id))).toBe(false);
    expect(pieceKeys('p')).toHaveLength(1);

    const gone = new TakeWriter('p');
    gone.add(piece(4));
    await gone.discard();
    expect(locks.held.has(lockName('p', gone.id))).toBe(false);
    expect(pieceKeys('p'), 'only the released take is left').toEqual([`t:p:${kept.id}:000000`]);
  });

  it('a voice-over comes back with its place and type, and its description is not a second of it (SW-A-19)', async () => {
    const voice = new TakeWriter('v', { kind: 'voice', at: 3.5, type: 'audio/webm' });
    voice.add(piece(7, 2));
    voice.add(piece(9, 3));
    await vi.waitFor(() => expect(pieceKeys('v')).toHaveLength(2));
    locks.dead(); // the tab crashed mid-take

    const got: unknown[] = [];
    await recoverTakes('v', async (take, meta) => {
      got.push(meta);
      const saved = await saveUnfinishedTake('v', take, 'a1', meta.kind === 'voice' ? meta.type : undefined);
      got.push(saved);
    });
    expect(got).toEqual([{ kind: 'voice', at: 3.5, type: 'audio/webm' }, { size: 16, type: 'audio/webm' }]);
    expect(mem.get('c:a1')).toEqual({ type: 'audio/webm', size: 16, chunks: 1 });
    expect([...new Uint8Array(mem.get('c:a1:0') as ArrayBuffer)]).toEqual([...Array(7).fill(2), ...Array(9).fill(3)]);
  });

  it('a recorder\'s last piece, handed over as the page unloads, is not read (SW-A-18)', async () => {
    const take = new TakeWriter('u');
    const read = vi.fn(() => Promise.reject(new Error('Cannot load blob: … due to access control checks')));
    window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false })); // a reload, not the back-forward cache
    take.add({ size: 3, arrayBuffer: read } as unknown as Blob);
    expect(read, 'a dying page reads no Blob of the recorder').not.toHaveBeenCalled();
    window.dispatchEvent(new Event('pageshow')); // a page shown again is alive
    take.add(piece(2));
    await vi.waitFor(() => expect(pieceKeys('u')).toHaveLength(1));
    await take.discard();
  });

  it('from beforeunload a piece is read only once the page stays: a reload reads nothing, a page that stays loses nothing (SW-A-18)', async () => {
    vi.useFakeTimers();
    try {
      // A reload: beforeunload, the recorder's last piece, then pagehide — the piece is never read.
      const gone = new TakeWriter('g');
      const read = vi.fn(() => Promise.reject(new Error('Cannot load blob: … due to access control checks')));
      window.dispatchEvent(new Event('beforeunload'));
      gone.add({ size: 3, arrayBuffer: read } as unknown as Blob);
      window.dispatchEvent(Object.assign(new Event('pagehide'), { persisted: false }));
      await vi.advanceTimersByTimeAsync(2500);
      expect(read, 'a piece handed over while the page leaves is not read').not.toHaveBeenCalled();
      window.dispatchEvent(new Event('pageshow'));
      await gone.discard();

      // A beforeunload with no leave after it: the piece waits, then is written in its place, before the next one.
      const stays = new TakeWriter('s');
      window.dispatchEvent(new Event('beforeunload'));
      stays.add(piece(4, 1));
      await vi.advanceTimersByTimeAsync(500);
      expect(pieceKeys('s'), 'not read while the page may still go').toHaveLength(0);
      await vi.advanceTimersByTimeAsync(2000);
      stays.add(piece(5, 2));
      await vi.waitFor(() => expect(pieceKeys('s')).toHaveLength(2));
      const sizes = pieceKeys('s').sort((x, y) => Number(x.split(':').pop()) - Number(y.split(':').pop()))
        .map((k) => (mem.get(k) as ArrayBuffer).byteLength);
      expect(sizes, 'the waiting piece keeps its place').toEqual([4, 5]);
      await stays.discard();
    } finally {
      vi.useRealTimers();
    }
  });

  it('the page listens for a leave only while a take is recorded (SW-A-18: no cost to the back-forward cache of other pages)', async () => {
    // A fresh copy of the module: takes of the tests above that were never ended still count as recorded.
    vi.resetModules();
    const fresh = await import('./db');
    const add = vi.spyOn(window, 'addEventListener'), remove = vi.spyOn(window, 'removeEventListener');
    const a = new fresh.TakeWriter('l'), b = new fresh.TakeWriter('l');
    expect(add.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
    await a.discard();
    await a.discard();
    expect(remove.mock.calls.filter(([type]) => type === 'beforeunload'), 'one take still records').toHaveLength(0);
    await b.release();
    expect(remove.mock.calls.filter(([type]) => type === 'beforeunload')).toHaveLength(1);
    add.mockRestore(); remove.mockRestore();
  });

  it('a camera take needs no description: one from an older version comes back as a camera take', async () => {
    mem.set('t:c:old:000000', new Uint8Array(3).buffer);
    const cam = new TakeWriter('c');
    cam.add(piece(2));
    await cam.release();
    const got: unknown[] = [];
    await recoverTakes('c', async (_take, meta) => { got.push(meta); });
    expect(got).toEqual([{ kind: 'camera' }, { kind: 'camera' }]);
    expect([...mem.keys()].filter((k) => k.endsWith(':meta'))).toEqual([]);
  });
});
