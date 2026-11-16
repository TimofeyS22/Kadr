// The backup's zip writer (SW-A-10) at the 32-bit edges of sizes and offsets: an entry of exactly 0xffffffff bytes
// (the "see ZIP64" mark) and one byte less, an entry that starts exactly at 0xffffffff and one byte before, a central
// directory past 4 GiB. Read back by zipread.ts, as a restore reads them.
//
// The media are zeros from one shared buffer and the "disk" keeps only what is not media, so 4 GiB entries need no
// memory. The checksum is a constant here: these tests move sizes and offsets only, and checksumming 16 GiB would take
// minutes. The real checksum is checked in zipwrite.test.ts (the same bytes as fflate) and backup.zip64.test.ts.
import { describe, expect, it, vi } from 'vitest';

const CRC = 0x1234abcd;
vi.mock('./crc32', () => ({ crc32: () => 0x1234abcd }));

import { zipEntries, zipEntryBlob } from './zipread';
import { ZipWriter } from './zipwrite';

const MAX32 = 0xffffffff;
const PIECE = 16 * 1024 * 1024;
const ZERO = new Uint8Array(PIECE);

/** A zip written to a "disk" that keeps headers and counts media zeros, and the file it makes, read like a Blob. */
async function write(entries: [string, number | Uint8Array<ArrayBuffer>][]): Promise<Blob> {
  const parts: { at: number; part: Uint8Array | number }[] = [];
  let size = 0;
  const zip = new ZipWriter((d) => {
    parts.push({ at: size, part: d.buffer === ZERO.buffer ? d.length : d.slice() });
    size += d.length;
  });
  for (const [name, data] of entries) {
    if (typeof data !== 'number') { await zip.add(name, data.length, [data]); continue; }
    await zip.add(name, data, (function* () { for (let at = 0; at < data; at += PIECE) yield ZERO.subarray(0, Math.min(PIECE, data - at)); })());
  }
  await zip.end();
  const read = (from: number, to: number) => {
    const out = new Uint8Array(to - from);
    for (const { at, part } of parts) {
      if (typeof part === 'number' || at + part.length <= from || at >= to) continue;
      const a = Math.max(from, at), b = Math.min(to, at + part.length);
      out.set(part.subarray(a - at, b - at), a - from);
    }
    return out;
  };
  const slice = (from = 0, to = size): Blob => {
    const a = Math.max(0, Math.min(size, from)), b = Math.max(a, Math.min(size, to));
    return { size: b - a, slice: (x = 0, y = b - a) => slice(a + x, a + Math.min(y, b - a)), arrayBuffer: async () => read(a, b).buffer } as unknown as Blob;
  };
  return slice();
}

const view = async (file: Blob, from: number, length: number) => new DataView(await file.slice(from, from + length).arrayBuffer());
const u64 = (v: DataView, o: number) => v.getUint32(o + 4, true) * 2 ** 32 + v.getUint32(o, true);
const tail = new Uint8Array([1, 2, 3]);

/** The central directory record of entry `k`: its version needed, size fields, offset field and extra length. */
async function central(file: Blob, k: number) {
  let at = (await view(file, file.size - 22, 22)).getUint32(16, true);
  if (at === MAX32) { // the locator before the end record says where the ZIP64 end record is; that one holds the offset
    const locator = await view(file, file.size - 22 - 20, 20);
    at = u64(await view(file, u64(locator, 8), 56), 48);
  }
  for (let i = 0; ; i++) {
    const r = await view(file, at, 46);
    const len = 46 + r.getUint16(28, true) + r.getUint16(30, true) + r.getUint16(32, true);
    if (i === k) return { needs: r.getUint16(6, true), crc: r.getUint32(16, true), size: r.getUint32(24, true), offset: r.getUint32(42, true), extra: r.getUint16(30, true) };
    at += len;
  }
}

async function readsBack(file: Blob) {
  const entries = await zipEntries(file);
  const last = entries.at(-1)!;
  expect([...new Uint8Array(await (await zipEntryBlob(file, last, { left: 0 })).arrayBuffer())], 'the entry after the big one').toEqual([...tail]);
  return entries;
}

