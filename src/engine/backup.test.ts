// A backup says when it is not whole (audit V-236).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../storage/db', () => ({
  openMedia: async (id: string) => (id === 'gone' ? undefined : new Blob([id])),
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

describe('exportBackup', () => {
  it('counts the media it could not find', async () => {
    const p = createProject('a', '9:16');
    for (const id of ['here', 'gone']) { p.assets[id] = video(id); insertMain(p, createVideoClip(p.assets[id], 0), 0); }
    const { blob, missing } = await exportBackup(p);
    expect(missing).toBe(1);
    expect(blob.size).toBeGreaterThan(0);
  });
});
