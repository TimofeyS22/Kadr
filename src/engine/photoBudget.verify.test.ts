// Verification of audit V-190 where it acts (docs/21 §5, lane E4): the photos a pool holds are trimmed to their budget
// on every frame the preview and the export draw. media.test.ts holds `trimImages` itself; with its calls taken out of
// player.ts and exporter.ts that test stays green and a 4K slideshow keeps every picture again. Here the frame paths
// run over stand-ins for the GPU, the decoders and the text, and the pool says what it was asked.
import { beforeAll, describe, expect, it, vi } from 'vitest';

const trims: Set<string>[] = [];
vi.mock('./media', () => ({
  MediaError: class extends Error {},
  MediaPool: class {
    trimImages(keep: Set<string>) { trims.push(new Set(keep)); }
    sweep() { /* nothing open */ }
    picture() { return Promise.resolve(null); }
    dispose() { /* nothing open */ }
    release() { /* nothing open */ }
  },
}));
vi.mock('./compositor', () => ({
  GPU_LOST: 'gpu lost',
  slotOf: (l: { id: string }) => l.id,
  Compositor: class {
    everLost = false; framesFailed = false; frameMax = 0;
    constructor(readonly canvas: { width: number; height: number }) {}
    isLost() { return false; }
    draw() { return []; }
    dispose() { /* nothing held */ }
  },
}));
vi.mock('./render', () => ({ resolveDrawables: async () => new Map() }));
vi.mock('./text', () => ({ TextRasterizer: class { clear() { /* empty */ } } }));
vi.mock('./faces', () => ({ warmFaces: vi.fn() }));
vi.mock('./segment', () => ({ warmSegmenter: vi.fn() }));
vi.mock('./audio', () => ({
  AudioEngine: class { warm() { /* silent */ } setProject() { /* silent */ } pause() { /* silent */ } },
  duckRanges: () => [], soundEntries: () => [], renderAudioWindow: vi.fn(),
}));
vi.mock('../lib/perf', () => ({ frameDrawn: vi.fn() }));

import { createImageClip, createProject } from '../core/defaults';
import { insertMain } from '../core/timeline';
import type { Asset, Project } from '../core/types';

const photo = (id: string): Asset => ({ id, kind: 'image', name: id, mime: 'image/jpeg', size: 1, duration: 0, width: 8064, height: 6048, hasAudio: false });

/** Two photos one after the other, 3 s each: at 1 s only the first is on screen. */
function slideshow(): Project {
  const p = createProject('a', '9:16');
  for (const [id, at] of [['first', 0], ['second', 3]] as const) {
    p.assets[id] = photo(id);
    insertMain(p, createImageClip(p.assets[id], at, 3), at);
  }
  return p;
}

beforeAll(() => {
  const canvas = () => ({ width: 0, height: 0, getContext: () => null, toBlob: (cb: (b: Blob) => void) => cb(new Blob(['jpeg'])) });
  vi.stubGlobal('document', { createElement: canvas, addEventListener: vi.fn(), removeEventListener: vi.fn(), visibilityState: 'visible' });
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
});

describe('photos are trimmed to the budget on every frame drawn (audit V-190)', () => {
  it('the export: each frame lets go of the photos not on screen', async () => {
    const { exportFrame } = await import('./exporter');
    trims.length = 0;
    await exportFrame(slideshow(), 1, 1080);
    expect(trims.map((k) => [...k]), 'asked once for the frame, keeping the photo on screen').toEqual([['first']]);
  });

  it('the preview: each frame lets go of the photos not on screen', async () => {
    const { Player } = await import('./player');
    const player = new Player() as unknown as { project: Project; drawFrame: (t: number, comp: unknown, from: null, copy: boolean) => Promise<unknown>; duration: number };
    const { Compositor } = await import('./compositor');
    const comp = new Compositor({ width: 720, height: 1280 } as unknown as HTMLCanvasElement);
    (player as unknown as { compositor: unknown }).compositor = comp;
    player.project = slideshow();
    trims.length = 0;
    await player.drawFrame(4, comp, null, false);
    expect(trims.map((k) => [...k]), 'asked once for the frame, keeping the photo on screen').toEqual([['second']]);
  });
});
