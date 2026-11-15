// Sweep lane E2 (docs/21 §5): a reproducing test for audit V-227 — an animated GIF or WebP silently became a still
// picture. The import itself is replaced: what is checked is that its word about a picture that moves reaches the person
// as a toast. Since 668f670 the importer says it (`ImportNote` 'still'), as only it sees the file's bytes and can tell a
// moving GIF, WebP or APNG from a still one: that part is `src/core/animated.test.ts` and e2e/qa-media-animated.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Asset } from '../core/types';

let imported: Asset[] = [];
type Note = (name: string, note: { kind: 'still' }) => void;
vi.mock('../engine/importer', () => ({
  importFiles: async (_files: File[], _onError: unknown, _onProgress: unknown, onNote?: Note) => {
    for (const a of imported) if (a.name.startsWith('moving')) onNote?.(a.name, { kind: 'still' });
    return imported;
  },
  importFile: vi.fn(), importStored: vi.fn(), pickFiles: vi.fn(),
}));
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
