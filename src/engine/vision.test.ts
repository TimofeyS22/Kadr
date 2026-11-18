// The runtimes' sizes the download is counted against are the package's own (SW-L-3): an update of
// @mediapipe/tasks-vision that changes them fails here, not as a progress bar stuck short of 100 % on a phone.
import { statSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@mediapipe/tasks-vision/vision_wasm_internal.js?url', () => ({ default: '/a.js' }));
vi.mock('@mediapipe/tasks-vision/vision_wasm_internal.wasm?url', () => ({ default: '/a.wasm' }));
vi.mock('@mediapipe/tasks-vision/vision_wasm_module_internal.js?url', () => ({ default: '/b.js' }));
vi.mock('@mediapipe/tasks-vision/vision_wasm_module_internal.wasm?url', () => ({ default: '/b.wasm' }));
vi.mock('./mediapipe/blaze_face_short_range.tflite?url', () => ({ default: '/f.tflite' }));
vi.mock('./mediapipe/selfie_segmenter.tflite?url', () => ({ default: '/s.tflite' }));

describe('the vision runtimes (SW-L-3)', () => {
  it('are the sizes the package ships', async () => {
    const { RUNTIME_BYTES } = await import('./vision');
    const size = (f: string) => statSync(new URL(`../../node_modules/@mediapipe/tasks-vision/wasm/${f}`, import.meta.url)).size;
    expect(RUNTIME_BYTES).toEqual({ page: size('vision_wasm_internal.wasm'), worker: size('vision_wasm_module_internal.wasm') });
  });
});
