// A file the export cannot read is said as that, not as a sound the browser cannot decode (V-113): the storage's own
// words (MediaReadError, MediaMissing) and the browser's NotReadableError go out as they are, and errorMessage says
// them in the person's language; a decoder that refuses is still named by the file it refused.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { renderAudioWindow as Render } from './audio';
import type { MediaPool } from './media';
import type { Project } from '../core/types';
import { MediaMissing, MediaReadError } from '../storage/reader';

let renderAudioWindow: typeof Render;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('OfflineAudioContext', class { startRendering() { return Promise.resolve(null); } });
  ({ renderAudioWindow } = await import('./audio'));
}, 120_000);

const project = {
  assets: { a1: { id: 'a1', kind: 'audio', name: 'a.mp4', duration: 4, width: 0, height: 0, hasAudio: true } },
  tracks: [{ id: 't', kind: 'audio', clips: [{ kind: 'audio', id: 'c', assetId: 'a1', start: 0, duration: 4, in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 }] }],
} as unknown as Project;
const failing = (e: unknown) => ({ audioSink: async () => { throw e; } }) as unknown as MediaPool;

describe('a sound the export cannot read', () => {
  for (const [name, e] of [
    ['the storage could not read it', new MediaReadError('lease died twice')],
    ['the storage has no such file', new MediaMissing()],
    ['the browser cannot read the file', new DOMException('The file could not be read', 'NotReadableError')],
  ] as const) {
    it(`${name}: said as that, not as a sound that does not decode`, async () => {
      await expect(renderAudioWindow(project, failing(e), 0, 2, 48000)).rejects.toBe(e);
    });
  }
  it('a decoder that refuses is still named by its file', async () => {
    await expect(renderAudioWindow(project, failing(new Error('Unsupported configuration')), 0, 2, 48000))
      .rejects.toThrow('The sound of “{name}” cannot be decoded in this browser');
  });
  it('for captions (skip), a sound that cannot be read is left out by name, as before', async () => {
    const skip = new Set<string>();
    await renderAudioWindow(project, failing(new MediaReadError('x')), 0, 2, 48000, skip);
    expect([...skip]).toEqual(['a1']);
  });
});
