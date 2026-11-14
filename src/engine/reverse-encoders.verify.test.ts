// Sweep lane E2 (docs/21 §5): a reproducing test for audit V-116 — a cancelled or failed reverse held its encoders open,
// and the next export could find none. Mediabunny's encoders are let go by the Output that owns them (finalize or
// cancel); here the Output and its sources are fakes that record what the reverse did with them after the stop. The
// real encoders are counted in e2e/qa-verify-media.spec.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project, VideoClip } from '../core/types';

const log: string[] = [];
let failAdd = false;
let onAdd: () => void = () => undefined;

vi.mock('mediabunny', () => {
  class Source { constructor(readonly name: string) {} close() { log.push(`${this.name} closed`); } }
  return {
    QUALITY_HIGH: 1,
    getFirstEncodableVideoCodec: async () => 'avc',
    getFirstEncodableAudioCodec: async () => 'aac',
    Mp4OutputFormat: class {}, WebMOutputFormat: class {},
    Output: class {
      target = { blob: () => new Blob() };
      addVideoTrack() {} addAudioTrack() {}
      async start() { log.push('output started'); }
      async finalize() { log.push('output finalized'); }
      async cancel() { log.push('output cancelled'); }
    },
    CanvasSource: class extends Source {
      constructor() { super('video source'); }
      async add() { onAdd(); if (failAdd) throw new Error('The encoder failed'); }
    },
    AudioBufferSource: class extends Source { constructor() { super('audio source'); } async add() {} },
    VideoSampleSink: class { async getSample() { return { colorSpace: { matrix: 'bt709' }, close() {} }; } },
    CanvasSink: class {
      async *canvases(start: number) { yield { canvas: {}, timestamp: start }; }
    },
  };
});
vi.mock('./memTarget', () => ({ MemoryTarget: class {} }));
vi.mock('../storage/db', () => ({ openMedia: async () => ({}) }));
vi.mock('./importer', () => ({ importFile: async () => ({ id: 'r' }) }));
vi.mock('./media', () => ({ MediaError: class extends Error {} }));
vi.mock('./sound', () => ({ ResilientSink: class {}, playableAudioTrack: async () => null }));
vi.mock('./videoRange', () => ({ matchStreamRange: () => undefined }));
vi.mock('./encoderDelay', () => ({ encoderDelay: async () => 0 }));
vi.mock('./hdr', () => ({ correctPixels: () => undefined, decodedAs709: () => false, hdrTransfer: async () => null, sdMatrix: async () => false }));
vi.mock('./source', () => ({
  openInput: () => ({
    dispose: () => undefined,
    getPrimaryVideoTrack: async () => ({ getDisplayWidth: async () => 640, getDisplayHeight: async () => 360, computePacketStats: async () => ({ averagePacketRate: 30 }) }),
  }),
}));
// The frame canvas of the reverse: drawn on, never shown.
vi.stubGlobal('document', { createElement: () => ({ getContext: () => ({ drawImage() {}, getImageData() {}, putImageData() {} }) }) });
const { reverseClipSource } = await import('./reverse');

const clip = { id: 'c', kind: 'video', assetId: 'a', in: 0, start: 0, duration: 4, speed: 1 } as unknown as VideoClip;
const project = { assets: { a: { id: 'a', name: 'a.mp4', duration: 4, hasAudio: false } } } as unknown as Project;

describe('a reverse that stops lets go of its encoders (audit V-116)', () => {
  beforeEach(() => { log.length = 0; failAdd = false; onAdd = () => undefined; });

  it('Cancel: the encoders finish what they hold and the output is closed', async () => {
    const ac = new AbortController();
    onAdd = () => ac.abort(); // the person taps Cancel while the first frames are encoded
    await expect(reverseClipSource(project, clip, () => undefined, ac.signal)).rejects.toThrow('Cancelled');
    expect(log).toContain('video source closed');
    expect(log.filter((l) => l.startsWith('output ')).slice(1), 'after start, the output is ended').toEqual(['output finalized']);
  });

  it('a failure: the output is cancelled, which closes its encoders', async () => {
    failAdd = true;
    await expect(reverseClipSource(project, clip, () => undefined, new AbortController().signal)).rejects.toThrow('The encoder failed');
    expect(log).toContain('output cancelled');
  });
});
