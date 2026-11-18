// Diagnosis of V-167 on v1.9.13: what the Cutout and Hide faces tools do on the phone (no verdict, facts only).
import { connect, sleep } from '../../../scripts/l5-session.mjs';
const c = await connect({ url: 'https://timofeys22.github.io/Kadr/', out: new URL('.', import.meta.url).pathname });
const state = (name) => c.js(`const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => (e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? '').trim() === arguments[0]);
  if (!t) return null; const cs = getComputedStyle(t); return { disabled: t.disabled, ariaDisabled: t.getAttribute('aria-disabled'), pressed: t.getAttribute('aria-pressed'), on: t.hasAttribute('data-on'), opacity: cs.opacity, title: t.title, cls: t.className };`, name);
try {
  await c.fresh(['person.jpg']);
  await c.selectClip();
  const before = await state('Cutout');
  await c.tool('Cutout');
  const seen = [];
  for (let i = 0; i < 24; i++) {
    await sleep(2500);
    seen.push(await c.js("return { t: Math.round(performance.now()), veil: document.querySelector('.busy')?.textContent?.slice(0, 120) ?? null, toasts: [...document.querySelectorAll('.toast')].map((e) => e.textContent.slice(0, 100)), workers: performance.getEntriesByType('resource').filter((r) => /worker|vision|segment|mediapipe|tflite|wasm/i.test(r.name)).map((r) => r.name.split('/').pop() + ' ' + Math.round(r.duration) + 'ms').slice(-8) }"));
    if ((await state('Cutout'))?.pressed === 'true') break;
  }
  const page = await c.page();
  await c.shot('v167-diag');
  console.log(JSON.stringify({ before, after: await state('Cutout'), seen: seen.slice(-4), errors: page.errors, warns: page.warns.slice(-10), notes: page.notes, scripts: await c.js("return [...document.scripts].map((s) => s.src).filter((s) => /vision/.test(s))") }, null, 1));
} finally { await c.close(); }
