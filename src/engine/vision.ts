// MediaPipe's runtime and models come from Kadr's own build, each with a hash in its name (docs/12 P2). A deploy
// keeps the files of earlier versions (scripts/keep-assets.mjs), so a tab opened before an update still gets the
// runtime its code was made for, and a cached copy can never be another version under the same name — as it could
// at /mediapipe/ and /models/, or with a model fetched from a "latest" URL.
import loader from '@mediapipe/tasks-vision/vision_wasm_internal.js?url';
import binary from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url';
import faceModel from './mediapipe/blaze_face_short_range.tflite?url';
import segmenterModel from './mediapipe/selfie_segmenter.tflite?url';

const abs = (url: string) => new URL(url, location.href).href;

/** The runtime files for `createFromOptions` (SIMD build: every browser Kadr supports has WebAssembly SIMD). */
export const visionFiles = () => ({ wasmLoaderPath: abs(loader), wasmBinaryPath: abs(binary) });
export const FACE_MODEL = () => abs(faceModel);
export const SEGMENTER_MODEL = () => abs(segmenterModel);
