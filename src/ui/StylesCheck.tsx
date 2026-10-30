// Template check (`?styles`, v1.5): every caption template and text style drawn by this device's own text renderer at
// export size, on white, black, grey and a busy picture, in Russian and in English. For each: how well the letters
// stand out from what is right around them (edge contrast), whether its face has both alphabets, and how long one
// drawing takes. Not linked from the app; e2e reads `window.__kadrStyles`, the owner can open it on a phone (docs/12
// rule 1: the device decides).
import { useEffect, useRef, useState } from 'react';
import { captionLayout } from '../core/captions';
import { createCaptionClip, createProject, createTextClip } from '../core/defaults';
import { visualLayer } from '../core/frame';
import { CAPTION_PRESETS, TEXT_PRESETS } from '../core/presets';
import { FONT_IDS, type CaptionClip, type FontId, type TextClip, type TextStyle } from '../core/types';
import { FONTS, TextRasterizer, ensureFont, type CaptionState } from '../engine/text';

export interface StyleRow {
  kind: 'caption' | 'text'; id: string; lang: 'ru' | 'en';
  /** Edge contrast, 10th percentile over the letters' surroundings (WCAG ratio), per background. */
  edge: Record<Background, number>;
  /** Time of one drawing, ms (its best sample; the worse of two moments: settled, and a word coming in): at 1080 × 1920 (export)
   * and at 540 × 960 (the preview of a 9:16 project on a phone, 375 pt × 3). */
  ms: number;
  msPreview: number;
}
export interface FontRow { id: FontId; cyrillic: string; latin: string }
export interface StylesReport { done: boolean; rows: StyleRow[]; fonts: FontRow[]; userAgent: string }

const BACKGROUNDS = ['white', 'black', 'grey', 'busy'] as const;
type Background = (typeof BACKGROUNDS)[number];
const H = 1920;
const SAMPLE = { ru: ['Смотри', 'до', 'конца', 'ёжик'], en: ['Wait', 'for', 'it', 'quickly'] } as const;
const CYRILLIC = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдеёжзийклмнопрстуфхцчшщъыьэюя';
const LATIN = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

const lum = (r: number, g: number, b: number) => {
  const lin = (c: number) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
};

/** Paints a background: plain, or a fixed pattern of bright and dark blocks (any colour may sit behind a caption). */
function paintBackground(ctx: CanvasRenderingContext2D, bg: Background, w: number, h: number): void {
  if (bg !== 'busy') { ctx.fillStyle = bg === 'white' ? '#ffffff' : bg === 'black' ? '#000000' : '#808080'; ctx.fillRect(0, 0, w, h); return; }
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const cell = 10;
  for (let y = 0; y < h; y += cell) for (let x = 0; x < w; x += cell) {
    ctx.fillStyle = `hsl(${Math.floor(rnd() * 360)} ${60 + rnd() * 40}% ${10 + rnd() * 80}%)`;
    ctx.fillRect(x, y, cell, cell);
  }
}

/**
 * For every pixel just outside the letters (within `r` pixels of them, not their own antialiased edge), the nearest
 * letter pixel: what the eye compares to tell the letter from its surroundings. Two chamfer passes, O(pixels).
 */
function edgeMap(mask: Uint8ClampedArray, w: number, h: number, r: number): Int32Array {
  const n = w * h, near = new Int32Array(n).fill(-1), dist = new Float32Array(n).fill(Infinity);
  // Solid letter pixels only: an antialiased edge pixel is part letter, part surroundings.
  for (let i = 0; i < n; i++) if (mask[i * 4 + 3] >= 250) { near[i] = i; dist[i] = 0; }
  const step = (i: number, j: number, d: number) => { if (dist[j] + d < dist[i]) { dist[i] = dist[j] + d; near[i] = near[j]; } };
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x;
    if (x > 0) step(i, i - 1, 1);
    if (y > 0) { step(i, i - w, 1); if (x > 0) step(i, i - w - 1, 1.414); if (x < w - 1) step(i, i - w + 1, 1.414); }
  }
  for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
    const i = y * w + x;
    if (x < w - 1) step(i, i + 1, 1);
    if (y < h - 1) { step(i, i + w, 1); if (x < w - 1) step(i, i + w + 1, 1.414); if (x > 0) step(i, i + w - 1, 1.414); }
  }
  const out = new Int32Array(n).fill(-1);
  for (let i = 0; i < n; i++) if (dist[i] > 0 && dist[i] <= r && mask[i * 4 + 3] < 8) out[i] = near[i];
  return out;
}

