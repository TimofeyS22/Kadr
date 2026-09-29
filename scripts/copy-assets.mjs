// Copies large runtime files into public/ (git-ignored).
//   node scripts/copy-assets.mjs --dev : ONNX Runtime WASM for the dev server (production bundles its own copy;
//                                        vite.config drops dist/ort after a build)
//   always                             : MediaPipe vision WASM and the selfie segmentation model
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';

const dev = process.argv.includes('--dev');
function copy(src, dst, files) {
  mkdirSync(dst, { recursive: true });
  for (const f of files) if (!existsSync(`${dst}/${f}`)) copyFileSync(`${src}/${f}`, `${dst}/${f}`);
}
if (dev) copy('node_modules/onnxruntime-web/dist', 'public/ort', ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']);
copy('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe', ['vision_wasm_internal.js', 'vision_wasm_internal.wasm']);
const model = 'public/models/selfie_segmenter.tflite';
if (!existsSync(model)) {
  mkdirSync('public/models', { recursive: true });
  const res = await fetch('https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite');
  if (!res.ok) throw new Error(`model download failed: ${res.status}`);
  writeFileSync(model, Buffer.from(await res.arrayBuffer()));
}
console.log(`assets ready (${dev ? 'dev' : 'build'})`);
