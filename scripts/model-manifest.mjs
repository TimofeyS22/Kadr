// Writes src/engine/models.json: size and sha256 of every large speech model file, whole and per 16 MiB part
// (docs/12 stage 5). The app downloads these files part by part, checks each part against this list, and keeps
// the parts it has, so a broken connection resumes where it stopped. Run after changing a model or its revision:
//   node scripts/model-manifest.mjs
// Each file is downloaded once from Hugging Face and checked against the hash Hugging Face publishes for it.
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';

export const PART = 2 ** 24; // 16 MiB: small enough to hash and keep in memory on a phone, few enough requests
const FILES = [
  // [repo, pinned revision, file]
  ['onnx-community/whisper-tiny_timestamped', '517244293732ee2d58139af5814231b7e6830a0d', 'onnx/encoder_model_quantized.onnx'],
  ['onnx-community/whisper-tiny_timestamped', '517244293732ee2d58139af5814231b7e6830a0d', 'onnx/decoder_model_merged_quantized.onnx'],
  ['onnx-community/whisper-base_timestamped', '608c49e61301901684bc36cac8f74b95ff6b5a8e', 'onnx/encoder_model_quantized.onnx'],
  ['onnx-community/whisper-base_timestamped', '608c49e61301901684bc36cac8f74b95ff6b5a8e', 'onnx/decoder_model_merged_quantized.onnx'],
  ['onnx-community/whisper-small_timestamped', '65caa70f294b46e1c33ff820aae6b16d048ab818', 'onnx/encoder_model_quantized.onnx'],
  ['onnx-community/whisper-small_timestamped', '65caa70f294b46e1c33ff820aae6b16d048ab818', 'onnx/decoder_model_merged_quantized.onnx'],
  ['istupakov/gigaam-v3-onnx', '322c3b29492673eb7d0b434bfa9dfb8653e34d02', 'v3_e2e_ctc.int8.onnx'],
];

const files = {};
for (const [repo, rev, file] of FILES) {
  for (let attempt = 1; ; attempt++) {
    try {
      await hashFile(repo, rev, file);
      break;
    } catch (e) {
      if (attempt === 4) throw e;
      console.warn(`${file}: ${e.message}, again (${attempt})`);
    }
  }
}

async function hashFile(repo, rev, file) {
  const key = `${repo}/resolve/${rev}/${file}`;
  const res = await fetch(`https://huggingface.co/${key}`);
  if (!res.ok || !res.body) throw new Error(`${key}: HTTP ${res.status}`);
  const published = res.headers.get('x-linked-etag')?.replace(/"/g, '') ?? (await lfsOid(repo, rev, file));
  const whole = createHash('sha256');
  const parts = [];
  let part = createHash('sha256'), inPart = 0, size = 0;
  for await (const chunk of res.body) {
    let buf = Buffer.from(chunk);
    whole.update(buf);
    size += buf.length;
    while (buf.length) {
      const take = Math.min(PART - inPart, buf.length);
      part.update(buf.subarray(0, take));
      inPart += take;
      buf = buf.subarray(take);
      if (inPart === PART) { parts.push(part.digest('hex')); part = createHash('sha256'); inPart = 0; }
    }
  }
  if (inPart) parts.push(part.digest('hex'));
  const sha256 = whole.digest('hex');
  if (sha256 !== published) throw new Error(`${key}: sha256 ${sha256} is not the published ${published}`);
  files[key] = { size, sha256, parts };
  console.log(`${key}: ${(size / 2 ** 20).toFixed(1)} MiB, ${parts.length} parts`);
}

async function lfsOid(repo, rev, file) {
  const dir = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '';
  const list = await (await fetch(`https://huggingface.co/api/models/${repo}/tree/${rev}/${dir}`)).json();
  return list.find((f) => f.path === file)?.lfs?.oid;
}

writeFileSync(new URL('../src/engine/models.json', import.meta.url), `${JSON.stringify({ part: PART, files }, null, 1)}\n`);
