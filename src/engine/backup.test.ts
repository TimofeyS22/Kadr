// A backup says when it is not whole (audit V-236).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../storage/db', () => ({
  openMedia: async (id: string) => (id === 'gone' ? undefined : new Blob([id])),
  deleteBlob: vi.fn(), putBlob: vi.fn(), putCopy: vi.fn(), saveProject: vi.fn(),
}));
vi.mock('./importer', () => ({ ensureRoom: vi.fn() }));
vi.mock('./media', () => ({ MediaError: class extends Error {} }));
vi.mock('./opfs', () => ({ diskFile: async () => null }));

import { Zip, ZipPassThrough, strToU8 } from 'fflate';
import { createProject, createVideoClip } from '../core/defaults';
import { insertMain } from '../core/timeline';
import type { Asset } from '../core/types';
import { putBlob, putCopy } from '../storage/db';
import { exportBackup, importBackup } from './backup';

const video = (id: string): Asset => ({ id, kind: 'video', name: id, mime: 'video/mp4', size: 1, duration: 3, width: 16, height: 9, hasAudio: false });

describe('exportBackup', () => {
  it('counts the media it could not find', async () => {
    const p = createProject('a', '9:16');
    for (const id of ['here', 'gone']) { p.assets[id] = video(id); insertMain(p, createVideoClip(p.assets[id], 0), 0); }
    const { blob, missing } = await exportBackup(p);
    expect(missing).toBe(1);
    expect(blob.size).toBeGreaterThan(0);
  });
});

describe('importBackup', () => {
  // On Safari a stored Blob cut out of the picked backup came back as the whole backup: every restored file was the
  // zip, and nothing played (SW-A-4). What goes to storage is a copy of each file's own bytes.
  it('stores each file of the backup as a copy of its own bytes, never as the slice of the backup', async () => {
    const p = createProject('a', '9:16');
    for (const id of ['one', 'two']) { p.assets[id] = video(id); insertMain(p, createVideoClip(p.assets[id], 0), 0); }
    const parts: Uint8Array[] = [];
    const zip = new Zip((err, data) => { if (err) throw err; parts.push(data); });
    const add = (name: string, bytes: Uint8Array) => { const e = new ZipPassThrough(name); zip.add(e); e.push(bytes, true); };
    add('project.json', strToU8(JSON.stringify(p)));
    add('media/one', strToU8('the bytes of the first video'));
    add('media/two', strToU8('and those of the second one'));
    zip.end();
    const { project } = await importBackup(new Blob(parts as BlobPart[]));
    expect(vi.mocked(putBlob)).not.toHaveBeenCalled();
    const copies = await Promise.all(vi.mocked(putCopy).mock.calls.map(async ([id, blob, type]) => [project.assets[id]?.name, await blob.text(), type]));
    expect(copies).toEqual([['one', 'the bytes of the first video', 'video/mp4'], ['two', 'and those of the second one', 'video/mp4']]);
  });
});
