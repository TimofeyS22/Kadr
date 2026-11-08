import { Zip, ZipPassThrough, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { ZipError, zipEntries, zipEntryBlob } from './zipread';

/** A zip made as a Kadr backup is: streamed, each entry with a data descriptor after its bytes. */
function streamed(entries: Record<string, Uint8Array>): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, data, final) => { if (err) reject(err); else { parts.push(data); if (final) resolve(new Blob(parts as BlobPart[])); } });
    for (const [name, bytes] of Object.entries(entries)) {
      const e = new ZipPassThrough(name);
      zip.add(e);
      for (let i = 0; i < bytes.length; i += 65536) e.push(bytes.subarray(i, i + 65536), i + 65536 >= bytes.length);
    }
    zip.end();
  });
}

/** Random bytes with the zip signatures that cut a streamed reader short planted in the middle. */
function video(n: number): Uint8Array {
  const b = new Uint8Array(n);
  for (let i = 0; i < n; i++) b[i] = (i * 2654435761) >>> 24;
  b.set([0x50, 0x4b, 0x07, 0x08], n >> 2);
  b.set([0x50, 0x4b, 0x01, 0x02], n >> 1);
  b.set([0x50, 0x4b, 0x03, 0x04], (3 * n) >> 2);
  return b;
}

async function readAll(file: Blob, left = 1e9) {
  const out: Record<string, Uint8Array> = {};
  const budget = { left };
  for (const e of await zipEntries(file)) out[e.name] = new Uint8Array(await (await zipEntryBlob(file, e, budget)).arrayBuffer());
  return out;
}

describe('zip by its central directory (audit V-188)', () => {
  it('a backup whose video holds zip signatures comes back whole', async () => {
    const media = video(1_000_000);
    const json = new TextEncoder().encode('{"version":1}');
    const got = await readAll(await streamed({ 'project.json': json, 'media/a': media }));
    expect(got['project.json']).toEqual(json);
    expect(got['media/a'].length).toBe(media.length);
    expect(Buffer.compare(got['media/a'], media), 'the same bytes').toBe(0);
  });

  it('a stored entry is a slice of the file: nothing is copied', async () => {
    const file = await streamed({ 'media/a': video(100_000) });
    const [e] = await zipEntries(file);
    const b = await zipEntryBlob(file, e, { left: 0 }); // no budget needed
    expect(b.size).toBe(100_000);
  });

  it('a re-zipped (deflated) backup reads, within its budget', async () => {
    const media = video(200_000), json = new TextEncoder().encode('{"x":1}'.repeat(1000));
    const file = new Blob([zipSync({ 'project.json': json, 'media/a': media }, { level: 6 }) as BlobPart]);
    const got = await readAll(file);
    expect(Buffer.compare(got['media/a'], media)).toBe(0);
    expect(got['project.json']).toEqual(json);
  });

  it('a zip bomb is refused before it is unpacked', async () => {
    const file = new Blob([zipSync({ 'project.json': new Uint8Array(50 * 1024 ** 2).fill(32) }, { level: 9 }) as BlobPart]);
    const [e] = await zipEntries(file);
    await expect(zipEntryBlob(file, e, { left: file.size * 4 })).rejects.toBeInstanceOf(ZipError);
  });

  it('garbage and a file cut short are not zips', async () => {
    await expect(zipEntries(new Blob([video(10_000) as BlobPart]))).rejects.toBeInstanceOf(ZipError);
    const whole = await streamed({ 'media/a': video(50_000) });
    await expect(zipEntries(whole.slice(0, whole.size - 30))).rejects.toBeInstanceOf(ZipError);
  });

  it('reads ZIP64 sizes and offsets (Finder writes them past 4 GB)', async () => {
    // One stored entry, every size and offset in the ZIP64 records.
    const data = video(1000), name = new TextEncoder().encode('media/a');
    const bytes: number[] = [];
    const w16 = (v: number) => bytes.push(v & 255, (v >> 8) & 255);
    const w32 = (v: number) => { w16(v & 0xffff); w16((v >>> 16) & 0xffff); };
    const w64 = (v: number) => { w32(v % 2 ** 32); w32(Math.floor(v / 2 ** 32)); };
    w32(0x04034b50); w16(45); w16(0); w16(0); w16(0); w16(0); w32(0); w32(0xffffffff); w32(0xffffffff); w16(name.length); w16(20);
    bytes.push(...name); w16(1); w16(16); w64(data.length); w64(data.length);
    bytes.push(...data);
    const cd = bytes.length;
    w32(0x02014b50); w16(45); w16(45); w16(0); w16(0); w16(0); w16(0); w32(0); w32(0xffffffff); w32(0xffffffff);
    w16(name.length); w16(28); w16(0); w16(0); w16(0); w32(0); w32(0xffffffff);
    bytes.push(...name); w16(1); w16(24); w64(data.length); w64(data.length); w64(0);
    const cdSize = bytes.length - cd, end64 = bytes.length;
    w32(0x06064b50); w64(44); w16(45); w16(45); w32(0); w32(0); w64(1); w64(1); w64(cdSize); w64(cd);
    w32(0x07064b50); w32(0); w64(end64); w32(1);
    w32(0x06054b50); w16(0); w16(0); w16(0xffff); w16(0xffff); w32(0xffffffff); w32(0xffffffff); w16(0);
    const got = await readAll(new Blob([new Uint8Array(bytes)]));
    expect(got['media/a']).toEqual(data);
  });
});
