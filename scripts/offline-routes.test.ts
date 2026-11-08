// A name the service worker's route misses is lost without a network (audit V-121: the face model was).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const route = /urlPattern: \(\{ url \}\) => \/(\\\/assets\\\/\(rnnoise.*?)\/\.test\(url\.pathname\)/.exec(readFileSync('vite.config.ts', 'utf8'))![1];

describe('files kept for offline use', () => {
  it('covers the face and person models under the names the build gives them', () => {
    const re = new RegExp(route);
    for (const n of ['blaze_face_short_range-CYqvruwv.tflite', 'selfie_segmenter-DF05sdL4.tflite', 'vision_bundle-a1.js', 'ort-wasm-simd.wasm']) expect(re.test(`/Kadr/assets/${n}`), n).toBe(true);
    expect(re.test('/Kadr/assets/index-abc.js')).toBe(false);
  });
});
