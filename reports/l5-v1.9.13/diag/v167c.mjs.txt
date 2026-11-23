// V-167 on v1.9.13: what Kadr logged when Cutout failed, and a second Cutout a minute later in the same page.
import { connect, sleep } from '../../../scripts/l5-session.mjs';
const c = await connect({ url: 'https://timofeys22.github.io/Kadr/', out: new URL('.', import.meta.url).pathname });
const log = () => c.jsAsync(`const done = arguments[arguments.length - 1]; const o = indexedDB.open('kadr-log');
  o.onsuccess = () => { try { const r = o.result.transaction('log').objectStore('log').getAll(); r.onsuccess = () => done(r.result); r.onerror = () => done([]); } catch (e) { done([]); } }; o.onerror = () => done([]);`);
const pressed = () => c.js("const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => (e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? '').trim() === 'Cutout'); return t?.getAttribute('aria-pressed') === 'true';");
async function cutout(n) {
  const errorsBefore = (await log()).length;
  await c.js("document.querySelectorAll('.toast button[aria-label=\"Close\"]').forEach((b) => b.click())");
  await sleep(800);
  await c.selectClip();
  const t = Date.now();
  await c.tool('Cutout');
  for (;;) {
    await sleep(500);
    const errs = await log();
    if (await pressed()) return { try: n, s: (Date.now() - t) / 1000, ok: true };
    if (errs.length > errorsBefore) return { try: n, s: (Date.now() - t) / 1000, ok: false, logged: errs.slice(errorsBefore) };
    if (Date.now() - t > 180_000) return { try: n, s: 180, ok: false, logged: 'nothing in 180 s' };
  }
}
try {
  await c.fresh(['person.jpg']);
  const first = await cutout(1);
  await sleep(60_000);
  const second = await cutout(2);
  const wasm = await c.js("return performance.getEntriesByType('resource').filter((r) => /vision|tflite|wasm/.test(r.name)).map((r) => r.name.split('/').pop() + ' ' + Math.round(r.duration) + 'ms')");
  console.log(JSON.stringify({ first, second, pageResources: wasm }, null, 1));
} finally { await c.close(); }
