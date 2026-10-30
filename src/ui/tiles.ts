// Live previews for the template pickers (v1.5), drawn by the same code as the video: buildFrame's caption and text
// layers and the TextRasterizer. A tile shows the template on a demo phrase in the interface language.
import { createCaptionClip, createProject, createTextClip } from '../core/defaults';
import { visualLayer } from '../core/frame';
import type { CaptionPreset, TextPreset } from '../core/presets';
import type { CaptionClip, TextClip, TextStyle } from '../core/types';
import { ensureFont, fontCss, TextRasterizer, type Drawable } from '../engine/text';
import { t, useLocale } from '../lib/i18n';
import { DEMO_LOOP_S, type TileDraw } from './picker';

/** The demo frame a template is drawn for (9:16, a third of 1080p: sharp enough for a 104 px tile). */
const W = 360, H = 640;
const raster = new TextRasterizer(160);
const project = createProject('demo', '9:16');

/** Fonts in use: a template draws only once its own font is in, never with a fallback face. */
const fonts = new Map<string, true | Promise<void>>();
function fontReady(style: TextStyle, text: string, redraw: () => void): boolean {
  const key = `${fontCss(style, 32)}|${text}`;
  const f = fonts.get(key);
  if (f === true) return true;
  if (!f) fonts.set(key, ensureFont(style, text).then(() => { fonts.set(key, true); redraw(); }));
  return false;
}

/** Draws `d` centred, `fit` canvas heights per pixel of the demo frame, moved and faded as its layer is. */
function put(canvas: HTMLCanvasElement, d: Drawable | null, fit: number, layer?: { x: number; y: number; scale: number; rotation: number; opacity: number }, base?: { x: number; y: number }): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!d || !fit) return;
  const s = fit * canvas.height;
  ctx.globalAlpha = Math.max(0, Math.min(1, layer?.opacity ?? 1));
  ctx.translate(canvas.width / 2 + ((layer?.x ?? 0) - (base?.x ?? 0)) * W * s, canvas.height / 2 + ((layer?.y ?? 0) - (base?.y ?? 0)) * H * s);
  ctx.rotate(((layer?.rotation ?? 0) * Math.PI) / 180);
  ctx.scale(s * (layer?.scale ?? 1), s * (layer?.scale ?? 1));
  ctx.drawImage(d.image as CanvasImageSource, -d.w / 2, -d.h / 2); // text drawings are canvases
  ctx.globalAlpha = 1;
}

// ---------- Captions ----------

/** Three words, 0.45 s each, after a short pause: the loop shows the line (or each word) coming in again. */
const LEAD = 0.3;
const demoWords = () => (useLocale.getState().locale === 'ru' ? ['Смотри', 'до', 'конца'] : ['Wait', 'for', 'it']);
const clips = new Map<string, { clip: CaptionClip; w: number; h: number }>();

function demo(pr: CaptionPreset): { clip: CaptionClip; w: number; h: number } {
  const words = demoWords();
  const key = `${pr.id}|${words.join(' ')}`;
  let c = clips.get(key);
  if (!c) {
    const clip = createCaptionClip(words.map((text, i) => ({ t0: LEAD + i * 0.5, t1: LEAD + i * 0.5 + 0.45, text })), pr);
    // One size for the whole loop, from the largest settled line, so the text never jumps between words.
    let w = 1, h = 1;
    for (let at = 0.44; at < DEMO_LOOP_S - LEAD; at += 0.5) {
      const l = visualLayer(project, clip, clip.start + at);
      const d = l.source.kind === 'caption' ? raster.getCaption({ ...l.source, enter: 1, fill: 1, shown: l.source.words.length }, W, H) : null;
      if (d) { w = Math.max(w, d.w); h = Math.max(h, d.h); }
    }
    c = { clip, w, h };
    clips.set(key, c);
  }
  return c;
}

/** A caption template on its demo phrase at demo time `time`, as the video draws it (motion, highlight, karaoke). */
export const drawCaptionTile: TileDraw<CaptionPreset> = (pr, canvas, time, redraw) => {
  const words = demoWords();
  if (!fontReady(pr.style, words.join(' '), redraw)) { put(canvas, null, 0); return; }
  const { clip, w, h } = demo(pr);
  const layer = visualLayer(project, clip, time);
  const d = layer.source.kind === 'caption' ? raster.getCaption(layer.source, W, H) : null;
  put(canvas, d, Math.min(0.88 / h, (0.9 * canvas.width) / canvas.height / w), layer, { x: clip.transform.x.v, y: clip.transform.y.v });
};

// ---------- Text ----------

const texts = new Map<string, TextClip>();
/** A text style on a short word, after its entrance. */
export const drawTextTile: TileDraw<TextPreset> = (pr, canvas, _time, redraw) => {
  const word = t('Hello');
  if (!fontReady(pr.style, word, redraw)) { put(canvas, null, 0); return; }
  const key = `${pr.id}|${word}`;
  let clip = texts.get(key);
  if (!clip) { clip = createTextClip(0, word); clip.style = structuredClone(pr.style); texts.set(key, clip); }
  const d = raster.get(clip, Infinity, W, H);
  if (!d) return;
  put(canvas, d, Math.min(0.8 / d.h, (0.86 * canvas.width) / canvas.height / d.w));
};
