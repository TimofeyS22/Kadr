// Local persistence. Projects are small JSON documents; media are Blobs stored as-is
// (IndexedDB keeps them on disk and Mediabunny reads them in slices).
import { del, get, keys, promisifyRequest, set, type UseStore } from 'idb-keyval';
import { clearDiskFiles } from '../engine/opfs';
import { projectDuration } from '../core/timeline';
import type { AspectId, Project } from '../core/types';
import { perf } from '../lib/perf';
import { cacheGate } from './bfcache';
import { CHUNK, ChunkCache, HELD_CHUNKS, chunkedMedia, type Chunked, type StoredMedia } from './chunks';
import { track } from '../lib/telemetry';
import { leasedReader, type LeaseEvent, type MediaReader } from './reader';
import { SNIFF_BYTES, sniffMime } from '../core/sniff';

/**
 * The 'kadr'/'kv' store, opened again when the browser drops the connection. WebKit drops it while the page is in the
 * background ("Connection to Indexed Database server lost") without always saying so in `onclose`; every save then
 * failed until a reload, and the save made when the page was hidden was lost (audit V-120).
 */
let dbp: Promise<IDBDatabase> | null = null;
function openDb(): Promise<IDBDatabase> {
  const p = new Promise<IDBDatabase>((ok, ko) => {
    const r = indexedDB.open('kadr');
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => ok(r.result);
    r.onerror = () => ko(r.error);
  });
  p.then((db) => { db.onclose = () => { if (dbp === p) dbp = null; }; }, () => { if (dbp === p) dbp = null; });
  return p;
}
const lost = (e: unknown) => e instanceof DOMException && (e.name === 'InvalidStateError' || e.name === 'UnknownError' || /connection|closing|lost/i.test(e.message));
/** No transaction of this page stays open in the back-forward cache (see bfcache.ts); its connection is closed too. */
const gate = typeof window === 'undefined' ? null : cacheGate(window, () => {
  const db = dbp;
  dbp = null;
  void db?.then((d) => d.close(), () => undefined);
});
const store: UseStore = async (mode, callback) => {
  for (let attempt = 0; ; ) {
    if (gate?.away) await gate.away;
    const db = dbp ??= openDb();
    try {
      const conn = await db;
      if (gate?.away) continue; // the page went into the cache while the store was opening
      const tx = conn.transaction('kv', mode);
      gate?.track(tx);
      return await callback(tx.objectStore('kv'));
    } catch (e) {
      if (gate?.away) continue; // aborted as the page went into the cache: done again once it is back
      if (attempt++ > 0 || !lost(e)) throw e;
      console.warn('IndexedDB connection lost, opening it again', e);
      if (dbp === db) dbp = null;
      (await db.catch(() => null))?.close();
    }
  }
};

/** This tab. A project saved by another tab since this one loaded it is not written over (audit V-258). */
const TAB = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
/** The revision of each project this tab's copy is based on: loaded, or saved by this tab. */
const seen = new Map<string, number>();
type Stored = Project & { rev?: number; writer?: string };
const bare = (s: Stored): Project => { const { rev: _r, writer: _w, ...p } = s; return p; };

/** Another tab saved this project after this tab loaded it: saving here would wipe that tab's edits. */
export class ProjectConflict extends Error {
  constructor(readonly id: string) { super('The project was changed in another tab'); this.name = 'ProjectConflict'; }
}

/**
 * The project this tab has is no longer stored: it was deleted, with its media, in another tab or window (search S-1-1).
 * Before, the next edit here wrote it back: the confirmed delete was undone without a word, the project came back to
 * the list with no media, and its export failed.
 */
export class ProjectDeleted extends Error {
  constructor(readonly id: string) { super('The project was deleted in another tab'); this.name = 'ProjectDeleted'; }
}

