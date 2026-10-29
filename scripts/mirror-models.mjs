// Puts the speech models on Kadr's own site (docs/12 stage 5): every file of the repositories models.json lists in
// `mirror`, at <dist>/models/<repo>/resolve/<rev>/<path> — small files whole, large ones as 16 MiB parts at
// <path>.parts/<i>. Parts need no Range requests (a service worker in WebKit drops the header) and no file is near
// GitHub Pages' size limits. The worker downloads from here first and from Hugging Face if this site fails.
//   node scripts/mirror-models.mjs [dist]
// The bytes come from scripts/.model-cache/ (downloaded once, CI keeps it between runs) and are checked against
// models.json before they are written.
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { PART, modelBytes, sha256 } from './model-cache.mjs';
import manifest from '../src/engine/models.json' with { type: 'json' };

const dist = process.argv[2] ?? 'dist';
const out = join(dist, 'models');
const mirrored = (key) => manifest.mirror.some((prefix) => key.startsWith(prefix));
let bytes = 0, count = 0;
const put = (path, b) => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, b);
  bytes += b.length;
  count++;
};
for (const [key, f] of Object.entries(manifest.files)) {
  if (!mirrored(key)) continue;
  const b = await modelBytes(key, f);
  f.parts.forEach((hash, i) => {
    const part = b.subarray(i * PART, (i + 1) * PART);
    if (sha256(part) !== hash) throw new Error(`${key}: part ${i} does not match models.json`);
    put(join(out, `${key}.parts`, String(i)), part);
  });
}
for (const [key, f] of Object.entries(manifest.small)) {
  if (mirrored(key)) put(join(out, key), await modelBytes(key, f));
}
console.log(`models: ${count} files, ${Math.round(bytes / 2 ** 20)} MB in ${out}`);
