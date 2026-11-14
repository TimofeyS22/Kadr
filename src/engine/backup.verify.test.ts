// Verification of audit V-126 where it acts (docs/21 §5, lane E4): the helper's own test passed with the backup not
// calling it. Here the backup itself is read back: a video deleted from the project is not in it, neither as a file
// nor in project.json.
import { strFromU8, unzipSync } from 'fflate';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../storage/db', () => ({
  openMedia: async (id: string) => new Blob([id]),
  deleteBlob: vi.fn(), putBlob: vi.fn(), saveProject: vi.fn(),
}));
vi.mock('./importer', () => ({ ensureRoom: vi.fn() }));
vi.mock('./media', () => ({ MediaError: class extends Error {} }));
vi.mock('./opfs', () => ({ diskFile: async () => null }));

import { createProject, createVideoClip } from '../core/defaults';
import { insertMain } from '../core/timeline';
import type { Asset } from '../core/types';
import { exportBackup } from './backup';

const video = (id: string): Asset => ({ id, kind: 'video', name: id, mime: 'video/mp4', size: 1, duration: 3, width: 16, height: 9, hasAudio: false });

describe('a backup of a project with a deleted video (audit V-126)', () => {
  it('carries the video on the timeline and not the one deleted from it', async () => {
    const p = createProject('a', '9:16');
    p.assets.kept = video('kept');
    insertMain(p, createVideoClip(p.assets.kept, 0), 0);
    p.assets.deleted = video('deleted'); // in the project's media, on no clip: what deleting its clip leaves behind
    const { blob, missing } = await exportBackup(p);
    expect(missing).toBe(0);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['media/kept', 'project.json']);
    expect(Object.keys((JSON.parse(strFromU8(files['project.json'])) as { assets: Record<string, unknown> }).assets)).toEqual(['kept']);
  });
});
