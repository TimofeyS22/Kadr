// Text raster archive (docs/18 Ш7, N10): every text style and caption template drawn in the states a renderer change can
// break, hashed pixel by pixel. The inputs are frozen in `e2e/raster/archive.json` (clips as HEAD made them before the
// multi-font engine, docs/18 П2), so a later change of a preset does not move the baseline; the hashes are per engine
// (`hashes-<browser>.json`), because each engine rasterises glyphs its own way.
//   RASTER_ARCHIVE=1 — make the archive from the presets of this checkout (only before П2, or for a new archive).
//   RASTER_UPDATE=1  — write the hashes of this checkout as the baseline.
// Needs the dev server (it imports the renderer's modules): E2E_URL=http://localhost:5273/ npx playwright test qa-text-raster
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const DIR = path.join(import.meta.dirname, 'raster');
const ARCHIVE = path.join(DIR, 'archive.json');

interface Archive { made: string; texts: Record<string, string>; captionWords: Record<string, string[]>; moments: number[]; textClips: unknown[]; captionClips: unknown[] }

test('every text style and caption template draws exactly as the archive baseline (docs/18 Ш7)', async ({ page, browserName }) => {
  test.setTimeout(300_000);
  await page.goto('./');
  const dev = await page.evaluate(async () => (await fetch('/src/engine/text.ts')).ok);
  test.skip(!dev, 'needs the dev server: the renderer is imported from its source');

  if (process.env.RASTER_ARCHIVE) {
    const made = await page.evaluate(async () => {
      const imp = (p: string) => import(/* @vite-ignore */ p);
      const [{ CAPTION_PRESETS, TEXT_PRESETS }, { createCaptionClip, createTextClip }] = await Promise.all([imp('/src/core/presets.ts'), imp('/src/core/defaults.ts')]);
      type Style = Record<string, unknown>;
      const base: Style = TEXT_PRESETS[0].style;
      // Variants of the classic style that reach the branches a per-line engine rewrites.
      const extra: Style[] = [
        { ...base, background: { color: '#000000', opacity: 0.7, lines: true, padding: 0.4, radius: 0.5 } },
        { ...base, gradient: '#ff2d92' },
        { ...base, copies: [{ color: '#ff2d92', x: 0.08, y: 0.08, depth: true }] },
        { ...base, copies: [{ color: '#00e5ff', x: -0.05, y: 0 }, { color: '#ff2d92', x: 0.05, y: 0 }] },
        { ...base, italic: true, font: 'playfair' },
        { ...base, uppercase: true, letterSpacing: 0.2 },
        { ...base, align: 'left', lineHeight: 0.9 },
        { ...base, align: 'right', lineHeight: 1.8 },
        { ...base, stroke: { color: '#000000', width: 0.1 }, outline2: { color: '#ffffff', width: 0.16 } },
        { ...base, shadowColor: '#ffd60a' },
        { ...base, gradient: '#00e5ff', background: { color: '#ffffff', opacity: 0.9 } },
      ];
      const textClips = [...TEXT_PRESETS.map((p: { style: Style }) => p.style), ...extra].map((style) => {
        const c = createTextClip(0, '');
        c.style = structuredClone(style);
        return c;
      });
      const captionWords = { ru: ['Смотри', 'до', 'конца', 'ёжик'], en: ['Wait', 'for', 'it', 'quickly'] };
      const captionClips = (['ru', 'en'] as const).flatMap((lang) => CAPTION_PRESETS.map((pr: unknown) =>
        createCaptionClip(captionWords[lang].map((text, i) => ({ t0: i * 0.5, t1: i * 0.5 + 0.45, text })), pr)));
      return { textClips, captionClips, captionWords };
    });
    const archive: Archive = {
      made: 'HEAD before the multi-font text engine (docs/18 П2)',
      texts: {
        one: 'Тёплый день',
        two: 'Тёплый день\nв Питере',
        three: 'С днём\nрождения,\nАня!',
        wrap: 'Жёлтые листья кружатся над тихой рекой в Петербурге, и это лучший день осени',
        en: 'Golden hour vlog\nParis · 990 ₽ · 30%',
      },
      captionWords: made.captionWords,
      moments: [0.25, 0.9, 1.1, 1.7],
      textClips: made.textClips,
      captionClips: made.captionClips,
    };
    fs.mkdirSync(DIR, { recursive: true });
    fs.writeFileSync(ARCHIVE, `${JSON.stringify(archive)}\n`);
  }

  const archive = JSON.parse(fs.readFileSync(ARCHIVE, 'utf8')) as Archive;
  const hashes = await page.evaluate(async (a: Archive) => {
    const imp = (p: string) => import(/* @vite-ignore */ p);
    const [{ TextRasterizer, ensureFont }, { visualLayer }, { createProject }] = await Promise.all([imp('/src/engine/text.ts'), imp('/src/core/frame.ts'), imp('/src/core/defaults.ts')]);
    const r = new TextRasterizer(4096);
    const out: Record<string, string> = {};
    const hash = async (d: { image: HTMLCanvasElement; w: number; h: number } | null): Promise<string> => {
      if (!d) return 'none';
      const px = d.image.getContext('2d')!.getImageData(0, 0, d.image.width, d.image.height).data;
      const sum = new Uint8Array(await crypto.subtle.digest('SHA-256', px));
      return `${d.w}x${d.h}:${Array.from(sum.slice(0, 10), (b) => b.toString(16).padStart(2, '0')).join('')}`;
    };
    type Clip = { style: unknown; text: string };
    for (const [i, c] of (a.textClips as Clip[]).entries()) {
      for (const [v, text] of Object.entries(a.texts)) {
        const clip = { ...c, text };
        await ensureFont(clip.style, text);
        out[`t${i}:${v}`] = await hash(r.get(clip, Infinity, 540, 960));
        if (v === 'two') {
          out[`t${i}:${v}:1920`] = await hash(r.get(clip, Infinity, 1080, 1920));
          out[`t${i}:${v}:typewriter`] = await hash(r.get(clip, Math.floor([...text].length / 2), 540, 960));
          out[`t${i}:${v}:mask`] = await hash(r.get(clip, Infinity, 540, 960, true));
        }
      }
    }
    const p = createProject('raster', '9:16');
    type Cap = { style: unknown; start: number; words: { text: string }[] };
    for (const [j, c] of (a.captionClips as Cap[]).entries()) {
      await ensureFont(c.style, c.words.map((w) => w.text).join(' '));
      for (const m of a.moments) {
        const l = visualLayer(p, c, c.start + m);
        const st = l.source.kind === 'caption' ? l.source : null;
        out[`c${j}:${m}`] = st ? await hash(r.getCaption(st, 540, 960)) : 'none';
        if (m === 0.9) out[`c${j}:${m}:mask`] = st ? await hash(r.getCaption(st, 540, 960, true)) : 'none';
      }
    }
    return out;
  }, archive);

  const file = path.join(DIR, `hashes-${browserName}.json`);
  if (process.env.RASTER_UPDATE || process.env.RASTER_ARCHIVE) {
    fs.writeFileSync(file, `${JSON.stringify(hashes, null, 1)}\n`);
    console.log(`baseline: ${Object.keys(hashes).length} drawings (${browserName})`);
    return;
  }
  const base = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, string>;
  const changed = Object.keys(base).filter((k) => hashes[k] !== base[k]);
  console.log(`${Object.keys(hashes).length} drawings, ${changed.length} changed (${browserName})`);
  expect(Object.keys(hashes).sort()).toEqual(Object.keys(base).sort());
  expect(changed, 'drawings that differ from the archive baseline').toEqual([]);
});
