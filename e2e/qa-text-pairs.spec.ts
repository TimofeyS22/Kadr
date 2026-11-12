// A text set in several faces (docs/18 ADR-П1, П2): each paragraph drawn in its own look by the video's renderer.
// The old styles drawing exactly as before is e2e/qa-text-raster.spec.ts; here, what is new.
// Needs the dev server (it imports the renderer's modules): E2E_URL=http://localhost:5273/ npx playwright test qa-text-pairs
import { expect, test } from '@playwright/test';

test('a pair: each paragraph in its own face, tucked by its gap; captions ignore the looks; every face is loaded first', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  const dev = await page.evaluate(async () => (await fetch('/src/engine/text.ts')).ok);
  test.skip(!dev, 'needs the dev server: the renderer is imported from its source');

  const r = await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const [{ TextRasterizer, ensureFont }, { createTextClip, createCaptionClip, createProject }, { visualLayer }, { CAPTION_PRESETS }] = await Promise.all([
      imp('/src/engine/text.ts'), imp('/src/core/defaults.ts'), imp('/src/core/frame.ts'), imp('/src/core/presets.ts'),
    ]);
    type Style = Record<string, unknown>;
    type D = { image: HTMLCanvasElement; w: number; h: number } | null;
    const raster = new TextRasterizer(256);
    const base: Style = { font: 'montserrat', size: 0.05, weight: 400, italic: false, color: '#ffffff', align: 'center', stroke: null, background: null, shadow: false };
    const accent = { font: 'lobster', scale: 2.4 };
    const support = (font: string) => ({ font, scale: 0.5, uppercase: true, letterSpacing: 0.5 });
    const text = 'Лето\nв городе';
    const draw = async (style: Style, t = text): Promise<D> => {
      const c = createTextClip(0, t);
      c.style = style;
      await ensureFont(style, t);
      return raster.get(c, Infinity, 1080, 1920);
    };
    const rows = (d: D, from: number, to: number) => {
      const px = d!.image.getContext('2d')!.getImageData(0, Math.floor(from * d!.h), d!.w, Math.max(1, Math.floor((to - from) * d!.h))).data;
      let sum = 0;
      for (let i = 3; i < px.length; i += 4) sum = (sum * 31 + px[i] * (i + 1)) % 2147483647;
      return sum;
    };
    const ink = (d: D) => { const px = d!.image.getContext('2d')!.getImageData(0, 0, d!.w, d!.h).data; let n = 0; for (let i = 3; i < px.length; i += 4) if (px[i] > 128) n++; return n; };

    const single = await draw(base);
    const pairA = await draw({ ...base, lines: [accent, support('montserrat')] });
    const pairB = await draw({ ...base, lines: [accent, support('mono')] });
    const tucked = await draw({ ...base, lines: [accent, { ...support('montserrat'), gap: -0.6 }] });
    const huge = await draw({ ...base, lines: [{ ...accent, scale: 1e4 }, support('montserrat')] }, 'Я\nты');
    const faces = (fam: string) => [...document.fonts].filter((f) => f.family.replace(/["']/g, '') === fam).map((f) => f.status);
    // Which face the canvas was asked to draw each piece of text with: the pixels alone cannot tell it, because the
    // places of the words already follow the widths of their own faces.
    const drawnWith: [string, string, number][] = [];
    const proto = CanvasRenderingContext2D.prototype, fill = proto.fillText, strokeT = proto.strokeText;
    proto.fillText = function (this: CanvasRenderingContext2D, t: string, x: number, y: number, m?: number) { drawnWith.push([t, this.font, x]); return fill.call(this, t, x, y, m); };
    proto.strokeText = function (this: CanvasRenderingContext2D, t: string, x: number, y: number, m?: number) { drawnWith.push([t, this.font, x]); return strokeT.call(this, t, x, y, m); };
    const fresh = new TextRasterizer(4), probe = createTextClip(0, text);
    probe.style = { ...base, lines: [accent, support('mono')] };
    fresh.get(probe, Infinity, 1080, 1920);
    proto.fillText = fill;
    proto.strokeText = strokeT;
    const accentFaces = [...new Set(drawnWith.filter(([t]) => t === 'Лето').map(([, f]) => f))];
    const supportFaces = [...new Set(drawnWith.filter(([t]) => /^[ВГОРДЕ]$/.test(t)).map(([, f]) => f))];
    // The words of the support line stand one space of its own face apart, not of the accent's.
    const xs = (ch: string) => drawnWith.filter(([t]) => t === ch).map(([, , x]) => x);
    const m = document.createElement('canvas').getContext('2d')!;
    m.font = supportFaces[0] ?? '';
    const ls = 0.5 * 0.05 * 0.5 * 1920;
    const wordGap = { drawn: xs('Г')[0] - xs('В')[0], own: m.measureText('В').width + m.measureText(' ').width + 2 * ls };

    // A caption whose style carries looks draws as the same caption without them.
    const p = createProject('pairs', '9:16');
    const words = ['Смотри', 'до', 'конца'].map((t, i) => ({ t0: i * 0.5, t1: i * 0.5 + 0.45, text: t }));
    const cap = (style: Style) => {
      const c = createCaptionClip(words, CAPTION_PRESETS[0]);
      c.style = { ...c.style, ...style };
      const l = visualLayer(p, c, c.start + 0.9);
      return l.source.kind === 'caption' ? raster.getCaption(l.source, 1080, 1920) : null;
    };
    await ensureFont(CAPTION_PRESETS[0].style, 'Смотри до конца');
    const capPlain = cap({}), capLooks = cap({ lines: [accent, support('mono')] });

    return {
      single: [single!.w, single!.h], pairA: [pairA!.w, pairA!.h], pairB: [pairB!.w, pairB!.h], tucked: tucked!.h, huge: [huge!.w, huge!.h],
      topSame: rows(pairA, 0, 0.55) === rows(pairB, 0, 0.55), bottomDiffers: rows(pairA, 0.62, 1) !== rows(pairB, 0.62, 1),
      differsFromSingle: rows(pairA, 0, 1) !== rows(single, 0, 1) || pairA!.h !== single!.h, inkA: ink(pairA),
      captionSame: capPlain!.w === capLooks!.w && capPlain!.h === capLooks!.h && rows(capPlain, 0, 1) === rows(capLooks, 0, 1),
      lobster: faces('Lobster'), mono: faces('Roboto Mono'), accentFaces, supportFaces, wordGap,
    };
  });
  console.log(JSON.stringify(r));
  // The accent is 2.4 sizes, the support half a size: the pair is taller than the same text in one face.
  expect(r.pairA[1]).toBeGreaterThan(r.single[1]);
  expect(r.differsFromSingle).toBe(true);
  expect(r.inkA).toBeGreaterThan(5000);
  // Changing the face of the second paragraph changes only its band: the first is drawn in its own face, untouched.
  expect(r.pairA[0], 'the accent sets the width of both').toBe(r.pairB[0]);
  expect(r.topSame, 'the accent line is the same in both').toBe(true);
  expect(r.bottomDiffers, 'the support line follows its own face').toBe(true);
  expect(r.accentFaces.length, 'the accent word is drawn').toBeGreaterThan(0);
  expect(r.accentFaces.every((f) => f.includes('Lobster')), `accent drawn with ${r.accentFaces.join(' | ')}`).toBe(true);
  expect(r.supportFaces.length, 'the support letters are drawn').toBeGreaterThan(0);
  expect(r.supportFaces.every((f) => f.includes('Roboto Mono')), `support drawn with ${r.supportFaces.join(' | ')}`).toBe(true);
  expect(Math.abs(r.wordGap.drawn - r.wordGap.own), `words of the support line ${r.wordGap.drawn} px apart, its own space gives ${r.wordGap.own}`).toBeLessThan(2);
  // A gap below zero tucks the support into the accent.
  expect(r.tucked).toBeLessThan(r.pairA[1]);
  // A scale from a file is held at 3 sizes: no canvas of 10⁸ pixels.
  expect(r.huge[0] * r.huge[1]).toBeLessThan(1080 * 1920 * 2);
  expect(r.captionSame, 'captions draw as if the style had no looks').toBe(true);
  expect(r.lobster, 'the accent face was loaded before drawing').toContain('loaded');
  expect(r.mono, 'the support face was loaded before drawing').toContain('loaded');
});

