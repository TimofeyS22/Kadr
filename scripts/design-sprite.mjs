// Design pages in reports/ (docs/17): fills <!--SPRITE-->…<!--/SPRITE--> with the lucide icons the page uses (ISC) and the two
// drawn frames, so the page needs no icon CDN.   node scripts/design-sprite.mjs reports/chetko-two-marks.html
import fs from 'node:fs';
import path from 'node:path';
const file = process.argv[2];
const ICONS = path.join(import.meta.dirname, '..', 'node_modules', 'lucide-react', 'dist', 'esm', 'icons') + path.sep;
let html = fs.readFileSync(file, 'utf8');
const extra = (html.match(/<!--ICONS: ([^>]*)-->/)?.[1] ?? '').trim().split(/\s+/).filter(Boolean);
const names = [...new Set([...[...html.matchAll(/data-i="([a-z0-9-]+)"/g), ...html.matchAll(/href="#i-([a-z0-9-]+)"/g), ...html.matchAll(/\['[А-Яа-яЁё -]+', '([a-z0-9-]+)'/g)].map((m) => m[1]), ...extra])].sort();
let out = '<svg width="0" height="0" style="position:absolute" aria-hidden="true">';
for (const n of names) {
  let mod = await import(ICONS + n + '.mjs');
  if (!mod.__iconData) { const to = fs.readFileSync(ICONS + n + '.mjs', 'utf8').match(/from '\.\/([a-z0-9-]+)\.mjs'/); mod = await import(ICONS + to[1] + '.mjs'); }
  const body = mod.__iconData.node.map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${v}"`).join(' ')}/>`).join('');
  out += `<symbol id="i-${n}" viewBox="0 0 24 24">${body}</symbol>`;
}
// A night street out of focus with a sharp figure in front: the subject of the name.
const bokeh = (list) => list.map(([x, y, r, c, o]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${c}" fill-opacity="${o * 0.7}" stroke="${c}" stroke-opacity="${Math.min(1, o * 1.5)}" stroke-width=".5"/>`).join('');
out += `<symbol id="shot" viewBox="0 0 90 160"><defs><linearGradient id="n1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#0b1524"/><stop offset=".55" stop-color="#182a44"/><stop offset="1" stop-color="#090c13"/></linearGradient><linearGradient id="n2" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ffb070" stop-opacity="0"/><stop offset="1" stop-color="#ffb070"/></linearGradient></defs><rect width="90" height="160" fill="url(#n1)"/>${bokeh([[14, 30, 9, '#ffb36b', 0.35], [34, 22, 6, '#6fd3ff', 0.3], [58, 34, 11, '#ff7a59', 0.3], [78, 24, 7, '#ffd9a0', 0.4], [70, 58, 9, '#8fa8ff', 0.28], [10, 66, 7, '#6fd3ff', 0.25], [26, 52, 5, '#ffd9a0', 0.45], [84, 82, 8, '#ffb36b', 0.3], [6, 96, 10, '#ff7a59', 0.22], [48, 14, 4, '#ffffff', 0.35], [62, 76, 4, '#ffd9a0', 0.4]])}<path d="M12 160C12 130 26 119 45 119s33 11 33 41Z" fill="#07090d"/><rect x="39" y="104" width="12" height="18" fill="#0a0c11"/><ellipse cx="45" cy="92" rx="13.5" ry="16.5" fill="#0b0d12"/><path d="M57.500 82q4 10-.5 21" fill="none" stroke="#ffb070" stroke-width="1.100" stroke-linecap="round"/><path d="M58 121q15 5 19 30" fill="none" stroke="url(#n2)" stroke-width="1.200" stroke-linecap="round"/></symbol>`;
out += `<symbol id="shot2" viewBox="0 0 90 160"><defs><linearGradient id="d1" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3b2a1d"/><stop offset=".5" stop-color="#a8683a"/><stop offset="1" stop-color="#1d130d"/></linearGradient></defs><rect width="90" height="160" fill="url(#d1)"/>${bokeh([[20, 26, 10, '#ffe2a8', 0.4], [52, 18, 7, '#fff3d6', 0.45], [74, 40, 12, '#ffc46b', 0.35], [8, 58, 8, '#ffd9a0', 0.3], [40, 48, 5, '#ffffff', 0.4], [84, 74, 6, '#ffe2a8', 0.35], [62, 64, 4, '#fff3d6', 0.5]])}<path d="M0 124h90v36H0Z" fill="#120c08"/><ellipse cx="45" cy="118" rx="22" ry="7" fill="#f1e7d8"/><ellipse cx="45" cy="116" rx="16" ry="4.500" fill="#b8442a"/><path d="M38 100q2-6 0-12M46 98q2-7 0-14M54 100q2-6 0-12" fill="none" stroke="#fff3d6" stroke-width="1" stroke-linecap="round" opacity=".5"/></symbol>`;
out += '</svg>';
html = html.replace(/<!--SPRITE-->[\s\S]*?<!--\/SPRITE-->/, `<!--SPRITE-->${out}<!--/SPRITE-->`);
fs.writeFileSync(file, html);
console.log(names.length + ' icons');
