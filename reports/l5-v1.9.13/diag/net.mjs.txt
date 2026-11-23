// Does the phone reach the vision files of v1.9.13 from the page? (the worker fetches the same URLs)
import { connect } from '../../../scripts/l5-session.mjs';
const c = await connect({ url: 'https://timofeys22.github.io/Kadr/', out: new URL('.', import.meta.url).pathname });
try {
  await c.home();
  const r = await c.jsAsync(`const done = arguments[arguments.length - 1];
    (async () => {
      const t0 = performance.now();
      const chunks = performance.getEntriesByType('resource').map((e) => e.name).filter((n) => /\\/assets\\/.*\\.js$/.test(n));
      const found = new Set();
      for (const u of chunks) { const s = await (await fetch(u)).text(); for (const m of s.matchAll(/["'\`]([^"'\`]*?(?:selfie_segmenter|blaze_face_short_range|vision_wasm_internal)[^"'\`]*?\\.(?:tflite|wasm|js))["'\`]/g)) found.add(m[1]); }
      const out = [];
      for (const f of found) { const u = new URL(f.replace(/^\\//, ''), location.href.replace(/[^/]*$/, '') + 'assets/').href; const t = performance.now();
        try { const res = await fetch(f.startsWith('http') ? f : new URL(f, location.href).href); const b = await res.arrayBuffer(); out.push({ f, status: res.status, kb: Math.round(b.byteLength / 1024), ms: Math.round(performance.now() - t) }); } catch (e) { out.push({ f, error: String(e) }); } }
      return { chunks: chunks.length, found: [...found], out, ms: Math.round(performance.now() - t0) };
    })().then(done, (e) => done({ error: String(e) }));`);
  console.log(JSON.stringify(r, null, 1));
} finally { await c.close(); }
