// Speech model files on this machine (scripts/.model-cache/, git-ignored), downloaded once from Hugging Face and
// checked against the hash Hugging Face publishes for them: sha256 for large (LFS) files, the git blob sha1 for
// small ones. Shared by scripts/model-manifest.mjs (which writes src/engine/models.json) and
// scripts/mirror-models.mjs (which puts the files on Kadr's own site, docs/12 stage 5). When Hugging Face is down,
// CI takes the files from the live site, checked against models.json just the same.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PART = 2 ** 24; // 16 MiB: small enough to hash and keep in memory on a phone, few enough requests
export const CACHE = join(import.meta.dirname, '.model-cache');
const HF = 'https://huggingface.co/';

export const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const gitSha1 = (b) => createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');

/** What Hugging Face publishes about every file of a repo at a revision: path → { size, sha256? , sha1 }. */
const trees = new Map();
async function tree(repo, rev) {
  const k = `${repo}@${rev}`;
  if (!trees.has(k)) {
    trees.set(k, (async () => {
      for (let attempt = 1; ; attempt++) {
        try {
          const res = await fetch(`${HF}api/models/${repo}/tree/${rev}?recursive=1`);
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const out = new Map();
          for (const f of await res.json()) if (f.type === 'file') out.set(f.path, { size: f.size, sha256: f.lfs?.oid, sha1: f.oid });
          return out;
        } catch (e) {
          if (attempt === 4) throw new Error(`${repo}@${rev}: file list: ${e.message}`);
          await new Promise((r) => setTimeout(r, attempt * 2000));
        }
      }
    })());
  }
  return trees.get(k);
}

/** `<repo>/resolve/<rev>/<path>` → its parts. */
export function splitKey(key) {
  const m = /^(.+?)\/resolve\/([^/]+)\/(.+)$/.exec(key);
  if (!m) throw new Error(`not a model file key: ${key}`);
  return { repo: m[1], rev: m[2], path: m[3] };
}

/** Kadr's own copy (scripts/mirror-models.mjs): where CI gets a file when Hugging Face does not answer. */
const MIRROR = process.env.KADR_MODEL_MIRROR ?? 'https://timofeys22.github.io/Kadr/models/';

async function download(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The bytes of a model file: from the cache, else from Hugging Face, else from Kadr's live copy (parts for a large
 * file) — four tries in turn. `expect`: the size, sha256 and part hashes it must have (models.json); without it,
 * the hash Hugging Face publishes is the check (and only Hugging Face is asked).
 */
export async function modelBytes(key, expect) {
  const file = join(CACHE, key);
  const good = async (b) => {
    if (expect) return b.length === expect.size && sha256(b) === expect.sha256;
    const { repo, rev, path } = splitKey(key);
    const meta = (await tree(repo, rev)).get(path);
    if (!meta) throw new Error(`${key}: not in the repo`);
    return b.length === meta.size && (meta.sha256 ? sha256(b) === meta.sha256 : gitSha1(b) === meta.sha1);
  };
  if (existsSync(file)) {
    const b = readFileSync(file);
    if (await good(b)) return b;
  }
  const fromMirror = async () => (expect?.parts
    ? Buffer.concat(await Promise.all(expect.parts.map((_, i) => download(`${MIRROR}${key}.parts/${i}`))))
    : download(MIRROR + key));
  const sources = expect ? [() => download(HF + key), fromMirror] : [() => download(HF + key)];
  for (let attempt = 1; ; attempt++) {
    try {
      const b = await sources[(attempt - 1) % sources.length]();
      if (!(await good(b))) throw new Error('does not match its hash');
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(`${file}.tmp`, b);
      renameSync(`${file}.tmp`, file);
      return b;
    } catch (e) {
      if (attempt === 4) throw new Error(`${key}: ${e.message}`);
      console.warn(`${key}: ${e.message}, again (${attempt})`);
      await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
}

/** sha256 of each PART-sized slice. */
export const partHashes = (b) => Array.from({ length: Math.ceil(b.length / PART) }, (_, i) => sha256(b.subarray(i * PART, (i + 1) * PART)));
