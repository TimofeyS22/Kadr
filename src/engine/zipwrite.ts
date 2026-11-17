// A zip written as it is made, with ZIP64 where 32 bits do not hold (SW-A-10). The backup used fflate's streaming Zip,
// which has no ZIP64: every size and offset went into 32 bits modulo 2^32, and a backup past 4 GiB (two hour-long
// iPhone videos, ten minutes of 4K60) was saved without a word and refused on restore as "not a Kadr project backup".
//
// Entries are stored, not compressed (media are compressed already), each followed by a data descriptor: its checksum
// is known only once its last byte has passed. An entry of 0xffffffff bytes or more, an entry that starts at or past
// 0xffffffff, a central directory there and 0xffff entries or more take the ZIP64 records of APPNOTE 6.3.10 (§4.3.9,
// §4.3.14, §4.3.15, §4.5.3). Everything that fits is written byte for byte as fflate wrote it, so a backup under 4 GiB
// is the same file as before and reads in every version of Kadr. Read by `zipread.ts`.
import { crc32 } from './crc32';

const MAX32 = 0xffffffff;
const MAX16 = 0xffff;
const LOCAL = 0x04034b50, DESCRIPTOR = 0x08074b50, CENTRAL = 0x02014b50, END = 0x06054b50, END64 = 0x06064b50, LOCATOR64 = 0x07064b50;
/** The bit of a general purpose flag that says the checksum and sizes follow the data. */
const HAS_DESCRIPTOR = 0x0008;
/** The bit that says the name is UTF-8 (fflate sets it for a name that is not plain ASCII). */
const UTF8 = 0x0800;

/** Little-endian fields into a buffer of a known length. */
class Fields {
  readonly bytes: Uint8Array<ArrayBuffer>;
  private readonly view: DataView;
  private at = 0;
  constructor(length: number) {
    this.bytes = new Uint8Array(length);
    this.view = new DataView(this.bytes.buffer);
  }
  u16(v: number): this { this.view.setUint16(this.at, v, true); this.at += 2; return this; }
  u32(v: number): this { this.view.setUint32(this.at, v, true); this.at += 4; return this; }
  u64(v: number): this { return this.u32(v % 2 ** 32).u32(Math.floor(v / 2 ** 32)); }
  raw(b: Uint8Array): this { this.bytes.set(b, this.at); this.at += b.length; return this; }
}

/** MS-DOS time and date, as one 32-bit field (time low). Years outside what the field holds are clamped. */
function dosTime(d: Date): number {
  const year = Math.min(127, Math.max(0, d.getFullYear() - 1980));
  return ((year << 25) | ((d.getMonth() + 1) << 21) | (d.getDate() << 16) | (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) >>> 0;
}

/** The ZIP64 extended information extra field (0x0001) with `values` in the order the format fixes for them. */
function zip64Extra(values: number[]): Uint8Array {
  const f = new Fields(4 + 8 * values.length).u16(0x0001).u16(8 * values.length);
  for (const v of values) f.u64(v);
  return f.bytes;
}

/**
 * Writes a zip to `out`, one piece at a time and in order; a piece is passed on as it was given (a media piece is not
 * copied). Only the central directory, about a hundred bytes an entry, is kept until the end.
 */
export class ZipWriter {
  /** Bytes written so far: where the next record starts. */
  private at = 0;
  private readonly central: Uint8Array[] = [];
  private centralSize = 0;
  private readonly time: number;

  constructor(private readonly out: (data: Uint8Array<ArrayBuffer>) => unknown, now = new Date()) {
    this.time = dosTime(now);
  }

  /**
   * Adds a stored entry of `size` bytes, given in `pieces`. Pieces that add up to anything else are an error: the
   * format of the entry was chosen by its size before its first byte.
   */
  async add(name: string, size: number, pieces: AsyncIterable<Uint8Array<ArrayBuffer>> | Iterable<Uint8Array<ArrayBuffer>>): Promise<void> {
    const offset = this.at;
    const fn = new TextEncoder().encode(name);
    if (fn.length > MAX16) throw new Error(`A zip entry name of ${fn.length} bytes`);
    const flags = HAS_DESCRIPTOR | (fn.length !== name.length ? UTF8 : 0);
    const big = size >= MAX32;
    // The local header: checksum and sizes follow the data. A big entry says so here, with 0xffffffff and the ZIP64
    // field that the format requires in this header (§4.5.3), its sizes zero as bit 3 asks (§4.4.4).
    const localExtra = big ? zip64Extra([0, 0]) : new Uint8Array(0);
    await this.put(new Fields(30 + fn.length + localExtra.length)
      .u32(LOCAL).u16(big ? 45 : 20).u16(flags).u16(0).u32(this.time)
      .u32(0).u32(big ? MAX32 : 0).u32(big ? MAX32 : 0).u16(fn.length).u16(localExtra.length)
      .raw(fn).raw(localExtra).bytes);
    let crc = 0, got = 0;
    for await (const piece of pieces) {
      crc = crc32(crc, piece);
      got += piece.length;
      await this.put(piece);
    }
    if (got !== size) throw new Error(`The zip entry ${name} gave ${got} bytes, not ${size}`);
    // The data descriptor: sizes in 64 bits after a header with the ZIP64 field (§4.3.9.2), else as fflate wrote it.
    await this.put(big
      ? new Fields(24).u32(DESCRIPTOR).u32(crc).u64(size).u64(size).bytes
      : new Fields(16).u32(DESCRIPTOR).u32(crc).u32(size).u32(size).bytes);
    // The central directory record: what does not fit 32 bits reads 0xffffffff and is in the ZIP64 field, in the order
    // size, compressed size, offset (§4.5.3).
    const far = offset >= MAX32;
    const wide = [...(big ? [size, size] : []), ...(far ? [offset] : [])];
    const extra = wide.length ? zip64Extra(wide) : new Uint8Array(0);
    const version = wide.length ? 45 : 20;
    const record = new Fields(46 + fn.length + extra.length)
      .u32(CENTRAL).u16(version).u16(version).u16(flags).u16(0).u32(this.time)
      .u32(crc).u32(big ? MAX32 : size).u32(big ? MAX32 : size).u16(fn.length).u16(extra.length)
      .u16(0).u16(0).u16(0).u32(0).u32(far ? MAX32 : offset)
      .raw(fn).raw(extra).bytes;
    this.central.push(record);
    this.centralSize += record.length;
  }

  /** Writes the central directory and the end records. */
  async end(): Promise<void> {
    const start = this.at, count = this.central.length, size = this.centralSize;
    const zip64 = count >= MAX16 || size >= MAX32 || start >= MAX32;
    const tail = new Fields(size + (zip64 ? 56 + 20 : 0) + 22);
    for (const record of this.central) tail.raw(record);
    if (zip64) {
      // The ZIP64 end of central directory record (§4.3.14) and its locator (§4.3.15), right before the end record.
      tail.u32(END64).u64(44).u16(45).u16(45).u32(0).u32(0).u64(count).u64(count).u64(size).u64(start);
      tail.u32(LOCATOR64).u32(0).u64(start + size).u32(1);
    }
    tail.u32(END).u16(0).u16(0).u16(Math.min(count, MAX16)).u16(Math.min(count, MAX16))
      .u32(Math.min(size, MAX32)).u32(Math.min(start, MAX32)).u16(0);
    this.central.length = 0;
    await this.put(tail.bytes);
  }

  private async put(data: Uint8Array<ArrayBuffer>): Promise<void> {
    await this.out(data);
    this.at += data.length;
  }
}
