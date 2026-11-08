// Reads a zip by its central directory, where every entry's exact size and place are written (audit V-188).
// A streaming reader does not know the size of an entry written with a data descriptor (as Kadr's backups are): it
// looked for the next signature in the entry's bytes, so a video that happened to contain "PK\x07\x08" or "PK\x01\x02"
// came back cut in half, with no error. Here stored entries are slices of the file (nothing is copied into memory)
// and deflated ones (a backup re-zipped by Finder, Files or Windows) are inflated within a budget.
import { Inflate } from 'fflate';

export interface ZipEntry {
  name: string;
  /** 0 stored, 8 deflated. */
  method: number;
  compressed: number;
  size: number;
  /** Where the entry's local header starts. */
  offset: number;
}

/** A file that is not a whole zip, or an entry that cannot be read as the directory says. */
export class ZipError extends Error {}

const u16 = (v: DataView, o: number) => v.getUint16(o, true);
const u32 = (v: DataView, o: number) => v.getUint32(o, true);
const u64 = (v: DataView, o: number) => v.getUint32(o + 4, true) * 2 ** 32 + v.getUint32(o, true);

async function view(file: Blob, from: number, to: number): Promise<DataView> {
  if (from < 0 || to > file.size || to < from) throw new ZipError('outside the file');
  return new DataView(await file.slice(from, to).arrayBuffer());
}

const END = 0x06054b50, END64 = 0x06064b50, LOCATOR64 = 0x07064b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** The entries the central directory lists. Throws ZipError when there is no readable directory. */
export async function zipEntries(file: Blob): Promise<ZipEntry[]> {
  const tailFrom = Math.max(0, file.size - (22 + 0xffff)); // the end record, then a comment of at most 64 KiB
  const tail = await view(file, tailFrom, file.size);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (u32(tail, i) === END) { end = i; break; }
  if (end < 0) throw new ZipError('no end of central directory');
  let count = u16(tail, end + 10), size = u32(tail, end + 12), offset = u32(tail, end + 16);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const loc = end - 20; // ZIP64: its locator is right before the end record
    if (loc < 0 || u32(tail, loc) !== LOCATOR64) throw new ZipError('ZIP64 locator missing');
    const at = u64(tail, loc + 8);
    const rec = await view(file, at, at + 56);
    if (u32(rec, 0) !== END64) throw new ZipError('ZIP64 end record missing');
    count = u64(rec, 32);
    size = u64(rec, 40);
    offset = u64(rec, 48);
  }
  const cd = await view(file, offset, offset + size);
  const names = new TextDecoder();
  const out: ZipEntry[] = [];
  let p = 0;
  for (let k = 0; k < count; k++) {
    if (p + 46 > cd.byteLength || u32(cd, p) !== CENTRAL) throw new ZipError('central directory damaged');
    const nameLen = u16(cd, p + 28), extraLen = u16(cd, p + 30), commentLen = u16(cd, p + 32);
    if (p + 46 + nameLen + extraLen > cd.byteLength) throw new ZipError('central directory damaged');
    const e: ZipEntry = {
      name: names.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)),
      method: u16(cd, p + 10), compressed: u32(cd, p + 20), size: u32(cd, p + 24), offset: u32(cd, p + 42),
    };
    // ZIP64 extra field: the 64-bit values, in this order, of the fields that read 0xffffffff.
    for (let x = p + 46 + nameLen, xEnd = x + extraLen; x + 4 <= xEnd; x += 4 + u16(cd, x + 2)) {
      if (u16(cd, x) !== 0x0001) continue;
      let q = x + 4;
      if (e.size === 0xffffffff) { e.size = u64(cd, q); q += 8; }
      if (e.compressed === 0xffffffff) { e.compressed = u64(cd, q); q += 8; }
      if (e.offset === 0xffffffff) e.offset = u64(cd, q);
    }
    out.push(e);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

/**
 * An entry's bytes: a slice of the file when stored, inflated when deflated. `budget.left`: bytes that may still be
 * inflated (a zip bomb is refused before it fills a phone's memory); stored slices cost nothing.
 */
export async function zipEntryBlob(file: Blob, e: ZipEntry, budget: { left: number }): Promise<Blob> {
  const head = await view(file, e.offset, e.offset + 30);
  if (u32(head, 0) !== LOCAL) throw new ZipError(`${e.name}: local header missing`);
  const start = e.offset + 30 + u16(head, 26) + u16(head, 28);
  const end = start + e.compressed;
  if (end > file.size) throw new ZipError(`${e.name}: cut short`);
  if (e.method === 0) {
    if (e.size !== e.compressed) throw new ZipError(`${e.name}: sizes differ`);
    return file.slice(start, end);
  }
  if (e.method !== 8) throw new ZipError(`${e.name}: compression ${e.method}`);
  if (e.size > budget.left) throw new ZipError(`${e.name}: unpacks to ${e.size} bytes`);
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let got = 0;
  const inflate = new Inflate((data) => { got += data.length; chunks.push(data as Uint8Array<ArrayBuffer>); });
  const reader = file.slice(start, end).stream().getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) { inflate.push(new Uint8Array(0), true); break; }
    inflate.push(value);
    if (got > e.size) { await reader.cancel(); break; }
  }
  if (got !== e.size) throw new ZipError(`${e.name}: unpacked ${got} bytes, the directory says ${e.size}`);
  budget.left -= got;
  return new Blob(chunks);
}
