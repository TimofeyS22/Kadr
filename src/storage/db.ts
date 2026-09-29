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
  if (p) await Promise.all(Object.keys(p.assets).flatMap((a) => [del(`b:${a}`, store), del(`w:${a}`, store)]));
  await del(`p:${id}`, store);
  await withIndex((index) => index.filter((m) => m.id !== id));
}

export const putBlob = (assetId: string, blob: Blob): Promise<void> => set(`b:${assetId}`, blob, store);
export const getBlob = (assetId: string): Promise<Blob | undefined> => get<Blob>(`b:${assetId}`, store);
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
