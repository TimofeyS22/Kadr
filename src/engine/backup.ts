// Project backup: a stored (uncompressed) zip with project.json and media/<assetId>, streamed with fflate.
import { Unzip, UnzipPassThrough, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { uid } from '../core/defaults';
import { normalizeProject, remapAssets } from '../core/timeline';
import { SCHEMA_VERSION, type Project } from '../core/types';
import { getBlob, putBlob, saveProject } from '../storage/db';
import { MediaError } from './media';

export async function exportBackup(p: Project, onProgress?: (f: number) => void): Promise<Blob> {
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let finished!: () => void, failed!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => { finished = res; failed = rej; });
  const zip = new Zip((err, data, final) => {
    if (err) { failed(err); return; }
    parts.push(data as Uint8Array<ArrayBuffer>);
    if (final) finished();
  });
  const meta = new ZipPassThrough('project.json');
  zip.add(meta);
  meta.push(strToU8(JSON.stringify(p)), true);
  const ids = [...Object.keys(p.assets), ...Object.values(p.fonts ?? {}).map((f) => f.blobId)]; // media and the user's fonts
  for (let i = 0; i < ids.length; i++) {
    const blob = await getBlob(ids[i]);
    if (!blob) continue;
    const entry = new ZipPassThrough(`media/${ids[i]}`);
    zip.add(entry);
    const reader = blob.stream().getReader();
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      entry.push(value);
    }
    entry.push(new Uint8Array(0), true);
    onProgress?.((i + 1) / ids.length);
  }
  zip.end();
  await done;
  return new Blob(parts, { type: 'application/zip' });
}

function validate(x: unknown): Project {
  const p = x as Project;
  const ok = p && typeof p === 'object' && typeof p.version === 'number' && p.version <= SCHEMA_VERSION
    && Array.isArray(p.tracks) && p.settings && typeof p.settings.width === 'number' && p.assets && typeof p.assets === 'object';
  if (!ok) throw new MediaError('This file is not a Kadr project backup (or it was made by a newer version).');
  return p;
}

/** Restores a backup as a new project (new ids, so it never overwrites anything). */
export async function importBackup(file: Blob): Promise<Project> {
  const files = new Map<string, Blob>();
  const pending: Promise<void>[] = [];
  const unzip = new Unzip((entry) => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    pending.push(new Promise((resolve, reject) => {
      entry.ondata = (err, data, final) => {
        if (err) { reject(err); return; }
        chunks.push(data as Uint8Array<ArrayBuffer>);
        if (final) { files.set(entry.name, new Blob(chunks)); resolve(); }
      };
    }));
    entry.start();
  });
  unzip.register(UnzipPassThrough);
  const reader = file.stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { unzip.push(new Uint8Array(0), true); break; }
    unzip.push(value);
  }
  await Promise.all(pending);
  const json = files.get('project.json');
  if (!json) throw new MediaError('The backup has no project.json');
  const p = validate(JSON.parse(strFromU8(new Uint8Array(await json.arrayBuffer()))));
  const ids = new Map<string, string>();
  const idFor = (old: string) => { if (!ids.has(old)) ids.set(old, uid()); return ids.get(old)!; };
  remapAssets(p, idFor);
  for (const f of Object.values(p.fonts ?? {})) f.blobId = idFor(f.blobId);
  for (const [old, id] of ids) {
    const blob = files.get(`media/${old}`);
    if (blob) await putBlob(id, new Blob([blob], { type: p.assets[id]?.mime ?? '' }));
    else delete p.assets[id];
  }
  const restored: Project = { ...p, id: uid(), name: `${p.name} (restored)`, updatedAt: Date.now() };
  normalizeProject(restored);
  await saveProject(restored);
  return restored;
}