// Tabs tell each other what they saved or deleted, so a tab showing an older version knows before it saves over it.
type TabNews = { id: string; writer: string } & ({ rev: number } | { deleted: true });
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kadr-projects') : null;
const elsewhere = new Set<(id: string) => void>();
const deletedElsewhere = new Set<(id: string) => void>();
channel?.addEventListener('message', (e: MessageEvent<TabNews>) => {
  const news = e.data;
  if (!news || news.writer === TAB || !seen.has(news.id)) return;
  if ('deleted' in news) for (const fn of deletedElsewhere) fn(news.id);
  else if (seen.get(news.id) !== news.rev) for (const fn of elsewhere) fn(news.id);
});
/** Calls `fn(id)` when another tab saves a project this tab has open; returns the unsubscribe. */
export function onSavedElsewhere(fn: (id: string) => void): () => void {
  elsewhere.add(fn);
  return () => elsewhere.delete(fn);
}
/** Calls `fn(id)` when another tab deletes a project this tab has open; returns the unsubscribe. */
export function onDeletedElsewhere(fn: (id: string) => void): () => void {
  deletedElsewhere.add(fn);
  return () => deletedElsewhere.delete(fn);
}

export interface ProjectMeta { id: string; name: string; updatedAt: number; duration: number; aspect: AspectId; thumb?: string }

// Serializes index read-modify-write cycles.
let indexLock: Promise<unknown> = Promise.resolve();
function withIndex(fn: (index: ProjectMeta[]) => ProjectMeta[]): Promise<void> {
  const run = indexLock.then(async () => {
    const index = ((await get<ProjectMeta[]>('index', store)) ?? []);
    await set('index', fn(index), store);
  });
  indexLock = run.catch(() => undefined);
  return run;
}