test('a long accent is set smaller, never broken between words, above or below the support; typed out letter by letter it keeps its size', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  const dev = await page.evaluate(async () => (await fetch('/src/engine/text.ts')).ok);
  test.skip(!dev, 'needs the dev server: the renderer is imported from its source');
  const r = await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const [{ TextRasterizer, ensureFont }, { createTextClip }] = await Promise.all([imp('/src/engine/text.ts'), imp('/src/core/defaults.ts')]);
    const raster = new TextRasterizer(64);
    const text = 'С днём рождения\nАня · 25';
    const style = {
      font: 'tenor', size: 0.05, weight: 400, italic: false, color: '#ffffff', align: 'center', stroke: null, background: null, shadow: false,
      lines: [{ font: 'yeseva', scale: 2.4 }, { font: 'tenor', scale: 0.6, uppercase: true, letterSpacing: 0.15 }],
    };
    const clip = createTextClip(0, text);
    clip.style = style;
    await ensureFont(style, text);
    type D = { image: HTMLCanvasElement; w: number; h: number };
    /** Runs of rows with letters in them, top to bottom: one per line of text. */
    const bands = (d: D) => {
      const px = d.image.getContext('2d')!.getImageData(0, 0, d.w, d.h).data;
      const out: [number, number][] = [];
      let start = -1;
      for (let y = 0; y < d.h; y++) {
        let ink = false;
        for (let x = 0; x < d.w && !ink; x++) ink = px[(y * d.w + x) * 4 + 3] > 128;
        if (ink && start < 0) start = y;
        if (!ink && start >= 0) { out.push([start, y]); start = -1; }
      }
      if (start >= 0) out.push([start, d.h]);
      return out.filter(([a, b]) => b - a > 2);
    };
    const full = raster.get(clip, Infinity, 1080, 1920) as D;
    const typed = raster.get(clip, 9, 1080, 1920) as D; // «С днём ро»
    // «Поменять местами»: the support over the accent. The accent is the paragraph of the largest look, wherever it is.
    const swapped = createTextClip(0, 'Аня · 25\nС днём рождения');
    swapped.style = { ...style, lines: [...style.lines].reverse() };
    const sw = raster.get(swapped, Infinity, 1080, 1920) as D;
    return { w: full.w, full: bands(full), typed: bands(typed), swapped: bands(sw), sw: sw.w };
  });
  console.log(JSON.stringify(r));
  expect(r.full.length, 'the accent on one line and the support under it').toBe(2);
  expect(r.swapped.length, 'swapped: the support on one line and the accent under it, unbroken').toBe(2);
  expect(r.sw, 'swapped, the block fits the frame').toBeLessThanOrEqual(1080);
  expect(r.w, 'the block fits the frame').toBeLessThanOrEqual(1080);
  const height = ([a, b]: [number, number]) => b - a;
  expect(Math.abs(height(r.typed[0]) - height(r.full[0])), 'half typed, the accent keeps the size of the whole text').toBeLessThanOrEqual(2);
});

