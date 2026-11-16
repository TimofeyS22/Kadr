// Project backup: a stored (uncompressed) zip with project.json and media/<assetId>, streamed (zipwrite.ts, ZIP64 past
// 4 GiB: SW-A-10).
import { strFromU8 } from 'fflate';
import { uid } from '../core/defaults';
import { repairBackup } from '../core/restore';
import { normalizeProject, remapAssets, withUsedAssets } from '../core/timeline';
import { SCHEMA_VERSION, type Project } from '../core/types';
import { deleteBlob, openMedia, putBlob, saveProject } from '../storage/db';
import type { StoredMedia } from '../storage/chunks';
import { ensureRoom } from './importer';
import { MediaError } from './media';
import { diskFile } from './opfs';
import { within } from '../lib/limits';
import { zipEntries, zipEntryBlob, type ZipEntry } from './zipread';
import { ZipWriter } from './zipwrite';

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
  // Each piece is on the disk before the next is read: at most one piece of media is in memory at a time.
  const zip = new ZipWriter(disk ? (data) => disk.writable.write(data) : (data) => parts.push(data));
  try {
    const missing = await addEntries(zip, p, onProgress);
    if (!disk) return { blob: new Blob(parts, { type: 'application/zip' }), missing };
    await disk.writable.close();
    return { blob: new Blob([await disk.file()], { type: 'application/zip' }), missing };
  } catch (e) {
    disk?.drop();
    throw e;
  }
}

/** A stored file's bytes, a piece at a time; the reader is let go when the zip stops early. */
async function* pieces(media: StoredMedia): AsyncGenerator<Uint8Array<ArrayBuffer>> {
  if (!(media instanceof Blob)) {
    // Kept in chunks: read as it is zipped, not put together into a Blob first (audit V-253).
    for (let at = 0; at < media.size; at += PIECE) yield await media.read(at, Math.min(media.size, at + PIECE));
    return;
  }
  const reader = media.stream().getReader();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    void reader.cancel().catch(() => undefined); // a no-op after the last piece; mid-file it lets the file go
  }
}

/** project.json and every media file and font, read and zipped piece by piece. */
async function addEntries(zip: ZipWriter, whole: Project, onProgress?: (f: number) => void): Promise<number> {
  const p = withUsedAssets(whole); // what the user deleted from the project stays out of its copies (audit V-126)
  const json = new TextEncoder().encode(JSON.stringify(p));
  await zip.add('project.json', json.length, [json]);
  const ids = [...Object.keys(p.assets), ...Object.values(p.fonts ?? {}).map((f) => f.blobId)]; // media and the user's fonts
  let missing = 0;
  for (let i = 0; i < ids.length; i++) {
    const media = await openMedia(ids[i]);
    if (!media) { missing++; continue; } // told to the person now, not on the day the copy is needed (audit V-236)
    await zip.add(`media/${ids[i]}`, media.size, pieces(media));
    onProgress?.((i + 1) / ids.length);
  }
  await zip.end();
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
