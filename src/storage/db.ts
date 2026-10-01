// Local persistence. Projects are small JSON documents; media are Blobs stored as-is
// (IndexedDB keeps them on disk and Mediabunny reads them in slices).
import { createStore, del, get, set } from 'idb-keyval';
import { projectDuration } from '../core/timeline';
import type { AspectId, Project } from '../core/types';

const store = createStore('kadr', 'kv');

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
  const index = (await get<ProjectMeta[]>('index', store)) ?? [];
  return index.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  return get<Project>(`p:${id}`, store);
}

export async function saveProject(p: Project, thumb?: string): Promise<void> {
  const updatedAt = Date.now();
  await set(`p:${p.id}`, { ...p, updatedAt }, store);
  await withIndex((index) => {
    const prev = index.find((m) => m.id === p.id);
    const meta: ProjectMeta = {
      id: p.id, name: p.name, updatedAt, duration: projectDuration(p), aspect: p.settings.aspect, thumb: thumb ?? prev?.thumb,
    };
    return [meta, ...index.filter((m) => m.id !== p.id)];
  });
}

export async function deleteProject(id: string): Promise<void> {
  const p = await loadProject(id);
  if (p) await Promise.all([...Object.keys(p.assets), ...Object.values(p.fonts ?? {}).map((f) => f.blobId)].map(deleteMedia));
  await del(`p:${id}`, store);
  await withIndex((index) => index.filter((m) => m.id !== id));
}

// Media storage. Blobs are stored as-is when the browser allows it (disk-backed, cheapest). Safari refuses
// Blobs in IndexedDB in private browsing and some other cases (the request fails with a null error), so
// the fallback stores the file as 16 MB ArrayBuffer chunks, which every engine accepts.
const CHUNK = 16 * 1024 * 1024;
interface Chunked { type: string; size: number; chunks: number }
const assembled = new Map<string, Promise<Blob>>();

export async function putBlob(assetId: string, blob: Blob): Promise<void> {
  try {
    await set(`b:${assetId}`, blob, store);
    return;
  } catch { /* Blob storage unsupported here → chunks */ }
  const chunks = Math.max(1, Math.ceil(blob.size / CHUNK));
  for (let i = 0; i < chunks; i++) await set(`c:${assetId}:${i}`, await blob.slice(i * CHUNK, (i + 1) * CHUNK).arrayBuffer(), store);
  await set(`c:${assetId}`, { type: blob.type, size: blob.size, chunks } satisfies Chunked, store);
}

export async function getBlob(assetId: string): Promise<Blob | undefined> {
  const direct = await get<Blob>(`b:${assetId}`, store);
  if (direct) return direct;
  let p = assembled.get(assetId);
  if (!p) {
    p = (async () => {
      const meta = await get<Chunked>(`c:${assetId}`, store);
      if (!meta) throw new Error('missing');
      const parts: ArrayBuffer[] = [];
      for (let i = 0; i < meta.chunks; i++) {
        const part = await get<ArrayBuffer>(`c:${assetId}:${i}`, store);
        if (!part) throw new Error('missing');
        parts.push(part);
      }
      return new Blob(parts, { type: meta.type });
    })();
    assembled.set(assetId, p);
  }
  try {
    return await p;
  } catch {
    assembled.delete(assetId);
    return undefined;
  }
}

async function deleteMedia(assetId: string): Promise<void> {
  const meta = await get<Chunked>(`c:${assetId}`, store).catch(() => undefined);
  const keys = [`b:${assetId}`, `w:${assetId}`, `c:${assetId}`, ...Array.from({ length: meta?.chunks ?? 0 }, (_, i) => `c:${assetId}:${i}`)];
  assembled.delete(assetId);
  await Promise.all(keys.map((k) => del(k, store)));
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