test('a script accent keeps white between its words («С днём», not «Сднём»); text in one face is drawn as before', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  const dev = await page.evaluate(async () => (await fetch('/src/engine/text.ts')).ok);
  test.skip(!dev, 'needs the dev server: the renderer is imported from its source');
  const r = await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const [{ TextRasterizer, ensureFont }, { createTextClip }] = await Promise.all([imp('/src/engine/text.ts'), imp('/src/core/defaults.ts')]);
    const raster = new TextRasterizer(64);
    type D = { image: HTMLCanvasElement; w: number; h: number };
    /** The widest run of empty columns between the first and the last inked column of the rows [y0, y1). */
    const widestGap = (d: D, y0: number, y1: number) => {
      const px = d.image.getContext('2d')!.getImageData(0, 0, d.w, d.h).data;
      const ink = (x: number) => { for (let y = y0; y < y1; y++) if (px[(y * d.w + x) * 4 + 3] > 96) return true; return false; };
      let first = -1, last = -1, run = 0, widest = 0;
      for (let x = 0; x < d.w; x++) if (ink(x)) { if (first < 0) first = x; last = x; }
      for (let x = first; x <= last; x++) { run = ink(x) ? 0 : run + 1; widest = Math.max(widest, run); }
      return widest;
    };
    const base = { font: 'tenor', size: 0.05, weight: 400, italic: false, color: '#ffffff', align: 'center', stroke: null, background: null, shadow: false };
    const out: Record<string, number> = {};
    // The accent alone in its face (2 × 0.05 × 1920 = 192 px) and the same accent over a support.
    for (const font of ['pacifico', 'lobster']) {
      const one = { ...base, font, size: 0.1 };
      const pair = { ...base, lines: [{ font, scale: 2 }, { font: 'tenor', scale: 0.5, uppercase: true }] };
      for (const [k, style, text] of [['one', one, 'С днём'], ['pair', pair, 'С днём\nАня']] as const) {
        const c = createTextClip(0, text);
        c.style = style;
        await ensureFont(style, text);
        const d = raster.get(c, Infinity, 1080, 1920) as D;
        out[`${font}-${k}`] = widestGap(d, 0, k === 'one' ? d.h : Math.round(d.h * 0.62)) / 192;
      }
    }
    return out;
  });
  console.log(JSON.stringify(r));
  // Without the rule (control): 0.16–0.17 in Pacifico, 0.16 in Lobster. One face stays as the face sets it (the raster archive
  // of old styles holds that pixel for pixel), so the pair is wider than it.
  for (const font of ['pacifico', 'lobster']) {
    expect(r[`${font}-pair`], `${font}: white between the words of the accent, in sizes`).toBeGreaterThanOrEqual(0.18);
    expect(r[`${font}-pair`] - r[`${font}-one`], `${font}: wider than in one face`).toBeGreaterThan(0.04);
  }
});

