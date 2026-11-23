// The phone fetches the vision files of v1.9.13 from the page: are they reachable and how fast?
import { connect } from '../../../scripts/l5-session.mjs';
const c = await connect({ url: 'https://timofeys22.github.io/Kadr/', out: new URL('.', import.meta.url).pathname });
try {
  await c.home();
  const r = await c.jsAsync(`const done = arguments[arguments.length - 1];
    (async () => { const out = [];
      for (const f of ['selfie_segmenter-DF05sdL4.tflite', 'blaze_face_short_range-CYqvruwv.tflite', 'vision_wasm_internal-DuEsUYlF.wasm', 'vision_wasm_internal-DfxxaBYC.js', 'vision_bundle-ChhAqqm4.js']) {
        const t = performance.now();
        try { const res = await fetch('/Kadr/assets/' + f); const b = await res.arrayBuffer(); out.push({ f, status: res.status, kb: Math.round(b.byteLength / 1024), ms: Math.round(performance.now() - t) }); } catch (e) { out.push({ f, error: String(e), ms: Math.round(performance.now() - t) }); } }
      return out; })().then(done, (e) => done({ error: String(e) }));`);
  console.log(JSON.stringify(r));
} finally { await c.close(); }