/** 10th percentile of the contrast between each pixel around the letters and the letter pixel nearest to it. */
function edgeContrast(img: Uint8ClampedArray, ring: Int32Array): number {
  const c: number[] = [];
  for (let i = 0; i < ring.length; i++) {
    const j = ring[i];
    if (j < 0) continue;
    const a = lum(img[i * 4], img[i * 4 + 1], img[i * 4 + 2]), b = lum(img[j * 4], img[j * 4 + 1], img[j * 4 + 2]);
    c.push((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05));
  }
  if (!c.length) return 0;
  c.sort((x, y) => x - y);
  return c[Math.floor(c.length * 0.1)];
}


type Draw = (r: TextRasterizer, mask: boolean, moment: number, h?: number) => ReturnType<TextRasterizer['get']>;

/**
 * One drawing's time at frame height `h`, ms: the best of 5 samples of 4 drawings each (WebKit's clock ticks in whole
 * milliseconds; other work on the device only adds time, so the best sample is the drawing's own cost), the worse of
 * the two moments.
 */
function timed(draw: Draw, h: number): number {
  const worst: number[] = [];
  for (const moment of [0, 1]) {
    const times: number[] = [];
    for (let k = 0; k < 5; k++) {
      const t0 = performance.now();
      for (let j = 0; j < 4; j++) {
        const d = draw(new TextRasterizer(), false, moment, h);
        // Canvas drawing is deferred (GPU): reading a pixel back waits until the drawing is really done.
        if (d) (d.image as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 1, 1);
      }
      times.push((performance.now() - t0) / 4);
    }
    worst.push(Math.min(...times));
  }
  return Math.round(Math.max(...worst) * 100) / 100;
}

async function checkOne(kind: 'caption' | 'text', id: string, lang: 'ru' | 'en', style: TextStyle, draw: Draw): Promise<{ row: StyleRow; thumb: HTMLCanvasElement | null }> {
  await ensureFont(style, SAMPLE[lang].join(' '));
  draw(new TextRasterizer(), false, 1); // warm-up: the first drawing of a face also loads it into the canvas
  const ms = timed(draw, H), msPreview = timed(draw, H / 2);
  const raster = new TextRasterizer();
  const d = draw(raster, false, 0), m = draw(raster, true, 0);
  const edge = Object.fromEntries(BACKGROUNDS.map((b) => [b, 0])) as Record<Background, number>;
  let thumb: HTMLCanvasElement | null = null;
  if (d && m) {
    const w = d.w, h = d.h;
    const mc = document.createElement('canvas');
    mc.width = w; mc.height = h;
    const mx = mc.getContext('2d', { willReadFrequently: true })!;
    mx.drawImage(m.image as CanvasImageSource, 0, 0);
    const ring = edgeMap(mx.getImageData(0, 0, w, h).data, w, h, Math.max(3, Math.round(0.04 * style.size * H)));
    for (const b of BACKGROUNDS) {
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d', { willReadFrequently: true })!;
      paintBackground(ctx, b, w, h);
      ctx.drawImage(d.image as CanvasImageSource, 0, 0);
      edge[b] = Math.round(edgeContrast(ctx.getImageData(0, 0, w, h).data, ring) * 100) / 100;
      if (b === 'busy') thumb = c;
    }
  }
  return { row: { kind, id, lang, edge, ms, msPreview }, thumb };
}

/** Which letters of an alphabet a font draws itself: a letter whose width does not change with the fallback face. */
function missing(family: string, weight: number, letters: string): string {
  const ctx = document.createElement('canvas').getContext('2d')!;
  const own = family.split(',').filter((f) => f.includes('"')).join(',');
  const width = (fallback: string, ch: string) => { ctx.font = `${weight} 64px ${own}, ${fallback}`; return ctx.measureText(ch).width; };
  return [...letters].filter((ch) => width('monospace', ch) !== width('serif', ch)).join('');
}