describe('ZIP64 at the 32-bit edge of a size (SW-A-10)', () => {
  it('an entry of exactly 0xffffffff bytes is written as ZIP64, and what follows it reads', async () => {
    const file = await write([['media/a', MAX32], ['media/b', tail]]);
    const [a, b] = await readsBack(file);
    expect([a.size, a.compressed, a.offset]).toEqual([MAX32, MAX32, 0]);
    expect(b.offset).toBe(30 + 7 + 20 + MAX32 + 24); // header with its ZIP64 field, the data, a 24-byte descriptor
    // The local header: version 4.5, sizes 0xffffffff, the ZIP64 field with both sizes (zero: they follow the data).
    const local = await view(file, 0, 30 + 7 + 20);
    expect([local.getUint16(4, true), local.getUint16(6, true) & 8, local.getUint32(18, true), local.getUint32(22, true), local.getUint16(28, true)]).toEqual([45, 8, MAX32, MAX32, 20]);
    expect([local.getUint16(37, true), local.getUint16(39, true)]).toEqual([1, 16]);
    // The descriptor after the data: checksum and both sizes in 64 bits.
    const desc = await view(file, 57 + MAX32, 24);
    expect([desc.getUint32(0, true), desc.getUint32(4, true), u64(desc, 8), u64(desc, 16)]).toEqual([0x08074b50, CRC, MAX32, MAX32]);
    const ca = await central(file, 0);
    expect(ca).toEqual({ needs: 45, crc: CRC, size: MAX32, offset: 0, extra: 20 });
  }, 120_000);

  it('the control: 0xfffffffe bytes fit 32 bits and are written as before; only the next offset is ZIP64', async () => {
    const file = await write([['media/a', MAX32 - 1], ['media/b', tail]]);
    const [a, b] = await readsBack(file);
    expect([a.size, a.compressed]).toEqual([MAX32 - 1, MAX32 - 1]);
    expect(b.offset).toBe(30 + 7 + MAX32 - 1 + 16);
    const local = await view(file, 0, 30);
    expect([local.getUint16(4, true), local.getUint32(22, true), local.getUint16(28, true)]).toEqual([20, 0, 0]);
    expect(await central(file, 0)).toEqual({ needs: 20, crc: CRC, size: MAX32 - 1, offset: 0, extra: 0 });
    expect(await central(file, 1)).toEqual({ needs: 45, crc: CRC, size: 3, offset: MAX32, extra: 12 });
  }, 120_000);
});

describe('ZIP64 at the 32-bit edge of an offset (SW-A-10)', () => {
  // media/a: a 37-byte header, its data, a 16-byte descriptor; media/b starts right after.
  it('an entry that starts exactly at 0xffffffff has its offset in ZIP64', async () => {
    const file = await write([['media/a', MAX32 - 37 - 16], ['media/b', tail]]);
    const [, b] = await readsBack(file);
    expect(b.offset).toBe(MAX32);
    expect(await central(file, 1)).toEqual({ needs: 45, crc: CRC, size: 3, offset: MAX32, extra: 12 });
  }, 120_000);

  it('the control: one byte before, the offset fits 32 bits; the directory after it is past 4 GiB (ZIP64 end)', async () => {
    const file = await write([['media/a', MAX32 - 37 - 16 - 1], ['media/b', tail]]);
    const [, b] = await readsBack(file);
    expect(b.offset).toBe(MAX32 - 1);
    expect(await central(file, 1)).toEqual({ needs: 20, crc: CRC, size: 3, offset: MAX32 - 1, extra: 0 });
    const end = await view(file, file.size - 22, 22);
    expect(end.getUint32(16, true), 'the directory starts past 0xffffffff: the end record points to ZIP64').toBe(MAX32);
    expect(end.getUint16(10, true), 'the count fits').toBe(2);
  }, 120_000);

  it('a file under 4 GiB has no ZIP64 record at all', async () => {
    const file = await write([['project.json', new TextEncoder().encode('{}')], ['media/a', 3 * PIECE + 5], ['media/b', tail]]);
    await readsBack(file);
    const locator = await view(file, file.size - 22 - 20, 4);
    expect(locator.getUint32(0, true)).not.toBe(0x07064b50);
    for (let k = 0; k < 3; k++) expect((await central(file, k)).needs).toBe(20);
  });
});
