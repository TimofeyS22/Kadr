// Red team, storage (docs/13, 2026-11-14): a backup whose media add up to more than 4 GiB cannot be restored.
// The backup is written with fflate's streaming Zip, which has no ZIP64: every size and offset goes into a 32-bit field
// modulo 2^32 (fflate `wbytes`). The reader (zipread.ts) understands ZIP64, but there is none to read: the end record
// points into the middle of a video, and the restore says "This file is not a Kadr project backup". The backup itself
// is made and saved with no word. Two iPhone videos of an hour, or ten minutes of 4K60, are past 4 GiB.
//
// The media here are zeros read from one shared buffer, and the "disk" keeps only what is not media, so the test needs
// no gigabytes of memory; fflate still sees and checksums every byte. The control (a backup under 4 GiB, through the
// same fake disk and the same reader) restores, so the oracle can pass.
import { describe, expect, it, vi } from 'vitest';

const PIECE = 1024 * 1024;
const ZERO = new Uint8Array(PIECE);
const sizes = new Map<string, number>();

vi.mock('../storage/db', () => ({
  // Kept in chunks (the private-tab path): read a piece at a time, as exportBackup asks for it.
  openMedia: async (id: string) => {
    const size = sizes.get(id);
    return size === undefined ? undefined : { size, type: 'video/mp4', read: async (a: number, b: number) => ZERO.subarray(0, b - a) };
  },
  // Restoring stores a copy of each file's own bytes (SW-A-4): `putCopy`, as `putBlob` was before it.
  deleteBlob: vi.fn(), putBlob: vi.fn(), putCopy: vi.fn(), saveProject: vi.fn(),
}));
vi.mock('./importer', () => ({ ensureRoom: vi.fn() }));
vi.mock('./media', () => ({ MediaError: class extends Error {} }));

/** What reached the disk, in order: bytes as written, or a run of media zeros (`number`) that is not kept. */
let written: (Uint8Array | number)[] = [];
vi.mock('./opfs', () => ({
  diskFile: async () => ({
    writable: {
      write: async (d: Uint8Array) => { written.push(d.buffer === ZERO.buffer ? d.length : d.slice()); },
      close: async () => undefined,
      abort: async () => undefined,
    },
    file: async () => new Blob([]),
    drop: () => undefined,
  }),
}));

import { createProject, createVideoClip } from '../core/defaults';
import { insertMain, mainTrack } from '../core/timeline';
import type { Asset } from '../core/types';
import { exportBackup, importBackup } from './backup';

/** The backup as the person's file: sliced and read like a Blob, made of the written bytes and the zero runs. */
function backupFile(): Blob {
  const parts: { at: number; part: Uint8Array | number }[] = [];
  let size = 0;
  for (const part of written) { parts.push({ at: size, part }); size += typeof part === 'number' ? part : part.length; }
  const read = (from: number, to: number) => {
    const out = new Uint8Array(to - from);
    for (const { at, part } of parts) {
      const len = typeof part === 'number' ? part : part.length;
      if (at + len <= from || at >= to) continue;
      if (typeof part !== 'number') {
        const a = Math.max(from, at), b = Math.min(to, at + len);
        out.set(part.subarray(a - at, b - at), a - from);
      }
    }
    return out;
  };
  const slice = (from = 0, to = size): Blob => {
    const a = Math.max(0, Math.min(size, from)), b = Math.max(a, Math.min(size, to));
    return {
      size: b - a,
      slice: (x = 0, y = b - a) => slice(a + x, a + Math.min(y, b - a)),
      arrayBuffer: async () => read(a, b).buffer,
      stream: () => new Blob([read(a, b)]).stream(),
    } as unknown as Blob;
  };
  return slice();
}

const video = (id: string, size: number): Asset => ({ id, kind: 'video', name: id, mime: 'video/mp4', size, duration: 60, width: 1920, height: 1080, hasAudio: false });

async function roundTrip(bytes: number[]) {
  written = [];
  sizes.clear();
  const p = createProject('Long trip', '9:16');
  bytes.forEach((size, k) => { const id = `v${k}`; sizes.set(id, size); p.assets[id] = video(id, size); insertMain(p, createVideoClip(p.assets[id], 0), 0); });
  const { missing } = await exportBackup(p);
  expect(missing, 'every media file went into the backup').toBe(0);
  const file = backupFile();
  expect(file.size, 'the backup holds all the media').toBeGreaterThan(bytes.reduce((a, b) => a + b, 0));
  return importBackup(file);
}

describe('a backup restores whatever its size', () => {
  it('the control: two videos of 3 MiB come back', async () => {
    const { project, dropped } = await roundTrip([3 * PIECE, 3 * PIECE]);
    expect(dropped).toBe(0);
    expect(mainTrack(project).clips).toHaveLength(2);
  });

  it('two videos of 2.1 GiB (4.2 GiB in all) come back', async () => {
    const big = Math.round(2.1 * 1024 * PIECE);
    const { project, dropped } = await roundTrip([big, big]);
    expect(dropped).toBe(0);
    expect(mainTrack(project).clips).toHaveLength(2);
  }, 600_000);
});
