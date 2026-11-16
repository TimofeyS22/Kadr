// A finished export the person has not saved yet, kept across a reload (SW-A-15). On an iPhone Safari takes a page
// back while the person looks at another app, as often as not right after a long export, and the file was known only
// to the export sheet in the page's memory: the editor opened as if nothing had been made, and the person exported
// again, for minutes. Now a note says which project the file is of and where it lies — in the origin-private file
// system where the export streamed it, else in the media store (WebKit without createWritable, a private tab) — and
// opening that project offers the file again. Saving it, letting the sheet go or a new export drops the note.
import { deleteBlob, getBlob, putBlob } from '../storage/db';
import type { ExportResult } from './exporter';

const NOTE = 'kadr.keptExport';
/** The id the file is kept under in the media store where it did not go to disk (orphan collection may take it). */
const STORED = 'kept-export';

interface Note {
  project: string; disk?: string; fileName: string; type: string; seconds: number; noSound?: boolean; extra?: unknown;
}
export interface Kept<X> { result: ExportResult; extra: X | undefined }

/** Bumped by every keep and drop: a keep still storing when the file was saved or replaced writes no note. */
let generation = 0;
let found: { project: string; kept: Kept<unknown> } | null = null;

function read(): Note | null {
  try {
    const n = JSON.parse(localStorage.getItem(NOTE) ?? 'null') as Note | null;
    return n && typeof n.project === 'string' && typeof n.fileName === 'string' ? n : null;
  } catch {
    return null;
  }
}

/** Keeps a finished file of `project` until it is saved or let go; `extra` comes back with it (what the sheet shows). */
export async function keepExport(project: string, result: ExportResult, extra: unknown): Promise<void> {
  const mine = ++generation;
  const note: Note = { project, disk: result.disk, fileName: result.fileName, type: result.blob.type, seconds: result.seconds, noSound: result.noSound, extra };
  try {
    if (!result.disk) await putBlob(STORED, result.blob);
    if (mine !== generation) { if (!result.disk) await deleteBlob(STORED); return; }
    localStorage.setItem(NOTE, JSON.stringify(note));
  } catch (e) {
    console.warn('the finished export is not kept for a reload', e);
  }
}

/** The note and a stored copy go: the file was saved, the sheet let it go, or another export is being made. */
export function dropKeptExport(): void {
  generation++;
  found = null;
  const note = read();
  try { localStorage.removeItem(NOTE); } catch { /* nothing kept */ }
  if (note && !note.disk) void deleteBlob(STORED).catch(() => undefined);
}

async function fromDisk(name: string): Promise<Blob | undefined> {
  try {
    return await (await (await navigator.storage.getDirectory()).getFileHandle(name)).getFile();
  } catch {
    return undefined; // gone with the project, or by another export
  }
}

/** On opening a project: whether a file of it is kept; if so it is read back and held for the export sheet. */
export async function findKeptExport(project: string): Promise<boolean> {
  const note = read();
  if (!note || note.project !== project) return false;
  const blob = note.disk ? await fromDisk(note.disk) : await getBlob(STORED).catch(() => undefined);
  if (!blob?.size) { dropKeptExport(); return false; }
  found = {
    project,
    kept: {
      result: { blob: new Blob([blob], { type: note.type }), disk: note.disk, fileName: note.fileName, seconds: note.seconds, noSound: note.noSound },
      extra: note.extra,
    },
  };
  return true;
}

/**
 * The kept file of this project for its export sheet. Read, not taken: the sheet is drawn under Suspense, and a first
 * draw thrown away while its code loads starts its state again (seen on Chromium: the sheet opened empty). It goes
 * with `dropKeptExport`.
 */
export function keptExportOf<X>(project: string): Kept<X> | null {
  return found && found.project === project ? (found.kept as Kept<X>) : null;
}
