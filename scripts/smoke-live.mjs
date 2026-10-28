// After a deploy (docs/12, deploy skew): the live site serves the new version, and every file of the generations
// assets-manifest.json keeps is there, so a tab opened before the deploy finds its code.
//   node scripts/smoke-live.mjs <live site URL> [expected version]
// Pages takes a moment to switch over, and its CDN keeps answers up to 10 minutes (a query string does not get past
// it): the new manifest is waited for up to 11 minutes.
const [site, version] = process.argv.slice(2);
if (!site) throw new Error('usage: node scripts/smoke-live.mjs <live site URL> [expected version]');
const base = site.endsWith('/') ? site : `${site}/`;
const get = (p) => fetch(base + p, { cache: 'no-store' });

let manifest;
for (let i = 0; ; i++) {
  const res = await get('assets-manifest.json');
  manifest = res.ok ? await res.json() : null;
  if (manifest && (!version || manifest.generations[0]?.version === version)) break;
  if (i >= 66) throw new Error(`smoke: the live site does not serve ${version ?? 'a manifest'} after 11 minutes`);
  await new Promise((r) => setTimeout(r, 10_000));
}
const index = await (await get('index.html')).text();
const entry = /src="[^"]*assets\/([^"]+\.js)"/.exec(index)?.[1];
if (!entry || !manifest.generations[0].files.some((f) => (f.name ?? f) === entry)) throw new Error(`smoke: index.html names ${entry}, not a file of ${manifest.generations[0].version}`);
const files = [...new Set(manifest.generations.flatMap((g) => g.files.map((f) => f.name ?? f)))];
const bad = [];
for (let i = 0; i < files.length; i += 16) {
  await Promise.all(files.slice(i, i + 16).map(async (f) => {
    const res = await fetch(`${base}assets/${f}`, { method: 'HEAD', cache: 'no-store' });
    if (!res.ok) bad.push(`${f} ${res.status}`);
  }));
}
for (const p of ['sw.js', 'manifest.webmanifest']) if (!(await get(p)).ok) bad.push(p);
if (bad.length) throw new Error(`smoke: ${bad.length} files missing on the live site: ${bad.slice(0, 10).join(', ')}`);
console.log(`smoke: ${manifest.generations[0].version} live, ${files.length} files of ${manifest.generations.length} generations served`);
