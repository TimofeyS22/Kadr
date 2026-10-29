// Writes src/engine/models.json: every speech model file Kadr downloads, with its size and sha256 — large files
// also per 16 MiB part (docs/12 stage 5) — and which repositories Kadr's own site serves (scripts/mirror-models.mjs).
// The app checks each part and each small file against this list, and keeps the parts it has, so a broken
// connection resumes where it stopped. Run after changing a model or its revision:
//   node scripts/model-manifest.mjs
// Each file is downloaded once into scripts/.model-cache/ and checked against the hash Hugging Face publishes.
import { writeFileSync } from 'node:fs';
import { PART, modelBytes, partHashes, sha256 } from './model-cache.mjs';

/** Files at or above this size are fetched in parts; smaller ones whole. */
const LARGE = 4 * 2 ** 20;
const WHISPER = ['config.json', 'generation_config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/encoder_model_quantized.onnx', 'onnx/decoder_model_merged_quantized.onnx'];
const MODELS = [
  // [repo, pinned revision, files, served from Kadr's own site]
  ['onnx-community/whisper-tiny_timestamped', '517244293732ee2d58139af5814231b7e6830a0d', WHISPER, true],
  ['onnx-community/whisper-base_timestamped', '608c49e61301901684bc36cac8f74b95ff6b5a8e', WHISPER, true],
  // 237 MB: too big for the site's 1 GB next to the other models and past versions; it comes from Hugging Face.
  ['onnx-community/whisper-small_timestamped', '65caa70f294b46e1c33ff820aae6b16d048ab818', WHISPER, false],
  ['istupakov/gigaam-v3-onnx', '322c3b29492673eb7d0b434bfa9dfb8653e34d02', ['config.json', 'v3_e2e_ctc.int8.onnx', 'v3_e2e_ctc_vocab.txt'], true],
  ['istupakov/stt_ru_fastconformer_hybrid_large_pc_onnx', 'fb6753736c56de3259d78a26a488548c84b9dccb', ['config.json', 'model.int8.onnx', 'vocab.txt'], true],
  ['onnx-community/silero-vad', 'e71cae966052b992a7eca6b17738916ce0eca4ec', ['onnx/model.onnx'], true],
];

const files = {}, small = {}, mirror = [];
for (const [repo, rev, paths, own] of MODELS) {
  if (own) mirror.push(`${repo}/resolve/${rev}/`);
  for (const path of paths) {
    const key = `${repo}/resolve/${rev}/${path}`;
    const b = await modelBytes(key);
    if (b.length >= LARGE) files[key] = { size: b.length, sha256: sha256(b), parts: partHashes(b) };
    else small[key] = { size: b.length, sha256: sha256(b) };
    console.log(`${key}: ${(b.length / 2 ** 20).toFixed(1)} MiB${b.length >= LARGE ? `, ${Math.ceil(b.length / PART)} parts` : ''}`);
  }
}
writeFileSync(new URL('../src/engine/models.json', import.meta.url), `${JSON.stringify({ part: PART, mirror, files, small }, null, 1)}\n`);
