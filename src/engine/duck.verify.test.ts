// Sweep lane E2 (docs/21 §5): V-130 — a guide track is not in the file, so in the preview it must not duck the music
// either. src/core/audit.test.ts checks `withoutGuides` alone; this checks what the preview's ducking actually reads
// (`duckSpeakers`), so it goes red when the preview takes the guide for a voice again.
import { produce } from 'immer';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createAudioClip, createProject, createVideoClip } from '../core/defaults';
import { insertMain, placeClip } from '../core/timeline';
import type { Asset, Project } from '../core/types';
import type { duckSpeakers as DuckSpeakers } from './audio';

// The engine's imports reach code that makes canvases at load; Node has none.
let duckSpeakers: typeof DuckSpeakers;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
  vi.stubGlobal('self', globalThis);
  ({ duckSpeakers } = await import('./audio'));
}, 120_000);

const asset = (id: string, kind: 'video' | 'audio'): Asset => ({ id, kind, name: id, mime: kind === 'video' ? 'video/mp4' : 'audio/mp4', size: 1, duration: 10, width: kind === 'video' ? 1080 : 0, height: kind === 'video' ? 1920 : 0, hasAudio: true });

/** A silent video, music that ducks, and a voice guide over it (a guide plays while editing and is not exported). */
function project(guide: boolean): { p: Project; guideId: string } {
  let guideId = '';
  const p = produce(createProject('a', '9:16'), (d) => {
    for (const a of [asset('v', 'video'), asset('m', 'audio'), asset('g', 'audio')]) d.assets[a.id] = a;
    const v = createVideoClip(d.assets.v, 0);
    v.muted = true;
    insertMain(d, v, 0);
    const m = createAudioClip(d.assets.m, 0);
    m.duck = 0.5;
    placeClip(d, m);
    const g = createAudioClip(d.assets.g, 0);
    g.guide = guide;
    placeClip(d, g);
    guideId = g.id;
  });
  return { p, guideId };
}

describe('the preview ducks music under voices, not under a guide (V-130)', () => {
  it('a voice track is something music ducks under', () => {
    const { p, guideId } = project(false);
    expect(duckSpeakers(p).map((e) => e.clip.id)).toContain(guideId);
  });
  it('the same track marked as a guide is not', () => {
    const { p, guideId } = project(true);
    expect(duckSpeakers(p).map((e) => e.clip.id)).not.toContain(guideId);
  });
});
