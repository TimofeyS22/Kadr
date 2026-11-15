// Sweep lane E2 (docs/21 §5): the second half of V-181. A speech worker started anew in the middle of a run (the idle
// release) has no Whisper loaded; the next request must load the model it names — the one the person agreed to and the
// device keeps — and never Whisper tiny, a 41 MB download nobody was asked about. The model library is replaced by a
// recorder: nothing is downloaded, only which model the worker asks for is seen.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { SPEECH_REPOS } from './modelFiles';

const asked: string[] = [];
vi.mock('@huggingface/transformers', () => ({
  env: { backends: { onnx: { wasm: {} } }, fetch: globalThis.fetch },
  pipeline: vi.fn(async (_task: string, repo: string) => {
    asked.push(repo);
    return Object.assign(async () => ({ chunks: [{ timestamp: [0, 0.4], text: ' hello' }] }), { dispose: async () => undefined });
  }),
  AutoModel: { from_pretrained: vi.fn() },
  Tensor: class {},
}));

const posted: { type: string; id: number }[] = [];
let onmessage: (e: { data: unknown }) => Promise<void>;
beforeAll(async () => {
  vi.stubGlobal('self', Object.assign(globalThis, { location: new URL('http://127.0.0.1/'), postMessage: (m: { type: string; id: number }) => { posted.push(m); } }));
  const cache = { match: async () => undefined, put: async () => undefined, keys: async () => [], delete: async () => true };
  vi.stubGlobal('caches', { open: async () => cache, keys: async () => [], delete: async () => true, match: async () => undefined });
  await import('./asr.worker');
  onmessage = (globalThis as unknown as { onmessage: typeof onmessage }).onmessage;
}, 120_000);

describe('a speech worker started anew mid-run (V-181)', () => {
  it('loads the Whisper the request names, not tiny', async () => {
    await onmessage({ data: { type: 'transcribe', id: 7, audio: new Float32Array(16000), language: 'en', model: 'base' } });
    expect(posted.find((m) => m.id === 7)?.type, 'the request is answered').toBe('result');
    expect(asked).toEqual([SPEECH_REPOS.base]);
    expect(asked).not.toContain(SPEECH_REPOS.tiny);
  });
});
