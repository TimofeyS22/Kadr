// Project backup: a stored (uncompressed) zip with project.json and media/<assetId>, streamed with fflate.
import { Unzip, UnzipInflate, UnzipPassThrough, Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { uid } from '../core/defaults';
import { repairBackup } from '../core/restore';
import { normalizeProject, remapAssets } from '../core/timeline';
import { SCHEMA_VERSION, type Project } from '../core/types';
import { deleteBlob, getBlob, putBlob, saveProject } from '../storage/db';
import { ensureRoom } from './importer';
import { MediaError } from './media';
import { diskFile } from './opfs';
import { within } from '../lib/limits';

/** The file system gets this long to open the backup file; then the backup is made in memory. */
const DISK_MS = 5000;

/**
 * The backup streams to a file in the origin-private file system where there is one (docs/12 P2): a project with
 * a gigabyte of media does not fit in a phone's memory twice over. Elsewhere it is made in memory as before.
 */
export async function exportBackup(p: Project, onProgress?: (f: number) => void): Promise<Blob> {
  const opening = diskFile('backup', 'zip');
  const disk = await within(opening, DISK_MS, () => { void opening.then((late) => late?.drop()); return null; });
  const parts: Uint8Array<ArrayBuffer>[] = [];
  let writing: Promise<void> = Promise.resolve();
  let finished!: () => void, failed!: (e: unknown) => void;
  const done = new Promise<void>((res, rej) => { finished = res; failed = rej; });
  const zip = new Zip((err, data, final) => {
    if (err) { failed(err); return; }
    if (disk) writing = writing.then(() => disk.writable.write(data as Uint8Array<ArrayBuffer>));
    else parts.push(data as Uint8Array<ArrayBuffer>);
    if (final) finished();
  });
  try {
    await addEntries(zip, p, () => writing, onProgress);
    await done;
    if (!disk) return new Blob(parts, { type: 'application/zip' });
    await writing;
    await disk.writable.close();
    return new Blob([await disk.file()], { type: 'application/zip' });
  } catch (e) {
    disk?.drop();
    throw e;
  }
}

/** project.json and every media file and font, read and zipped piece by piece; `written` waits for the disk. */
async function addEntries(zip: Zip, p: Project, written: () => Promise<void>, onProgress?: (f: number) => void): Promise<void> {
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
      await written(); // the disk keeps up: at most one piece of media is in memory at a time
    }
    entry.push(new Uint8Array(0), true);
    onProgress?.((i + 1) / ids.length);
  }
  zip.end();
}

const NOT_A_BACKUP = 'This file is not a Kadr project backup (or it was made by a newer version).';

function validate(x: unknown): Project {
  const p = x as Project;
  const ok = p && typeof p === 'object' && typeof p.version === 'number' && p.version <= SCHEMA_VERSION
    && Array.isArray(p.tracks) && p.settings && typeof p.settings.width === 'number' && p.assets && typeof p.assets === 'object';
  if (!ok) throw new MediaError(NOT_A_BACKUP);
  return p;
}

/**
 * Restores a backup as a new project (new ids, so it never overwrites anything). `dropped`: damaged clips and LUTs
 * and clips whose media is missing, left out.
 */
export async function importBackup(file: Blob): Promise<{ project: Project; dropped: number }> {
  const files = new Map<string, Blob>();
  const pending: Promise<void>[] = [];
  // Media is compressed already, so a re-zipped backup barely shrinks. Far more out than in is a zip bomb, which
  // would take the tab down on a phone before it ended.
  const budget = file.size * 4 + 64 * 1024 ** 2;
  let unpacked = 0;
  const unzip = new Unzip((entry) => {
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    const read = new Promise<void>((resolve, reject) => {
      entry.ondata = (err, data, final) => {
        if (err) { reject(err); return; }
        unpacked += data.length;
        if (unpacked > budget) return; // the reader stops after this chunk
        chunks.push(data as Uint8Array<ArrayBuffer>);
        if (final) { files.set(entry.name, new Blob(chunks)); resolve(); }
      };
      // An entry it cannot read throws here, inside the zip reader, where nothing would catch it: the restore hung.
      try { entry.start(); } catch (e) { reject(e as Error); }
    });
    read.catch(() => undefined); // awaited below; not an unhandled rejection meanwhile
    pending.push(read);
  });
  unzip.register(UnzipPassThrough);
  unzip.register(UnzipInflate); // a backup re-zipped by Finder, Files or Windows is deflated
  try {
    const reader = file.stream().getReader();
    for (;;) {
      const { value, done } = await reader.read();
      if (done) { unzip.push(new Uint8Array(0), true); break; }
      unzip.push(value);
      if (unpacked > budget) { await reader.cancel(); throw new Error(`unpacks to over ${budget} bytes`); }
    }
    await Promise.all(pending);
  } catch (e) {
    console.warn('backup: the zip cannot be read', e);
    throw new MediaError(NOT_A_BACKUP);
  }
  const json = files.get('project.json');
  if (!json) throw new MediaError(NOT_A_BACKUP);
  let data: unknown;
  try {
    data = JSON.parse(strFromU8(new Uint8Array(await json.arrayBuffer())));
  } catch (e) {
    console.warn('backup: project.json cannot be read', e);
    throw new MediaError('The backup is damaged: its project cannot be read');
  }
  const p = validate(data);
  const damaged = repairBackup(p);
  const clipsIn = (q: Project) => q.tracks.reduce((n, t) => n + t.clips.length, 0), kept = clipsIn(p);
  const ids = new Map<string, string>();
  const idFor = (old: string) => { if (!ids.has(old)) ids.set(old, uid()); return ids.get(old)!; };
  remapAssets(p, idFor);
  for (const f of Object.values(p.fonts ?? {})) f.blobId = idFor(f.blobId);
  // Room for all of it is checked first, and a restore that fails halfway takes its files back (docs/12 stage 3).
  await ensureRoom([...ids.keys()].reduce((n, old) => n + (files.get(`media/${old}`)?.size ?? 0), 0), p.name);
  const written: string[] = [];
  try {
    for (const [old, id] of ids) {
      const blob = files.get(`media/${old}`);
      if (blob) { await putBlob(id, new Blob([blob], { type: p.assets[id]?.mime ?? '' })); written.push(id); }
      else delete p.assets[id];
    }
  } catch (e) {
    await Promise.all(written.map((id) => deleteBlob(id).catch(() => undefined)));
    throw e;
  }
  const restored: Project = { ...p, id: uid(), name: `${p.name} (restored)`, updatedAt: Date.now() };
  normalizeProject(restored); // drops clips whose media is not in the backup
  await saveProject(restored);
  return { project: restored, dropped: damaged + kept - clipsIn(restored) };
}
