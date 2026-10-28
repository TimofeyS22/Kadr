// Files streamed to the origin-private file system (OPFS): an export or a backup goes to disk as it is made instead
// of piling up in memory, where a long one does not fit on a phone (docs/12 P2).

export interface DiskFile {
  writable: FileSystemWritableFileStream;
  /** The finished file, read from disk (call after the writable is closed). */
  file: () => Promise<File>;
  /** Gives up the file: its lock goes and nothing more is written. */
  drop: () => void;
}

/**
 * A new file `<prefix>-<time>.<ext>`, or null where the file system cannot be had (private mode, older browsers).
 * Earlier files with the prefix go first: one export or backup at a time is kept.
 */
export async function diskFile(prefix: string, ext: string): Promise<DiskFile | null> {
  try {
    const root = await navigator.storage.getDirectory();
    for await (const name of root.keys()) if (name.startsWith(`${prefix}-`)) await root.removeEntry(name).catch(() => undefined);
    const handle = await root.getFileHandle(`${prefix}-${Date.now()}.${ext}`, { create: true });
    if (!('createWritable' in handle)) return null;
    const writable = await handle.createWritable();
    // Some WebKit contexts open the stream but fail on the first write: probe before committing to it.
    await writable.write(new Uint8Array(1));
    await writable.truncate(0);
    return { writable, file: () => handle.getFile(), drop: () => void writable.abort().catch(() => undefined) };
  } catch {
    return null;
  }
}
