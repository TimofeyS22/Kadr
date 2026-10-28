// Deploy skew (docs/12): GitHub Pages replaces the whole site on every deploy, so a tab opened before it loses every
// file its code loads later — lazy chunks, the speech worker, ONNX Runtime ("Importing a module script failed" on the
// owner's iPhone). Before a deploy, the files of recent deployments are put back into dist/assets, and
// dist/assets-manifest.json records which files each generation needs (newest first).
//   node scripts/keep-assets.mjs <live site URL> [dist]
// The first time (a live site without a manifest) the live generation is found by following references from its
// index.html and service worker. A file the live site no longer has (404) is skipped; any other failure to reach
// the live site fails the deploy, so a network hiccup never throws the history away.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const KEEP = 5; // generations kept whatever their age, the new one included
export const KEEP_MS = 30 * 864e5; // older ones too, while they were replaced less than this long ago
const BUDGET = 950 * 2 ** 20; // GitHub Pages allows 1 GB per site; older generations go first beyond this
const TRIES = 3;

/**
 * Generations to keep, newest first: the last KEEP, and any replaced less than KEEP_MS before `now`. A generation
 * whose files the newer one has anyway is dropped (a redeploy of the same code).
 */
export function retain(generations, now) {
  const out = [];
  for (const g of generations) {
    const prev = out[out.length - 1];
    if (prev && names(g).every((f) => names(prev).includes(f))) continue;
    if (out.length >= KEEP && now - Date.parse(prev.at) >= KEEP_MS) break;
    out.push(g);
  }
  return out;
}

const names = (g) => g.files.map((f) => (typeof f === 'string' ? f : f.name));

async function get(url, as) {
  for (let i = 1; ; i++) {
    try {
      const res = await fetch(url, { cache: 'no-store' });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return as === 'bytes' ? Buffer.from(await res.arrayBuffer()) : await res.text();
    } catch (e) {
      if (i >= TRIES) throw new Error(`keep-assets: ${url} could not be fetched (${e.message}); not deploying without the previous files`);
      await new Promise((r) => setTimeout(r, 2000 * i));
    }
  }
}

/** The live generation, from what its entry points reference (only needed once, before the first manifest). */
async function crawl(base) {
  const found = new Set();
  const queue = ['index.html', 'sw.js'];
  for (let i = 0; i < queue.length; i++) {
    const text = await get(base + queue[i]);
    if (!text) continue;
    // Hashed names: "assets/x-AbCd1234.js" from the page and the service worker, "./x-AbCd1234.js" between chunks.
    for (const m of text.matchAll(/([\w.-]+-[\w-]{8}\.(?:js|mjs|css|wasm|woff2?))\b/g)) {
      if (found.has(m[1])) continue;
      found.add(m[1]);
      if (/\.(m?js|css)$/.test(m[1])) queue.push(`assets/${m[1]}`);
    }
  }
  return [...found].sort();
}

const sizeOf = (dir) => fs.readdirSync(dir, { withFileTypes: true, recursive: true })
  .filter((e) => e.isFile()).reduce((s, e) => s + fs.statSync(path.join(e.parentPath, e.name)).size, 0);
const sha256 = (body) => createHash('sha256').update(body).digest('hex');

async function main(site, dist) {
  const base = site.endsWith('/') ? site : `${site}/`;
  const assets = path.join(dist, 'assets');
  const { version } = JSON.parse(fs.readFileSync('package.json', 'utf8'));
  const own = fs.readdirSync(assets).filter((f) => fs.statSync(path.join(assets, f)).isFile()).sort().map((name) => {
    const body = fs.readFileSync(path.join(assets, name));
    return { name, size: body.length, sha256: sha256(body) };
  });
  const now = Date.now();
  const manifest = JSON.parse((await get(`${base}assets-manifest.json`)) ?? 'null');
  let previous = manifest?.generations;
  if (!previous) { // the first deploy with this script: the live generation is found from its entry points
    const files = await crawl(base);
    // A site that answers 404 for everything (a Pages outage) must not wipe the history.
    if (!files.length && !process.env.KEEP_ASSETS_FIRST) throw new Error(`keep-assets: ${base} has neither a manifest nor a page to crawl; not deploying (KEEP_ASSETS_FIRST=1 for a brand-new site)`);
    previous = [{ version: 'live', at: new Date(now).toISOString(), files }];
  }
  const current = { version, build: process.env.GITHUB_SHA?.slice(0, 12) ?? 'local', at: new Date(now).toISOString(), files: own };
  const generations = retain([current, ...previous.filter((g) => g.files?.length)], now);

  let bytes = sizeOf(dist);
  let restored = 0, missing = 0;
  const kept = [current];
  for (const g of generations.slice(1)) {
    const present = []; // the manifest lists only files the site has: a name the live site never served is dropped
    const added = [];
    let fits = true;
    for (const f of g.files) {
      const name = typeof f === 'string' ? f : f.name;
      if (fs.existsSync(path.join(assets, name))) { present.push(f); continue; }
      const body = await get(`${base}assets/${name}`, 'bytes');
      if (!body) {
        // A file this script kept (it has a hash) is never gone on its own: something is wrong with the site.
        if (typeof f !== 'string' && !process.env.KEEP_ASSETS_ALLOW_MISSING) throw new Error(`keep-assets: ${name} is listed in the live manifest but the site answers 404; not deploying (KEEP_ASSETS_ALLOW_MISSING=1 drops it)`);
        missing++;
        continue;
      }
      if (typeof f !== 'string' && (body.length !== f.size || sha256(body) !== f.sha256)) {
        throw new Error(`keep-assets: ${name} from the live site does not match its manifest; not deploying`);
      }
      if (bytes + body.length > BUDGET) { fits = false; break; }
      fs.writeFileSync(path.join(assets, name), body);
      bytes += body.length;
      added.push(name);
      present.push(typeof f === 'string' ? { name, size: body.length, sha256: sha256(body) } : f);
    }
    if (!fits) { // this generation and older ones do not fit: none of their files stay half-kept
      for (const name of added) fs.rmSync(path.join(assets, name));
      break;
    }
    restored += added.length;
    if (present.length) kept.push({ ...g, files: present });
  }
  fs.writeFileSync(path.join(dist, 'assets-manifest.json'), JSON.stringify({ generations: kept }));
  console.log(`kept ${kept.length} generations (${kept.map((g) => g.version).join(', ')}): ${restored} old files restored, ${missing} gone from the live site, site ${Math.round(bytes / 2 ** 20)} MB`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [site, dist = 'dist'] = process.argv.slice(2);
  if (!site) throw new Error('usage: node scripts/keep-assets.mjs <live site URL> [dist]');
  await main(site, dist);
}
