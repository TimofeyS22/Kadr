// Sweep lane E2 (docs/21 §5): a reproducing test for audit V-227 — an animated GIF or WebP silently became a still
// picture. The import itself is replaced: what is checked is what the person is told when a GIF comes in. An animated
// WebP needs its frames to be told from a still one: that case is in e2e/qa-verify-media.spec.ts, with real files.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '../core/types';

let imported: Asset[] = [];
vi.mock('../engine/importer', () => ({ importFiles: async () => imported, importFile: vi.fn(), pickFiles: vi.fn() }));
vi.mock('../engine/media', () => ({ MediaError: class extends Error {}, captureFrame: vi.fn() }));
vi.mock('../engine/player', () => ({ player: {} }));
vi.mock('../engine/save', () => ({ saveFile: vi.fn() }));
vi.mock('../storage/db', () => ({ deleteBlob: vi.fn(), getBlob: vi.fn(), putBlob: vi.fn() }));

const { createProject } = await import('../core/defaults');
const { useEditor } = await import('../state/store');
const { addFiles } = await import('./actions');

const picture = (name: string, mime: string): Asset => ({ id: name, name, kind: 'image', mime, duration: 0, width: 48, height: 48, hasAudio: false, size: 994 } as unknown as Asset);
const add = async (a: Asset) => {
  imported = [a];
  await addFiles([new File([], a.name, { type: a.mime })], 'main');
  return useEditor.getState().toasts.map((x) => x.text);
};

describe('a moving picture that comes in still says so (audit V-227)', () => {
  beforeEach(() => { useEditor.getState().open(createProject('p', '9:16')); useEditor.setState({ toasts: [] }); });

  it('a GIF', async () => {
    expect(await add(picture('moving.gif', 'image/gif'))).toEqual([expect.stringMatching(/still picture/)]);
  });
});