export async function listProjects(): Promise<ProjectMeta[]> {
  const [cached, all] = await Promise.all([get<ProjectMeta[]>('index', store).then((x) => x ?? []), keys(store)]);
  // The list is a cache of the projects, written apart from them: one it lost is still a project (audit V-256), and
  // one it still names after the project was deleted is not (tabs write it each on their own, S-1-1).
  const index = cached.filter((m) => all.includes(`p:${m.id}`));
  const known = new Set(index.map((m) => m.id));
  for (const k of all) {
    if (typeof k !== 'string' || !k.startsWith('p:') || known.has(k.slice(2))) continue;
    const p = await get<Stored>(k, store);
    if (p) index.push({ id: p.id, name: p.name, updatedAt: p.updatedAt, duration: projectDuration(p), aspect: p.settings.aspect });
  }
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

// Edits the page had not saved when it went away (v1.4.3). An IndexedDB write started in pagehide is cut off when the
// page unloads: a split made half a second before a reload was lost (docs/11 QA). localStorage is synchronous and
// survives; the journal is dropped once the IndexedDB save of that very version lands, and replayed on the next open.
const JOURNAL = 'kadr.journal';
let journalSeq = 0;
/** `base`: the stored revision the edits were made on (journals before v1.6.2 have none: their time is compared). */
type Journal = { seq: number; project: Project; base?: number };

function readJournal(id: string): Journal | null {
  try {
    const j = JSON.parse(localStorage.getItem(JOURNAL) ?? 'null') as Journal | null;
    return j?.project?.id === id ? j : null;
  } catch { return null; }
}

/** Synchronously keeps this version of the project until `clearJournal(seq)`; returns the version number (0 if not kept). */
export function journalProject(project: Project): number {
  const seq = Date.now() * 1000 + (journalSeq++ % 1000);
  try { localStorage.setItem(JOURNAL, JSON.stringify({ seq, project, base: seen.get(project.id) ?? 0 } satisfies Journal)); return seq; }
  catch (e) { console.warn('Unsaved edits could not be journaled', e); return 0; }
}

/** Drops the journal if it still holds version `seq` of project `id` (a newer edit keeps its own). */
export function clearJournal(id: string, seq: number): void {
  try { if (readJournal(id)?.seq === seq) localStorage.removeItem(JOURNAL); } catch { /* storage blocked */ }
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const stored = await get<Stored>(`p:${id}`, store);
  const j = readJournal(id);
  if (j) {
    // The page went away before these edits reached IndexedDB. Only if nothing was saved after them: a journal left by
    // a save that failed was replayed over later edits, which were lost (audit V-120).
    // A project no longer stored was deleted: its journal does not bring it back without its media (S-1-1).
    const fresh = !!stored && (j.base !== undefined ? (stored.rev ?? 0) === j.base : stored.updatedAt < Math.floor(j.seq / 1000));
    if (fresh) {
      seen.set(id, stored.rev ?? 0);
      // A full disk must not stand between the person and their project (audit V-107): it opens, the journal stays.
      await saveProject(j.project).then(() => clearJournal(id, j.seq), (e) => console.warn('the journal could not be written back', e));
      return j.project;
    }
    clearJournal(id, j.seq);
  }
  if (!stored) return undefined;
  seen.set(id, stored.rev ?? 0);
  return bare(stored);
}

/**
 * Saves the project. Throws ProjectConflict when another tab saved it after this tab loaded it (`force`: this
 * version wins anyway, the person chose it), and ProjectDeleted when it was deleted since (`force` or not: its media
 * are gone with it).
 */
export async function saveProject(p: Project, thumb?: string, force = false): Promise<void> {
  const updatedAt = Date.now();
  const key = `p:${p.id}`;
  let conflict = false, deleted = false, rev = 0;
  // Read and written in one transaction, and nothing written when refused (idb-keyval's `update` always writes).
  await store('readwrite', (s) => new Promise<void>((ok, ko) => {
    const read = s.get(key);
    read.onerror = () => ko(read.error);
    read.onsuccess = () => {
      // `put` can throw right away (a full disk, a value it cannot copy): thrown from this handler, it never reached the
      // caller, and the save waited forever (a project with a journal on a full disk did not open, audit V-107).
      try {
        const old = read.result as Stored | undefined;
        const base = seen.get(p.id);
        deleted = !old && base !== undefined; // this tab had it stored: it was deleted since
        conflict = !force && !!old && old.writer !== TAB && base !== undefined && (old.rev ?? 0) !== base;
        if (!deleted && !conflict) {
          rev = (old?.rev ?? 0) + 1;
          s.put({ ...p, updatedAt, rev, writer: TAB } satisfies Stored, key);
        }
        promisifyRequest(s.transaction).then(ok, ko);
      } catch (e) { ko(e); }
    };
  }));
  if (deleted) throw new ProjectDeleted(p.id);
  if (conflict) throw new ProjectConflict(p.id);
  seen.set(p.id, rev);
  channel?.postMessage({ id: p.id, rev, writer: TAB });
  await withIndex((index) => {
    const prev = index.find((m) => m.id === p.id);
    const meta: ProjectMeta = {
      id: p.id, name: p.name, updatedAt, duration: projectDuration(p), aspect: p.settings.aspect, thumb: thumb ?? prev?.thumb,
    };
    return [meta, ...index.filter((m) => m.id !== p.id)];
  });
}

/** This tab no longer shows the project (it left the editor): another tab saving it is no conflict. */
export function forgetProject(id: string): void { seen.delete(id); }

export async function deleteProject(id: string): Promise<void> {
  // Read as it is: going through the journal wrote to storage first, and a full disk then refused the delete (audit V-107).
  const stored = await get<Stored>(`p:${id}`, store);
  const j = readJournal(id);
  const media = new Set([stored, j?.project].flatMap((p) => (p ? [...Object.keys(p.assets), ...Object.values(p.fonts ?? {}).map((f) => f.blobId)] : [])));
  await Promise.all([...media].map(deleteBlob));
  if (j) clearJournal(id, j.seq);
  await Promise.all((await keys(store)).filter((k) => typeof k === 'string' && k.startsWith(`t:${id}:`)).map((k) => del(k, store)));
  await del(`p:${id}`, store);
  seen.delete(id);
  channel?.postMessage({ id, deleted: true, writer: TAB } satisfies TabNews); // a tab that has it open stops saving it (S-1-1)
  await withIndex((index) => index.filter((m) => m.id !== id));
  await clearDiskFiles(); // the last export and backup: "its media will be removed" means those too (audit V-189)
}

// Media storage. Blobs are stored as-is when the browser allows it (disk-backed, cheapest). Safari refuses
// Blobs in IndexedDB in private browsing and some other cases (the request fails with a null error), so
// the fallback stores the file as 16 MB ArrayBuffer chunks, which every engine accepts. Those are read a chunk at a
// time (`openMedia`), never kept together: in a private tab the stored copy is already in memory once (audit V-253).
const held = new ChunkCache(HELD_CHUNKS, perf.chunks);

/** The storage is full: as the one error the app explains (some engines say "quota" under another name). */
function quotaError(e: unknown): DOMException | null {
  if (!(e instanceof DOMException)) return null;
  if (e.name === 'QuotaExceededError') return e;
  return /quota/i.test(e.message) ? new DOMException(e.message, 'QuotaExceededError') : null;
}

export async function putBlob(assetId: string, blob: Blob): Promise<void> {
  try {
    await set(`b:${assetId}`, blob, store);
    return;
  } catch (e) {
    // Out of room is out of room in chunks too. Anything else is Safari refusing Blobs here (docs/12 stage 3).
    const full = quotaError(e);
    if (full) throw full;
  }
  const chunks = Math.max(1, Math.ceil(blob.size / CHUNK));
  try {
    for (let i = 0; i < chunks; i++) await set(`c:${assetId}:${i}`, await blob.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer(), store);
    await set(`c:${assetId}`, { type: blob.type, size: blob.size, chunks } satisfies Chunked, store);
  } catch (e) {
    // A file written halfway is no file: its chunks go, or they would hold the space for nothing.
    await Promise.all(Array.from({ length: chunks }, (_, i) => del(`c:${assetId}:${i}`, store).catch(() => undefined)));
    throw quotaError(e) ?? e;
  }
}

/** The record of a file kept in chunks, if all of them are there. Only keys are asked for: nothing is read into memory. */
async function chunkedMeta(assetId: string): Promise<Chunked | undefined> {
  const meta = await get<Chunked>(`c:${assetId}`, store);
  if (!meta) return undefined;
  const prefix = `c:${assetId}:`;
  const have = new Set(await store('readonly', (s) => promisifyRequest(s.getAllKeys(IDBKeyRange.bound(prefix, `${prefix}\uffff`)))));
  for (let i = 0; i < meta.chunks; i++) if (!have.has(`${prefix}${i}`)) return undefined;
  return meta;
}

/**
 * A stored file to decode: the Blob where the browser keeps one, else a reader that fetches the file's chunks as they
 * are asked for. Video and sound go through this; `getBlob` is for what must be handed over whole.
 */
export async function openMedia(assetId: string): Promise<StoredMedia | undefined> {
  const direct = await get<Blob>(`b:${assetId}`, store);
  if (direct) return direct;
  const meta = await chunkedMeta(assetId);
  return meta && chunkedMedia(assetId, meta, (i) => get<ArrayBuffer>(`c:${assetId}:${i}`, store), held);
}

/** A lease replaced or a read that failed even so: counted, never with content (docs/19 H5). */
function leaseReport(e: LeaseEvent): void {
  if (e.healed) perf.leases.renewed++;
  else perf.leases.failed++;
  track('media_lease', { healed: e.healed, attempts: e.attempts, error: e.error });
  console.warn(e.healed ? 'A stored media file stopped reading; it was opened again' : 'A stored media file could not be read even when opened again', e);
}

/**
 * A stored file to decode through the one door (docs/19 ADR-М1): it reads by the asset's id and replaces the Blob it
 * holds when that stops reading (S-1-13). Undefined when the file is not stored.
 */
export async function openReader(assetId: string): Promise<MediaReader | undefined> {
  const media = await openMedia(assetId);
  return media && leasedReader(assetId, media, () => openMedia(assetId), { report: leaseReport });
}

/**
 * A stored file as one Blob, for what takes nothing else (a photo to decode, a font). A file kept in chunks is put
 * together in memory for the caller alone and is not kept: do not read a video this way.
 */
export async function getBlob(assetId: string): Promise<Blob | undefined> {
  const direct = await get<Blob>(`b:${assetId}`, store);
  if (direct) return direct;
  try {
    const meta = await get<Chunked>(`c:${assetId}`, store);
    if (!meta) return undefined;
    const parts: ArrayBuffer[] = [];
    for (let i = 0; i < meta.chunks; i++) {
      const part = await get<ArrayBuffer>(`c:${assetId}:${i}`, store);
      if (!part) return undefined;
      parts.push(part);
    }
    return new Blob(parts, { type: meta.type });
  } catch {
    return undefined;
  }
}

/** A stored file and what was made from it (chunks, waveform). */
export async function deleteBlob(assetId: string): Promise<void> {
  const meta = await get<Chunked>(`c:${assetId}`, store).catch(() => undefined);
  const keys = [`b:${assetId}`, `w:${assetId}`, `c:${assetId}`, ...Array.from({ length: meta?.chunks ?? 0 }, (_, i) => `c:${assetId}:${i}`)];
  held.drop(`${assetId}:`);
  await Promise.all(keys.map((k) => del(k, store)));
}
/**
 * Deletes stored media no project refers to: an import cut short, a crash before the save, a result nobody took (audit
 * V-176). Call only while no tab has an editor or a job open: their media may not be in any saved project yet.
 */
export async function collectOrphans(): Promise<number> {
  const all = await keys(store);
  const used = new Set<string>();
  const hold = (p: Pick<Project, 'assets' | 'fonts'>) => {
    for (const id of Object.keys(p.assets ?? {})) used.add(id);
    for (const f of Object.values(p.fonts ?? {})) used.add(f.blobId);
  };
  for (const k of all) {
    if (typeof k !== 'string' || !k.startsWith('p:')) continue;
    const p = await get<Stored>(k, store);
    if (p) hold(p);
  }
  try {
    const j = JSON.parse(localStorage.getItem(JOURNAL) ?? 'null') as Journal | null;
    if (j?.project) hold(j.project);
  } catch { /* no journal to honour */ }
  const orphans = new Set(all.flatMap((k) => (typeof k === 'string' && /^[bwc]:/.test(k) ? [k.split(':')[1]] : [])).filter((id) => !used.has(id)));
  await Promise.all([...orphans].map(deleteBlob));
  return orphans.size;
}

/** Lets go of the chunks held in memory for the project just left (the chunked fallback keeps the last two it read). */
export function forgetLoadedMedia(): void { held.drop(); }

// A camera take, written second by second as it is recorded (audit V-250): it used to live in the page's memory until
// Stop, so memory grew with every second and a crash lost all of it.
//
// The take's bytes become the stored file a piece at a time (docs/19 ADR-М5, variant «c»). It used to be read back from
// the store as Blobs, put together into one File and saved again as the asset's Blob, and its pieces were deleted right
// after: on the iPhone that saved Blob stopped reading the moment they went (S-1-13), for 0.3 s to 20 s. Now every
// second is kept as bytes (a Blob is never stored here), and Stop copies them, in order, into the chunks of a new
// stored file. No Blob read from the store is saved again, deleting the pieces cannot touch the file, and IndexedDB
// takes bytes even where it refuses Blobs (a private tab), so there a crash no longer loses the take either.
const takeKey = (project: string, take: string, n: number) => `t:${project}:${take}:${String(n).padStart(6, '0')}`;

/** A stored piece as bytes; a piece stored as a Blob by an older version is read once, here. */
async function pieceBytes(v: unknown): Promise<ArrayBuffer | undefined> {
  if (v instanceof ArrayBuffer) return v;
  if (v instanceof Blob) return v.arrayBuffer().catch((e: unknown) => { console.warn('A second of a camera take could not be read', e); return undefined; });
  return undefined;
}

/**
 * Writes `pieces`, in order, as the chunks of the new stored file `assetId` and returns its size (0, and nothing
 * written, when there are no bytes). `type` is asked for once the bytes are in. Memory holds one chunk and one piece.
 * A file written halfway is removed.
 */
async function writeChunks(assetId: string, type: () => string, pieces: AsyncIterable<ArrayBuffer>): Promise<number> {
  const chunk = new Uint8Array(CHUNK);
  let filled = 0, n = 0, size = 0;
  try {
    for await (const piece of pieces) {
      const bytes = new Uint8Array(piece);
      for (let at = 0; at < bytes.length;) {
        const part = Math.min(CHUNK - filled, bytes.length - at);
        chunk.set(bytes.subarray(at, at + part), filled);
        filled += part; at += part; size += part;
        // The store copies the bytes as it takes them, so the same buffer is filled again after the write.
        if (filled === CHUNK) { await set(`c:${assetId}:${n}`, chunk.buffer, store); n++; filled = 0; }
      }
    }
    if (filled) { await set(`c:${assetId}:${n}`, chunk.slice(0, filled).buffer, store); n++; }
    if (size) await set(`c:${assetId}`, { type: type(), size, chunks: n } satisfies Chunked, store);
    return size;
  } catch (e) {
    await Promise.all(Array.from({ length: n + 1 }, (_, i) => del(`c:${assetId}:${i}`, store).catch(() => undefined)));
    throw quotaError(e) ?? e;
  }
}

// A take being recorded is held under a Web Lock in its name (SW-A-17). The tab recording it takes the lock before the
// take's first second is written and keeps it until the take is in the project or let go; the browser lets it go when
// the tab dies (a crash, a reload, the system taking the page back). So a take whose lock is free is a crash's leftover,
// and one whose lock is held is being recorded in another tab right now. Where the browser has no locks (an insecure
// page), every take found counts as left over, as before.
const takeLock = (project: string, take: string) => `kadr-take:${project}:${take}`;
const lockManager = (): LockManager | undefined => (typeof navigator === 'undefined' ? undefined : navigator.locks as LockManager | undefined);

/** Takes the lock `name` and resolves with the function that lets it go (else it goes with the page). */
function holdLock(name: string): Promise<() => void> {
  const locks = lockManager();
  if (!locks) return Promise.resolve(() => undefined);
  return new Promise((held) => {
    locks.request(name, () => new Promise<void>((free) => held(free)))
      .catch((e: unknown) => { console.warn('A take could not be locked', e); held(() => undefined); });
  });
}

export class TakeWriter {
  readonly id = Math.random().toString(36).slice(2, 10);
  /** Bytes recorded so far, for the room check before the save. */
  bytes = 0;
  private n = 0;
  /** Pieces the storage refused (no room, a lost connection): their bytes wait here for the save. */
  private memory = new Map<number, ArrayBuffer>();
  /** Every write waits for the lock: no second of the take is in storage before it is held. */
  private writing: Promise<unknown>;
  private free: () => void = () => undefined;
  constructor(private readonly project: string) {
    this.writing = holdLock(takeLock(project, this.id)).then((free) => { this.free = free; });
  }

  add(piece: Blob): void {
    const i = this.n++;
    this.bytes += piece.size;
    // The bytes are taken now: a Blob the recorder made can stop reading before its turn to be written (docs/19 С12).
    const bytes = piece.arrayBuffer();
    bytes.catch(() => undefined);
    this.writing = this.writing
      .then(async () => {
        const b = await bytes;
        await set(takeKey(this.project, this.id, i), b, store).catch(() => { this.memory.set(i, b); });
      })
      .catch((e: unknown) => console.warn('A second of a camera take could not be read', e));
  }

  /**
   * Saves the take so far as the stored file `assetId` (docs/19 ADR-М5) and returns its size, 0 for a take with no
   * bytes. The pieces stay until `discard`: a full disk or a crash during the save loses nothing.
   */
  async save(assetId: string, type: string): Promise<number> {
    await this.writing;
    const { project, id, memory, n } = this;
    return writeChunks(assetId, () => type, (async function* () {
      for (let i = 0; i < n; i++) {
        const piece = memory.get(i) ?? await pieceBytes(await get(takeKey(project, id, i), store));
        if (piece) yield piece;
      }
    })());
  }

  /** Deletes the take's pieces (it is in the project, or holds nothing), then lets its lock go. */
  async discard(): Promise<void> {
    await this.writing;
    try {
      await deleteTake(this.project, this.id);
    } finally {
      this.free();
    }
  }

  /** Lets the take go with its pieces kept (no room, the project left): it comes back when the project opens. */
  async release(): Promise<void> {
    await this.writing;
    this.free();
  }
}

export async function deleteTake(project: string, take: string): Promise<void> {
  const prefix = `t:${project}:${take}:`;
  await Promise.all((await keys(store)).filter((k) => typeof k === 'string' && k.startsWith(prefix)).map((k) => del(k, store)));
}

/** Takes with pieces in storage in this project, left over or being recorded: their ids. */
async function storedTakes(project: string): Promise<string[]> {
  const prefix = `t:${project}:`;
  const found = new Set<string>();
  for (const k of await keys(store)) if (typeof k === 'string' && k.startsWith(prefix)) found.add(k.slice(prefix.length).split(':')[0]);
  return [...found];
}

/**
 * Hands each take a crash left behind in this project to `bring`, which puts it into the project and deletes its
 * pieces, while this tab holds the take's lock. A take whose lock is held is being recorded in another tab and is left
 * alone: opening the project in a second tab used to take it for a leftover, put what it had so far into its own copy
 * and delete the pieces under the recording (SW-A-17). Two tabs opening the project at once bring a take back once.
 */
export async function recoverTakes(project: string, bring: (take: string) => Promise<void>): Promise<void> {
  const locks = lockManager();
  for (const take of await storedTakes(project)) {
    if (!locks) await bring(take);
    else await locks.request(takeLock(project, take), { ifAvailable: true }, async (lock) => { if (lock) await bring(take); });
  }
}

/**
 * Saves a take a crash left behind as the stored file `assetId`, as Stop does (docs/19 ADR-М5): its size and the type
 * its first bytes show. Its pieces stay until `deleteTake`.
 */
export async function saveUnfinishedTake(project: string, take: string, assetId: string): Promise<{ size: number; type: string }> {
  const prefix = `t:${project}:${take}:`;
  const list = (await keys(store)).filter((k): k is string => typeof k === 'string' && k.startsWith(prefix)).sort();
  let seen = '';
  const type = () => seen.split(';')[0] || 'video/webm';
  const size = await writeChunks(assetId, type, (async function* () {
    for (const k of list) {
      const v = await get(k, store);
      const piece = await pieceBytes(v);
      if (!piece) continue;
      seen ||= sniffMime(new Uint8Array(piece, 0, Math.min(SNIFF_BYTES, piece.byteLength))) ?? (v instanceof Blob ? v.type : '');
      yield piece;
    }
  })());
  return { size, type: type() };
}

export const putPeaks = (assetId: string, peaks: Float32Array): Promise<void> => set(`w:${assetId}`, peaks, store);
export const getPeaks = (assetId: string): Promise<Float32Array | undefined> => get<Float32Array>(`w:${assetId}`, store);

/** Asks the browser not to evict our data under storage pressure (important on iOS). */
export async function requestPersistence(): Promise<boolean> {
  try {
    return (await navigator.storage?.persisted?.()) || ((await navigator.storage?.persist?.()) ?? false);
  } catch {
    return false;
  }
}
