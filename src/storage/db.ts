// Local persistence. Projects are small JSON documents; media are Blobs stored as-is
// (IndexedDB keeps them on disk and Mediabunny reads them in slices).
import { del, get, keys, promisifyRequest, set, update, type UseStore } from 'idb-keyval';
import { clearDiskFiles } from '../engine/opfs';
import { projectDuration } from '../core/timeline';
import type { AspectId, Project } from '../core/types';
import { perf } from '../lib/perf';
import { CHUNK, ChunkCache, HELD_CHUNKS, chunkedMedia, type Chunked, type StoredMedia } from './chunks';

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
const store: UseStore = async (mode, callback) => {
  for (let attempt = 0; ; attempt++) {
    const db = dbp ??= openDb();
    try {
      return await callback((await db).transaction('kv', mode).objectStore('kv'));
    } catch (e) {
      if (attempt > 0 || !lost(e)) throw e;
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

// Tabs tell each other what they saved, so a tab showing an older version knows before it saves over it.
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('kadr-projects') : null;
const elsewhere = new Set<(id: string) => void>();
channel?.addEventListener('message', (e: MessageEvent<{ id: string; rev: number; writer: string }>) => {
  if (e.data?.writer !== TAB && seen.has(e.data.id) && seen.get(e.data.id) !== e.data.rev) for (const fn of elsewhere) fn(e.data.id);
});
/** Calls `fn(id)` when another tab saves a project this tab has open; returns the unsubscribe. */
export function onSavedElsewhere(fn: (id: string) => void): () => void {
  elsewhere.add(fn);
  return () => elsewhere.delete(fn);
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
  const [index, all] = await Promise.all([get<ProjectMeta[]>('index', store).then((x) => x ?? []), keys(store)]);
  // The list is a cache of the projects, written apart from them: one it lost is still a project (audit V-256).
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
    const fresh = j.base !== undefined ? (stored?.rev ?? 0) === j.base : (stored?.updatedAt ?? 0) < Math.floor(j.seq / 1000);
    if (fresh) {
      seen.set(id, stored?.rev ?? 0);
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
 * version wins anyway, the person chose it).
 */
export async function saveProject(p: Project, thumb?: string, force = false): Promise<void> {
  const updatedAt = Date.now();
  let conflict = false, rev = 0;
  await update<Stored>(`p:${p.id}`, (old) => {
    const base = seen.get(p.id);
    conflict = !force && !!old && old.writer !== TAB && base !== undefined && (old.rev ?? 0) !== base;
    if (conflict) return old!;
    rev = (old?.rev ?? 0) + 1;
    return { ...p, updatedAt, rev, writer: TAB };
  }, store);
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
const takeKey = (project: string, take: string, n: number) => `t:${project}:${take}:${String(n).padStart(6, '0')}`;

export class TakeWriter {
  readonly id = Math.random().toString(36).slice(2, 10);
  private n = 0;
  /** Pieces the storage refused (a private tab): they stay here, as every piece did before. */
  private memory = new Map<number, Blob>();
  private writing: Promise<unknown> = Promise.resolve();
  constructor(private readonly project: string) {}

  add(piece: Blob): void {
    const i = this.n++;
    this.writing = this.writing.then(() => set(takeKey(this.project, this.id, i), piece, store)).catch(() => { this.memory.set(i, piece); });
  }

  /** The take so far as one file: its pieces stay on disk, not in memory. */
  async file(name: string, type: string): Promise<File> {
    await this.writing;
    const parts: Blob[] = [];
    for (let i = 0; i < this.n; i++) {
      const piece = this.memory.get(i) ?? await get<Blob>(takeKey(this.project, this.id, i), store);
      if (piece) parts.push(piece);
    }
    return new File(parts, name, { type });
  }

  async discard(): Promise<void> {
    await this.writing;
    await deleteTake(this.project, this.id);
  }
}

export async function deleteTake(project: string, take: string): Promise<void> {
  const prefix = `t:${project}:${take}:`;
  await Promise.all((await keys(store)).filter((k) => typeof k === 'string' && k.startsWith(prefix)).map((k) => del(k, store)));
}

/** Takes a crash left behind in this project, each as one blob. */
export async function unfinishedTakes(project: string): Promise<{ id: string; blob: Blob }[]> {
  const prefix = `t:${project}:`;
  const found = new Map<string, string[]>();
  for (const k of await keys(store)) {
    if (typeof k !== 'string' || !k.startsWith(prefix)) continue;
    const take = k.slice(prefix.length).split(':')[0];
    found.set(take, [...(found.get(take) ?? []), k]);
  }
  const out: { id: string; blob: Blob }[] = [];
  for (const [id, list] of found) {
    const parts = await Promise.all(list.sort().map((k) => get<Blob>(k, store)));
    const blobs = parts.filter((b): b is Blob => !!b);
    if (blobs.length) out.push({ id, blob: new Blob(blobs, { type: blobs[0].type }) });
  }
  return out;
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
