// Live previews for the template pickers (v1.5), drawn by the same code as the video: buildFrame's caption and text
// layers and the TextRasterizer. A tile shows the template on a demo phrase in the interface language.
import { demoCaptionTime, demoCaptionWords, demoSettledTimes } from '../core/captionDemo';
import { createCaptionClip, createProject, createTextClip } from '../core/defaults';
import { visualLayer } from '../core/frame';
import { splitForPair, type FontPair } from '../core/pairs';
import type { CaptionPreset } from '../core/presets';
import { PLACEHOLDERS } from '../core/previewWord';
import type { CaptionClip, CaptionWord, TextClip, TextStyle } from '../core/types';
import { ensureFont, fontCss, lookStyle, TextRasterizer, type Drawable } from '../engine/text';
import { useLocale } from '../lib/i18n';
import type { TileDraw } from './picker';

/** The demo frame a template is drawn for (9:16, a third of 1080p: sharp enough for a 104 px tile). */
const W = 360, H = 640;
const raster = new TextRasterizer(160);
const project = createProject('demo', '9:16');

/**
 * Fonts in use: a template draws only once its own font is in, never with a fallback face. Every tile that asked while
 * the face was loading is drawn again (before, only the first: the style «Love» stayed empty while the font tile of
 * Lobster, on the same word, waited for the same face).
 */
const fonts = new Map<string, true | Set<() => void>>();
function fontReady(style: TextStyle, text: string, redraw: () => void): boolean {
  // Every face the text is set in: two pairs on one support but different accents must not share a «ready».
  const key = [fontCss(style, 32), ...(style.lines ?? []).map((l) => fontCss(lookStyle(style, l), 32)), text].join('|');
  const f = fonts.get(key);
  if (f === true) return true;
  if (f) { f.add(redraw); return false; }
  const waiting = new Set([redraw]);
  fonts.set(key, waiting);
  void ensureFont(style, text).then(() => { fonts.set(key, true); for (const again of waiting) again(); });
  return false;
}

/** Draws `d` centred, `fit` canvas heights per pixel of the demo frame, moved and faded as its layer is. */
function put(canvas: HTMLCanvasElement, d: Drawable | null, fit: number, layer?: { x: number; y: number; scale: number; rotation: number; opacity: number }, base?: { x: number; y: number }): void {
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!d || !fit) { delete canvas.dataset.ready; return; }
  canvas.dataset.ready = '1';
  const s = fit * canvas.height;
  ctx.globalAlpha = Math.max(0, Math.min(1, layer?.opacity ?? 1));
  ctx.translate(canvas.width / 2 + ((layer?.x ?? 0) - (base?.x ?? 0)) * W * s, canvas.height / 2 + ((layer?.y ?? 0) - (base?.y ?? 0)) * H * s);
  ctx.rotate(((layer?.rotation ?? 0) * Math.PI) / 180);
  ctx.scale(s * (layer?.scale ?? 1), s * (layer?.scale ?? 1));
  ctx.drawImage(d.image as CanvasImageSource, -d.w / 2, -d.h / 2); // text drawings are canvases
  ctx.globalAlpha = 1;
}

// ---------- Captions ----------

/** Three words, then the settled line held to the end of the loop: a tile is never empty (core/captionDemo). */
const demoWords = () => (useLocale.getState().locale === 'ru' ? ['Смотри', 'до', 'конца'] : ['Wait', 'for', 'it']);
const clips = new Map<string, { clip: CaptionClip; words: CaptionWord[]; w: number; h: number }>();

function demo(pr: CaptionPreset): { clip: CaptionClip; words: CaptionWord[]; w: number; h: number } {
  const texts = demoWords();
  const key = `${pr.id}|${texts.join(' ')}`;
  let c = clips.get(key);
  if (!c) {
    const words = demoCaptionWords(texts);
    const clip = createCaptionClip(words, pr);
    // One size for the whole loop, from the largest settled line, so the text never jumps between words.
    let w = 1, h = 1;
    for (const at of demoSettledTimes(words)) {
      const l = visualLayer(project, clip, clip.start + at);
      const d = l.source.kind === 'caption' ? raster.getCaption({ ...l.source, enter: 1, fill: 1, shown: l.source.words.length }, W, H) : null;
      if (d) { w = Math.max(w, d.w); h = Math.max(h, d.h); }
    }
    c = { clip, words, w, h };
    clips.set(key, c);
  }
  return c;
}

/** A caption template on its demo phrase at loop time `time`, as the video draws it (motion, highlight, karaoke). */
export const drawCaptionTile: TileDraw<CaptionPreset> = (pr, canvas, time, redraw) => {
  const texts = demoWords();
  if (!fontReady(pr.style, texts.join(' '), redraw)) { put(canvas, null, 0); return; }
  const { clip, words, w, h } = demo(pr);
  const layer = visualLayer(project, clip, clip.start + demoCaptionTime(time, words));
  const d = layer.source.kind === 'caption' ? raster.getCaption(layer.source, W, H) : null;
  put(canvas, d, Math.min(0.88 / h, (0.9 * canvas.width) / canvas.height / w), layer, { x: clip.transform.x.v, y: clip.transform.y.v });
};

// ---------- Text ----------

