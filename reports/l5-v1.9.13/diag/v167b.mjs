// V-167 on v1.9.13: Cutout and Hide faces in the worker once the model's files are downloaded (one session, tried twice).
import { connect, sleep } from '../../../scripts/l5-session.mjs';
const c = await connect({ url: 'https://timofeys22.github.io/Kadr/', out: new URL('.', import.meta.url).pathname });
const pressed = () => c.js("const t = [...document.querySelectorAll('.toolbar .tool')].find((e) => (e.querySelector(':scope > span:not(.ck-sr)')?.textContent ?? '').trim() === 'Cutout'); return t?.getAttribute('aria-pressed') === 'true';");
const said = () => c.js("return [...document.querySelectorAll('.toast')].map((e) => e.textContent.slice(0, 90))");
async function cutout(n) {
  await c.selectClip();
  const t = Date.now();
  await c.tool('Cutout');
  for (;;) {
    await sleep(500);
    const s = await said(), p = await pressed();
    if (p || s.some((x) => /Background removed|did not load|No person/.test(x)) || Date.now() - t > 180_000) return { try: n, s: (Date.now() - t) / 1000, pressed: p, said: s };
  }
}
try {
  await c.fresh(['person.jpg']);
  const first = await cutout(1);
  await sleep(4000);
  const second = first.pressed ? null : await cutout(2);
  await c.selectClip();
  let t = Date.now();
  await c.tool('Hide faces');
  await c.tap('Hide faces automatically');
  const faces = await c.waitFor('faces', () => c.checked('Hide faces automatically'), 180_000).then(() => (Date.now() - t) / 1000, () => null);
  console.log(JSON.stringify({ first, second, facesS: faces, scripts: await c.js("return [...document.scripts].map((s) => s.src).filter((s) => /vision/.test(s)).length"), notes: (await c.page()).notes }));
} finally { await c.close(); }