test('under a long accent the support stays readable and smaller than the accent (the art director, round 3)', async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto('./');
  const dev = await page.evaluate(async () => (await fetch('/src/engine/text.ts')).ok);
  test.skip(!dev, 'needs the dev server: the renderer is imported from its source');
  const r = await page.evaluate(async () => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const [{ TextRasterizer, ensureFont }, { createTextClip }] = await Promise.all([imp('/src/engine/text.ts'), imp('/src/core/defaults.ts')]);
    const raster = new TextRasterizer(64);
    type D = { image: HTMLCanvasElement; w: number; h: number };
    const bands = (d: D) => {
      const px = d.image.getContext('2d')!.getImageData(0, 0, d.w, d.h).data;
      const out: [number, number][] = [];
      let start = -1;
      for (let y = 0; y < d.h; y++) {
        let ink = false;
        for (let x = 0; x < d.w && !ink; x++) ink = px[(y * d.w + x) * 4 + 3] > 128;
        if (ink && start < 0) start = y;
        if (!ink && start >= 0) { out.push([start, y]); start = -1; }
      }
      if (start >= 0) out.push([start, d.h]);
      return out.filter(([a, b]) => b - a > 2);
    };
    const base = { font: 'ysabeau', size: 0.055, weight: 400, italic: false, color: '#ffffff', align: 'center', stroke: null, background: null, shadow: false };
    const out: Record<string, number[]> = {};
    for (const [k, lines] of [
      ['tender', [{ font: 'greatVibes', scale: 2.3 }, { font: 'ysabeau', scale: 0.5, uppercase: true, letterSpacing: 0.25 }]],
      ['bold', [{ font: 'dela', scale: 1.9, uppercase: true }, { font: 'notoSerif', italic: true, scale: 0.65 }]],
    ] as const) {
      const text = 'Достопримечательности\nПетербурга';
      const c = createTextClip(0, text);
      c.style = { ...base, lines };
      await ensureFont(c.style, text);
      const d = raster.get(c, Infinity, 1080, 1920) as D;
      const b = bands(d);
      out[k] = [b.length, (b[0][1] - b[0][0]) / 1920 * 100, (b.at(-1)![1] - b.at(-1)![0]) / 1920 * 100, d.w];
    }
    return out;
  });
  console.log(JSON.stringify(r));
  for (const [k, [lines, accent, support, w]] of Object.entries(r)) {
    expect(lines, `${k}: the accent on one line, the support under it`).toBe(2);
    expect(w, `${k}: the block fits the frame`).toBeLessThanOrEqual(1080);
    // Set with the block the support was 0.5–0.8% of the frame high; read on a phone it needs more.
    expect(support, `${k}: the support's ink, % of the frame`).toBeGreaterThanOrEqual(1.1);
    expect(support, `${k}: smaller than the accent`).toBeLessThan(accent);
  }
});