export function StylesCheck() {
  const [report, setReport] = useState<StylesReport>({ done: false, rows: [], fonts: [], userAgent: navigator.userAgent });
  const thumbs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let live = true;
    void (async () => {
      const fonts: FontRow[] = [];
      for (const id of FONT_IDS as readonly FontId[]) {
        const f = FONTS[id];
        const st: TextStyle = { font: id, size: 0.05, weight: 400, italic: false, color: '#fff', align: 'center', stroke: null, background: null, shadow: false };
        for (const weight of f.weights) await ensureFont({ ...st, weight: weight as TextStyle['weight'] }, CYRILLIC + LATIN);
        fonts.push({ id, cyrillic: missing(f.family, f.weights[0], CYRILLIC), latin: missing(f.family, f.weights[0], LATIN) });
      }
      const rows: StyleRow[] = [];
      const p = createProject('styles', '9:16');
      const add = (thumb: HTMLCanvasElement | null, label: string) => {
        if (!thumb || !thumbs.current) return;
        const fig = document.createElement('figure');
        const c = document.createElement('canvas');
        const s = Math.min(1, 320 / thumb.width);
        c.width = Math.round(thumb.width * s); c.height = Math.round(thumb.height * s);
        c.getContext('2d')!.drawImage(thumb, 0, 0, c.width, c.height);
        const cap = document.createElement('figcaption');
        cap.textContent = label;
        fig.append(c, cap);
        thumbs.current.append(fig);
      };
      for (const lang of ['ru', 'en'] as const) {
        const words = SAMPLE[lang];
        for (const pr of CAPTION_PRESETS) {
          // Word by word shows one word: the longest makes the hardest case.
          const clip: CaptionClip = createCaptionClip(words.map((text, i) => ({ t0: i * 0.5, t1: i * 0.5 + 0.45, text })), pr);
          const one = captionLayout(clip) === 'word';
          // Settled (the second word lit, the third half sung) and a word coming in (0.1 s after it started).
          const at = (moment: number) => (one ? 1.5 + 0.2 : moment ? 1.0 + 0.1 : 0.5 + 0.4);
          const draw: Draw = (r, mask, moment, h = H) => {
            const l = visualLayer(p, clip, clip.start + at(moment));
            return l.source.kind === 'caption' ? r.getCaption(l.source as CaptionState, (h * 9) / 16, h, mask) : null;
          };
          const { row, thumb } = await checkOne('caption', pr.id, lang, pr.style, draw);
          rows.push(row);
          add(thumb, `${pr.id} ${lang}: ${BACKGROUNDS.map((b) => row.edge[b].toFixed(1)).join(' / ')}, ${row.ms} / ${row.msPreview} ms`);
          if (!live) return;
          setReport({ done: false, rows: [...rows], fonts, userAgent: navigator.userAgent });
        }
        for (const pr of TEXT_PRESETS) {
          const clip: TextClip = createTextClip(0, words.slice(0, 2).join(' '));
          clip.style = structuredClone(pr.style);
          // A mask is the same text with only the letters' fill drawn: a caption state with no words lit.
          const draw: Draw = (r, mask, _moment, h = H) => r.get(clip, Infinity, (h * 9) / 16, h, mask);
          const { row, thumb } = await checkOne('text', pr.id, lang, pr.style, draw);
          rows.push(row);
          add(thumb, `${pr.id} ${lang}: ${BACKGROUNDS.map((b) => row.edge[b].toFixed(1)).join(' / ')}, ${row.ms} / ${row.msPreview} ms`);
        }
      }
      if (live) setReport({ done: true, rows, fonts, userAgent: navigator.userAgent });
    })();
    return () => { live = false; };
  }, []);
  useEffect(() => { (window as unknown as { __kadrStyles: StylesReport }).__kadrStyles = report; }, [report]);

  const weak = report.rows.filter((r) => Math.min(...BACKGROUNDS.map((b) => r.edge[b])) < 3);
  const slowest = [...report.rows].sort((a, b) => b.ms - a.ms).slice(0, 3);
  const text = [
    `Kadr ${__APP_VERSION__} · ${report.userAgent}`,
    `${report.rows.length} drawings${report.done ? '' : ' (running…)'}; edge contrast under 3: ${weak.map((r) => `${r.kind}:${r.id}:${r.lang}`).join(', ') || 'none'}`,
    `slowest (export / preview size): ${slowest.map((r) => `${r.id} ${r.ms} / ${r.msPreview} ms`).join(', ')}`,
    `fonts missing letters: ${report.fonts.filter((f) => f.cyrillic || f.latin).map((f) => `${f.id} [${f.cyrillic}${f.latin}]`).join(', ') || 'none'}`,
  ].join('\n');
  return (
    <main className="diag">
      <h1>Kadr: templates</h1>
      <pre data-testid="styles-summary">{text}</pre>
      <button className="btn" onClick={() => void navigator.clipboard?.writeText(`${text}\n${report.rows.map((r) => `${r.kind} ${r.id} ${r.lang} ${BACKGROUNDS.map((b) => r.edge[b]).join(' ')} ${r.ms} ${r.msPreview}`).join('\n')}`)}>Copy report</button>
      <div ref={thumbs} className="styles-thumbs" />
    </main>
  );
}
