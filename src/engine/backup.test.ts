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
import { exportAllBackup, exportBackup, importBackup, importBackups } from './backup';
import { saveProject } from '../storage/db';
import { zipEntries } from './zipread';

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

// A Kadr on the Home Screen keeps its own storage, apart from Safari's: its projects get there through one file with
// every project (SW-A-22, the owner's iPhone, 2026-11-23).
describe('a backup of every project', () => {
  const two = () => {
    const a = createProject('Trip', '9:16'), b = createProject('Talk', '16:9');
    for (const [p, id] of [[a, 'sea'], [a, 'song'], [b, 'face'], [b, 'song']] as const) { p.assets[id] = video(id); insertMain(p, createVideoClip(p.assets[id], 0), 0); }
    return [a, b];
  };

  it('is one zip with each project under projects/<n>/ and a file two projects share once', async () => {
    const { blob, missing } = await exportAllBackup(two());
    expect(missing).toBe(0);
    const names = (await zipEntries(blob)).map((e) => e.name).sort();
    expect(names).toEqual(['media/face', 'media/sea', 'media/song', 'projects/0/project.json', 'projects/1/project.json']);
  });

  it('comes back as every project, each with new ids, and the shared file stored once for both', async () => {
    vi.mocked(putCopy).mockClear();
    vi.mocked(saveProject).mockClear();
    const { blob } = await exportAllBackup(two());
    const { projects, dropped } = await importBackups(blob);
    expect(dropped).toBe(0);
    expect(projects.map((p) => p.name)).toEqual(['Trip (restored)', 'Talk (restored)']);
    expect(vi.mocked(saveProject)).toHaveBeenCalledTimes(2);
    expect(vi.mocked(putCopy)).toHaveBeenCalledTimes(3);
    const [trip, talk] = projects;
    expect(Object.keys(trip.assets)).not.toContain('sea'); // new ids: a restore never overwrites
    const song = (p: typeof trip) => Object.values(p.assets).find((x) => x.name === 'song')!.id;
    expect(song(trip)).toBe(song(talk));
    expect(trip.tracks.flatMap((t) => t.clips)).toHaveLength(2);
    expect(talk.tracks.flatMap((t) => t.clips)).toHaveLength(2);
  });

  it('a backup of one project is still project.json, and the one-project restore still reads it', async () => {
    const [a] = two();
    const { blob } = await exportBackup(a);
    expect((await zipEntries(blob)).map((e) => e.name)).toContain('project.json');
    const { project } = await importBackup(blob);
    expect(project.name).toBe('Trip (restored)');
    expect((await importBackups(blob)).projects).toHaveLength(1);
  });

  it('says so when there is nothing to save', async () => {
    await expect(exportAllBackup([])).rejects.toThrow();
  });
});