let textsWord = '';
const texts = new Map<string, TextClip>();
/** A text clip of `style` on `word`, kept while the word stays (the tiles redraw it on every frame of their loop). */
function textOn(key: string, word: string, style: TextStyle): TextClip {
  if (word !== textsWord) { texts.clear(); textsWord = word; } // the person typed: the clips of the last word go
  let clip = texts.get(key);
  if (!clip) { clip = createTextClip(0, word); clip.style = style; texts.set(key, clip); }
  return clip;
}

/** A text style on the person's own word (`previewWord`), after its entrance. */
function textTile(word: string): TileDraw<{ id: string; style: TextStyle }> {
  return (pr, canvas, _time, redraw) => {
    if (!fontReady(pr.style, word, redraw)) { put(canvas, null, 0); return; }
    const d = raster.get(textOn(pr.id, word, structuredClone(pr.style)), Infinity, W, H);
    if (!d) return;
    put(canvas, d, Math.min(0.8 / d.h, (0.86 * canvas.width) / canvas.height / d.w));
  };
}

/** A tile of the text styles' strip: a style, or with the pairs flag a font pair (docs/18 Ф4). */
export interface LookItem { id: string; name: string; cat: string; style: TextStyle; pair?: FontPair }
const pairTexts = new Map<string, TextClip>();

/**
 * Styles on the person's word; a pair on the person's own text broken as the pair breaks it (its first words: a long
 * text would make a tile of dust), or on the pair's sample while the text is still the placeholder.
 */
export function lookTile(word: string, text: string, ru: boolean): TileDraw<LookItem> {
  const style = textTile(word);
  const words = text.trim().split(/\s+/).filter(Boolean);
  const own = !PLACEHOLDERS.includes(text.trim()) && words.length > 0;
  const short = words.reduce((a, w) => (a.length + w.length < 24 || !a ? (a ? `${a} ${w}` : w) : a), '');
  return (it, canvas, time, redraw) => {
    if (!it.pair) { style(it, canvas, time, redraw); return; }
    const shown = own ? splitForPair(text.includes('\n') ? text.split('\n').slice(0, 2).join('\n') : short, it.pair.split) : ru ? it.pair.sample.ru : it.pair.sample.en;
    if (!fontReady(it.style, shown, redraw)) { put(canvas, null, 0); return; }
    const key = `${it.id}|${shown}`;
    let clip = pairTexts.get(key);
    if (!clip) {
      if (pairTexts.size > 64) pairTexts.clear();
      clip = createTextClip(0, shown);
      clip.style = it.style;
      pairTexts.set(key, clip);
    }
    const d = raster.get(clip, Infinity, W, H);
    if (!d) return;
    put(canvas, d, Math.min(0.8 / d.h, (0.86 * canvas.width) / canvas.height / d.w));
  };
}

// ---------- Fonts ----------

/** What a font tile takes from the text's style: only how its letters are set, never its colours or outlines. */
export type FontTileLook = Pick<TextStyle, 'weight' | 'italic' | 'uppercase' | 'letterSpacing'>;
/** The word's size on a font tile, CSS px: from a cap height of ~13 px (a long word) to ~24 px (a short one). */
const FONT_TILE_PX = [18, 34] as const;
const FONT_TILE_PAD = 10;
/** The frame a font tile's word is set in: wide, so the word is never broken (at 360 px «рождения» in Unbounded broke
 *  into «рожде / ния», the renderer breaking a word wider than the frame). */
const FONT_TILE_W = 2000;
/** The letters of a new text: white, as the word will stand on the video by default. */
const NEW_TEXT = createTextClip(0, '').style;

/**
 * A font on the person's word in white, on the black of the stage round the frame (the tile's own ground, in CSS),
 * drawn by the video's renderer (docs/18; the owner, 2026-11-11: «серая обложка за шрифтами выглядит ужасно старо»).
 * Nothing until the face is in: a fallback face would lie about the font. A word too long at the smallest size starts at
 * the left and runs off the edge, without an ellipsis.
 */
export function fontTile(word: string, look: FontTileLook): TileDraw<{ id: string }> {
  return (it, canvas, _time, redraw) => {
    const style: TextStyle = {
      font: it.id as TextStyle['font'], size: 0.1, weight: look.weight, italic: look.italic, color: NEW_TEXT.color, align: 'left',
      stroke: null, background: null, shadow: false, uppercase: look.uppercase, letterSpacing: look.letterSpacing,
    };
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!fontReady(style, word, redraw)) { delete canvas.dataset.ready; return; }
    const d = raster.get(textOn(`font|${it.id}|${look.weight}|${+look.italic}|${+!!look.uppercase}|${look.letterSpacing ?? 0}`, word, style), Infinity, FONT_TILE_W, H);
    if (!d) return;
    const px = style.size * H, edge = px * 0.2; // the renderer's room round letters with no outline or box
    const dpr = canvas.width / Math.max(1, canvas.clientWidth);
    const room = canvas.width - 2 * FONT_TILE_PAD * dpr;
    const k = Math.max((FONT_TILE_PX[0] * dpr) / px, Math.min((FONT_TILE_PX[1] * dpr) / px, room / Math.max(1, d.w - 2 * edge)));
    const wide = (d.w - 2 * edge) * k > room;
    const x = wide ? FONT_TILE_PAD * dpr - edge * k : (canvas.width - d.w * k) / 2;
    ctx.drawImage(d.image as CanvasImageSource, x, (canvas.height - d.h * k) / 2, d.w * k, d.h * k);
    canvas.dataset.ready = '1';
  };
}