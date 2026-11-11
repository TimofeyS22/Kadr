// The strokes of a pair survive a video (docs/18 Ш6): the letters' mask, drawn by the renderer at the default size in a
// 720p and a 1080p export, keeps most of its ink through a morphological opening by a disc 2 px across, which is what
// thin hairlines lose first when a picture is compressed. The share is calibrated by a control a pair must beat:
// Montserrat at weight 100, which no pair uses, set as a pair the same way.
// Needs the dev server (it imports the renderer): E2E_URL=http://localhost:5273/ npx playwright test qa-pairs-stroke
import { expect, test } from '@playwright/test';

test('every pair keeps its strokes through a 2 px opening at 720p and 1080p, unlike a weight-100 control', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('./');
  const dev = await page.evaluate(async () => (await fetch('/src/engine/text.ts')).ok);
  test.skip(!dev, 'needs the dev server: the renderer is imported from its source');
  const r = await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const [{ TextRasterizer, ensureFont }, { createTextClip }, { PAIRS, pairStyle }] = await Promise.all([imp('/src/engine/text.ts'), imp('/src/core/defaults.ts'), imp('/src/core/pairs.ts')]);
    // The control: Montserrat 100, registered as a font of one's own would be.
    for (const sub of ['latin', 'cyrillic']) {
      const f = new FontFace('Kadr Custom thin', `url(/node_modules/@fontsource/montserrat/files/montserrat-${sub}-100-normal.woff2)`, { weight: '100 900' });
      document.fonts.add(await f.load());
    }
    /** Share of the ink left after an opening (erosion, then dilation) by a 3 × 3 disc: a stroke under ~2 px is lost. */
    const kept = (c: HTMLCanvasElement) => {
      const w = c.width, h = c.height, a = c.getContext('2d')!.getImageData(0, 0, w, h).data;
      const ink = new Uint8Array(w * h);
      for (let i = 0; i < w * h; i++) ink[i] = a[i * 4 + 3] > 128 ? 1 : 0;
      const pass = (src: Uint8Array, keep: (n: number) => boolean) => {
        const out = new Uint8Array(w * h);
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x;
          const n = src[i] + src[i - 1] + src[i + 1] + src[i - w] + src[i + w];
          out[i] = keep(n) ? 1 : 0;
        }
        return out;
      };
      const opened = pass(pass(ink, (n) => n === 5), (n) => n > 0);
      let before = 0, after = 0;
      for (let i = 0; i < w * h; i++) { before += ink[i]; after += opened[i] & ink[i]; }
      return before ? after / before : 0;
    };
    const base = createTextClip(0, '').style;
    const measure = async (style: Record<string, unknown>, text: string) => {
      const clip = createTextClip(0, text);
      clip.style = style;
      await ensureFont(style, text);
      const out: Record<string, number> = {};
      for (const H of [1280, 1920]) {
        const d = new TextRasterizer(8).get(clip, Infinity, (H * 9) / 16, H, true);
        out[H] = Math.round(kept(d.image) * 1000) / 1000;
      }
      return out;
    };
    const pairs: Record<string, Record<string, number>> = {};
    for (const p of PAIRS) pairs[p.id] = await measure(pairStyle(p, base), p.sample.ru);
    const control = await measure({ ...base, font: 'custom:thin', weight: 400, shadow: false, lines: [{ font: 'custom:thin', scale: 2 }, { font: 'custom:thin', scale: 0.5, uppercase: true, letterSpacing: 0.25 }] }, 'Нежность\nутро в Питере');
    return { pairs, control };
  });
  console.log(JSON.stringify(r));
  const worstControl = Math.max(r.control[1280], r.control[1920]);
  // The bar, calibrated on 2026-11-12 (Chromium, WebKit): at the default size the weight-100 control keeps 0.85–0.88 of
  // its ink, every pair 0.96–0.999; the bar sits between them.
  const BAR = 0.93;
  expect(worstControl, 'the control must fail the bar, or the bar proves nothing').toBeLessThan(BAR);
  const weak = Object.entries(r.pairs).flatMap(([id, v]) => Object.entries(v).filter(([, k]) => k < BAR).map(([H, k]) => `${id} at ${H}p: ${k}`));
  expect(weak, 'pairs whose strokes a compressed video would lose').toEqual([]);
});
