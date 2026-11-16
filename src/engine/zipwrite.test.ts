// The backup's zip writer (SW-A-10) where 32 bits hold: the same bytes fflate's streaming Zip wrote before it, so a
// backup under 4 GiB is the file every version of Kadr reads; the count of entries at its 16-bit edge.
import { Zip, ZipPassThrough } from 'fflate';
import { describe, expect, it } from 'vitest';
import { crc32 } from './crc32';
import { zipEntries, zipEntryBlob } from './zipread';
import { ZipWriter } from './zipwrite';

const WHEN = new Date(2026, 10, 16, 4, 31, 18);

/** Random-looking bytes with zip signatures planted inside, as a video may have (audit V-188). */
function bytes(n: number, seed = 1): Uint8Array<ArrayBuffer> {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = ((i + seed) * 2654435761) >>> 24;
  if (n > 16) b.set([0x50, 0x4b, 0x07, 0x08], n >> 1);
  return b;
}

/** Pieces of a few sizes, the last one short: how a file stream hands a file over. */
function split(b: Uint8Array<ArrayBuffer>, size = 65_537): Uint8Array<ArrayBuffer>[] {
  const out: Uint8Array<ArrayBuffer>[] = [];
  for (let i = 0; i < b.length; i += size) out.push(b.subarray(i, i + size));
  return out;
}

const ENTRIES: [string, Uint8Array<ArrayBuffer>][] = [
  ['project.json', new TextEncoder().encode('{"version":1,"name":"Поездка"}')],
  ['media/a', bytes(300_001)],
  ['media/empty', new Uint8Array(0)],
  ['media/фото', bytes(70_000, 7)], // a name that is not ASCII: the UTF-8 flag
  ['media/b', bytes(1)],
];

async function written(entries: [string, Uint8Array<ArrayBuffer>][]): Promise<Uint8Array<ArrayBuffer>> {
  const parts: Uint8Array[] = [];
  const zip = new ZipWriter((d) => { parts.push(d); }, WHEN);
  for (const [name, data] of entries) await zip.add(name, data.length, (async function* () { yield* split(data); })());
  await zip.end();
  return new Uint8Array(await new Blob(parts as BlobPart[]).arrayBuffer());
}

function byFflate(entries: [string, Uint8Array<ArrayBuffer>][]): Promise<Uint8Array<ArrayBuffer>> {
  return new Promise((resolve, reject) => {
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, data, final) => {
      if (err) { reject(err); return; }
      parts.push(data);
      if (final) void new Blob(parts as BlobPart[]).arrayBuffer().then((b) => resolve(new Uint8Array(b)));
    });
    for (const [name, data] of entries) {
      const e = new ZipPassThrough(name);
      e.mtime = WHEN;
      zip.add(e);
      const pieces = split(data);
      if (!pieces.length) e.push(new Uint8Array(0), true);
      pieces.forEach((p, i) => e.push(p, i === pieces.length - 1));
    }
    zip.end();
  });
}

describe('the backup zip under 4 GiB (SW-A-10)', () => {
  it('is byte for byte what fflate wrote: older Kadr and other tools read it as before', async () => {
    const mine = await written(ENTRIES), theirs = await byFflate(ENTRIES);
    expect(mine.length).toBe(theirs.length);
    expect(Buffer.compare(mine, theirs), 'the same bytes').toBe(0);
  });

  it('reads back whole through zipread, every entry where it was written', async () => {
    const file = new Blob([await written(ENTRIES)]);
    const got = await zipEntries(file);
    expect(got.map((e) => e.name)).toEqual(ENTRIES.map(([n]) => n));
    for (const [k, e] of got.entries()) {
      const data = new Uint8Array(await (await zipEntryBlob(file, e, { left: 0 })).arrayBuffer());
      expect(Buffer.compare(data, ENTRIES[k][1]), e.name).toBe(0);
    }
  });

  it('checksums as zlib does', () => {
    expect(crc32(0, new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const b = bytes(1001);
    expect(crc32(crc32(0, b.subarray(0, 13)), b.subarray(13))).toBe(crc32(0, b));
  });

  it('refuses pieces that do not add up to the size the entry was written for', async () => {
    const zip = new ZipWriter(() => undefined, WHEN);
    await expect(zip.add('media/a', 10, [new Uint8Array(9)])).rejects.toThrow(/gave 9 bytes, not 10/);
    await expect(new ZipWriter(() => undefined, WHEN).add('media/a', 10, [new Uint8Array(11)])).rejects.toThrow(/gave 11 bytes/);
  });
});

describe('the count of entries at its 16-bit edge (SW-A-10)', () => {
  /** A zip of `n` one-byte entries and what its end record says. */
  async function many(n: number) {
    const parts: Uint8Array[] = [];
    const zip = new ZipWriter((d) => { parts.push(d); }, WHEN);
    const one = new Uint8Array([7]);
    for (let i = 0; i < n; i++) await zip.add(`media/${i}`, 1, [one]);
    await zip.end();
    const file = new Blob(parts as BlobPart[]);
    const end = new DataView(await file.slice(file.size - 22).arrayBuffer());
    const zip64 = new DataView(await file.slice(file.size - 22 - 20, file.size - 22).arrayBuffer()).getUint32(0, true) === 0x07064b50;
    return { file, count16: end.getUint16(10, true), zip64 };
  }

  it('65 534 entries: the end record holds the count, no ZIP64', async () => {
    const { file, count16, zip64 } = await many(0xfffe);
    expect([count16, zip64]).toEqual([0xfffe, false]);
    expect((await zipEntries(file)).length).toBe(0xfffe);
  }, 60_000);

  it('65 535 entries (0xffff is the "see ZIP64" mark): the count is in the ZIP64 record', async () => {
    const { file, count16, zip64 } = await many(0xffff);
    expect([count16, zip64]).toEqual([0xffff, true]);
    const entries = await zipEntries(file);
    expect(entries.length).toBe(0xffff);
    expect(entries.at(-1)?.name).toBe(`media/${0xffff - 1}`);
  }, 60_000);

  it('70 000 entries all come back, the last one with its byte', async () => {
    const { file, count16, zip64 } = await many(70_000);
    expect([count16, zip64]).toEqual([0xffff, true]);
    const entries = await zipEntries(file);
    expect(entries.length).toBe(70_000);
    const last = entries.at(-1)!;
    expect(last.name).toBe('media/69999');
    expect([...new Uint8Array(await (await zipEntryBlob(file, last, { left: 0 })).arrayBuffer())]).toEqual([7]);
  }, 60_000);
});
