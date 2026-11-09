// Project backup: a stored (uncompressed) zip with project.json and media/<assetId>, streamed with fflate.
import { Zip, ZipPassThrough, strFromU8, strToU8 } from 'fflate';
import { uid } from '../core/defaults';
import { repairBackup } from '../core/restore';
import { normalizeProject, remapAssets, withUsedAssets } from '../core/timeline';
import { SCHEMA_VERSION, type Project } from '../core/types';
import { deleteBlob, openMedia, putBlob, saveProject } from '../storage/db';
import { ensureRoom } from './importer';
import { MediaError } from './media';
import { diskFile } from './opfs';
import { within } from '../lib/limits';
import { zipEntries, zipEntryBlob, type ZipEntry } from './zipread';

/** The file system gets this long to open the backup file; then the backup is made in memory. */
const DISK_MS = 5000;
/** A file kept in chunks (a private tab) goes into the zip in pieces of this size. */
const PIECE = 1024 * 1024;

/**
 * The backup streams to a file in the origin-private file system where there is one (docs/12 P2): a project with
 * a gigabyte of media does not fit in a phone's memory twice over. Elsewhere it is made in memory as before.
 */
export async function exportBackup(p: Project, onProgress?: (f: number) => void): Promise<{ blob: Blob; missing: number }> {
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
    const missing = await addEntries(zip, p, () => writing, onProgress);
    await done;
    if (!disk) return { blob: new Blob(parts, { type: 'application/zip' }), missing };
    await writing;
    await disk.writable.close();
    return { blob: new Blob([await disk.file()], { type: 'application/zip' }), missing };
  } catch (e) {
    disk?.drop();
    throw e;
  }
}

/** project.json and every media file and font, read and zipped piece by piece; `written` waits for the disk. */
async function addEntries(zip: Zip, whole: Project, written: () => Promise<void>, onProgress?: (f: number) => void): Promise<number> {
  const p = withUsedAssets(whole); // what the user deleted from the project stays out of its copies (audit V-126)
  const meta = new ZipPassThrough('project.json');
  zip.add(meta);
  meta.push(strToU8(JSON.stringify(p)), true);
  const ids = [...Object.keys(p.assets), ...Object.values(p.fonts ?? {}).map((f) => f.blobId)]; // media and the user's fonts
  let missing = 0;
  for (let i = 0; i < ids.length; i++) {
    const media = await openMedia(ids[i]);
    if (!media) { missing++; continue; } // told to the person now, not on the day the copy is needed (audit V-236)
    const entry = new ZipPassThrough(`media/${ids[i]}`);
    zip.add(entry);
    if (media instanceof Blob) {
      const reader = media.stream().getReader();
      for (;;) {
        const { value, done: end } = await reader.read();
        if (end) break;
        entry.push(value);
        await written(); // the disk keeps up: at most one piece of media is in memory at a time
      }
    } else {
      // Kept in chunks: read as it is zipped, not put together into a Blob first (audit V-253).
      for (let at = 0; at < media.size; at += PIECE) {
        entry.push(await media.read(at, Math.min(media.size, at + PIECE)));
        await written();
      }
    }
    entry.push(new Uint8Array(0), true);
    onProgress?.((i + 1) / ids.length);
  }
  zip.end();
  return missing;
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
  // Read by the zip's central directory (zipread.ts): stored media are slices of the file, nothing is copied, and a
  // video that contains a zip signature comes back whole (audit V-188). Media compress poorly, so far more out than
  // in is a zip bomb, which would take the tab down on a phone.
  const budget = { left: file.size * 4 + 64 * 1024 ** 2 };
  const files = new Map<string, Blob>();
  let entries: ZipEntry[];
  try {
    entries = await zipEntries(file);
  } catch (e) {
    console.warn('backup: the zip cannot be read', e);
    throw new MediaError(NOT_A_BACKUP);
  }
  for (const e of entries) {
    const wanted = e.name === 'project.json' || (e.name.startsWith('media/') && !e.name.endsWith('/'));
    if (!wanted || files.has(e.name)) continue; // Finder's __MACOSX and the like
    try {
      files.set(e.name, await zipEntryBlob(file, e, budget));
    } catch (err) {
      console.warn('backup: an entry cannot be read', e.name, err);
      // A damaged media file is left out and counted (its clips go); a project that cannot be read is no backup.
      if (e.name === 'project.json') throw new MediaError(NOT_A_BACKUP);
    }
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
