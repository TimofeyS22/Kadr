// Copies large runtime files into public/ (git-ignored).
//   node scripts/copy-assets.mjs --dev : ONNX Runtime WASM for the dev server (production bundles its own copy;
//                                        vite.config drops dist/ort after a build)
// MediaPipe's runtime and models are imported by src/engine/vision.ts and get hashed names in the build (docs/12 P2).
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';

const dev = process.argv.includes('--dev');
function copy(src, dst, files) {
  mkdirSync(dst, { recursive: true });
  for (const f of files) if (!existsSync(`${dst}/${f}`)) copyFileSync(`${src}/${f}`, `${dst}/${f}`);
}
if (dev) copy('node_modules/onnxruntime-web/dist', 'public/ort', ['ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.wasm']);
console.log(`assets ready (${dev ? 'dev' : 'build'})`);
