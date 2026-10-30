import { bigScale, motionAt, motionGrow, wordRoles, type WordRole } from '../core/captions';
import { readableOn } from '../core/color';
import { saneStyle } from '../core/style';
import type { LayerSource } from '../core/frame';
import type { CaptionEmphasis, CaptionMotion, CustomFontId, FontId, TextClip, TextStyle } from '../core/types';

/** Single-channel alpha mask (e.g. person segmentation) aligned with the drawable's pixels. */
export interface SegMask { data: Uint8Array; w: number; h: number; key: string }
export interface Drawable {
  image: TexImageSource; w: number; h: number; key: string; seg?: SegMask;
  /** A stand-in frame (keyframe while scrubbing); the exact frame is rendered next. */
  approx?: boolean;
  /** Detected faces in UV space (for layers that hide faces). */
  faces?: import('../core/types').Rect[];
}

export type FontGroup = 'sans' | 'display' | 'serif' | 'script' | 'mono';

/** Bundled fonts (all with Cyrillic; Anton and Bebas borrow Cyrillic letters from Oswald). */
export const FONTS: Record<FontId, { label: string; family: string; weights: readonly number[]; group: FontGroup }> = {
  inter: { label: 'Inter', family: '"Inter", system-ui, sans-serif', weights: [400, 700, 900], group: 'sans' },
  montserrat: { label: 'Montserrat', family: '"Montserrat", system-ui, sans-serif', weights: [400, 700, 900], group: 'sans' },
  rubik: { label: 'Rubik', family: '"Rubik", system-ui, sans-serif', weights: [400, 700, 900], group: 'sans' },
  nunito: { label: 'Nunito', family: '"Nunito", system-ui, sans-serif', weights: [400, 700, 900], group: 'sans' },
  raleway: { label: 'Raleway', family: '"Raleway", system-ui, sans-serif', weights: [400, 700, 900], group: 'sans' },
  exo: { label: 'Exo 2', family: '"Exo 2", system-ui, sans-serif', weights: [400, 700, 900], group: 'sans' },
  comfortaa: { label: 'Comfortaa', family: '"Comfortaa", system-ui, sans-serif', weights: [400, 700], group: 'sans' },
  unbounded: { label: 'Unbounded', family: '"Unbounded", Impact, sans-serif', weights: [400, 700, 900], group: 'display' },
  oswald: { label: 'Oswald', family: '"Oswald", Impact, sans-serif', weights: [400, 700], group: 'display' },
  anton: { label: 'Anton', family: '"Anton", "Oswald", Impact, sans-serif', weights: [400], group: 'display' },
  bebas: { label: 'Bebas', family: '"Bebas Neue", "Oswald", Impact, sans-serif', weights: [400], group: 'display' },
  russo: { label: 'Russo One', family: '"Russo One", Impact, sans-serif', weights: [400], group: 'display' },
  dela: { label: 'Dela Gothic', family: '"Dela Gothic One", Impact, sans-serif', weights: [400], group: 'display' },
  days: { label: 'Days One', family: '"Days One", Impact, sans-serif', weights: [400], group: 'display' },
  tektur: { label: 'Tektur', family: '"Tektur", Impact, sans-serif', weights: [400, 700, 900], group: 'display' },
  rubikMono: { label: 'Rubik Mono', family: '"Rubik Mono One", Impact, sans-serif', weights: [400], group: 'display' },
  glitch: { label: 'Glitch', family: '"Rubik Glitch", Impact, sans-serif', weights: [400], group: 'display' },
  bubbles: { label: 'Bubbles', family: '"Rubik Bubbles", Impact, sans-serif', weights: [400], group: 'display' },
  spray: { label: 'Spray', family: '"Rubik Spray Paint", Impact, sans-serif', weights: [400], group: 'display' },
  pixel: { label: 'Pixel', family: '"Press Start 2P", Impact, sans-serif', weights: [400], group: 'display' },
  playfair: { label: 'Playfair', family: '"Playfair Display", Georgia, serif', weights: [400, 700], group: 'serif' },
  lora: { label: 'Lora', family: '"Lora", Georgia, serif', weights: [400, 700], group: 'serif' },
  ptSerif: { label: 'PT Serif', family: '"PT Serif", Georgia, serif', weights: [400, 700], group: 'serif' },
  cormorant: { label: 'Cormorant', family: '"Cormorant Garamond", Georgia, serif', weights: [400, 700], group: 'serif' },
  yeseva: { label: 'Yeseva', family: '"Yeseva One", Georgia, serif', weights: [400], group: 'serif' },
  pacifico: { label: 'Pacifico', family: '"Pacifico", cursive', weights: [400], group: 'script' },
  lobster: { label: 'Lobster', family: '"Lobster", cursive', weights: [400], group: 'script' },
  caveat: { label: 'Caveat', family: '"Caveat", cursive', weights: [400, 700], group: 'script' },
  pangolin: { label: 'Pangolin', family: '"Pangolin", cursive', weights: [400], group: 'script' },
  marck: { label: 'Marck', family: '"Marck Script", cursive', weights: [400], group: 'script' },
  amatic: { label: 'Amatic', family: '"Amatic SC", cursive', weights: [400, 700], group: 'script' },
  mono: { label: 'Mono', family: '"Roboto Mono", ui-monospace, monospace', weights: [400, 700], group: 'mono' },
};

export type AnyFontId = FontId | CustomFontId;
export const customFamily = (id: string): string => `Kadr Custom ${id}`;
const CUSTOM = { weights: [100, 200, 300, 400, 500, 600, 700, 800, 900], group: 'sans' as FontGroup };

/** Font face info; user fonts map to their registered family, unknown ids (e.g. from a newer version) fall back. */
export function fontOf(id: AnyFontId): { label: string; family: string; weights: readonly number[]; group: FontGroup } {
  if (id.startsWith('custom:')) return { label: 'Custom', family: `"${customFamily(id.slice(7))}", system-ui, sans-serif`, ...CUSTOM };
  return FONTS[id as FontId] ?? FONTS.inter;
}

/** The available weight closest to the requested one, so browsers never fake bold. */
export function fontWeight(id: AnyFontId, wanted: number): number {
  return fontOf(id).weights.reduce((best, w) => (Math.abs(w - wanted) < Math.abs(best - wanted) ? w : best));
}

export const fontCss = (s: TextStyle, px: number): string =>
  `${s.italic ? 'italic ' : ''}${fontWeight(s.font, s.weight)} ${px}px ${fontOf(s.font).family}`;

const loaded = new Set<string>();
/**
 * Loads exactly the font files a text needs (Latin and/or Cyrillic subset) before it is drawn on canvas;
 * canvas drawing alone does not load web fonts, so without this the first frame would use a fallback font.
 */
export async function ensureFont(style: TextStyle, text: string): Promise<void> {
  const css = fontCss(style, 32);
  const key = `${css}|${/[\u0400-\u04ff]/.test(text) ? 'c' : ''}${/[a-z]/i.test(text) ? 'l' : ''}`;
  if (loaded.has(key)) return;
  await document.fonts.load(css, text || 'Aa').catch(() => undefined);
  // WebKit resolves load() before the font is whole on canvas (v1.4.9, QA: right after it the text measured a mix of
  // fallback and font, the font itself 0.5 s later), so an export after reopening a project drew Impact instead of
  // Rubik Mono. The family's faces for this weight and style are loaded directly and awaited.
  const family = fontOf(style.font).family.split(',')[0].replace(/["']/g, '').trim();
  const weight = fontWeight(style.font, style.weight), italic = style.italic ? 'italic' : 'normal';
  const fits = (w: string) => { const [a, b = a] = w.split(' ').map(Number); return weight >= a && weight <= b; };
  await Promise.all([...document.fonts]
    .filter((f) => f.family.replace(/["']/g, '') === family && f.style === italic && fits(f.weight))
    .map((f) => f.load().catch(() => undefined)));
  loaded.add(key);
}

/** Resolves when the UI font is usable. */
export function loadFonts(): Promise<unknown> {
  // Only the UI font up front; text fonts load on demand (ensureFont) so startup stays fast.
  const specs = ['400 32px "Inter"', '700 32px "Inter"', '900 32px "Inter"'];
  return Promise.all(specs.map((s) => document.fonts.load(s, 'Aa Яя').catch(() => undefined)));
}

export const TEXT_LINE_HEIGHT = 1.25;
export const TEXT_BG_PADDING = 0.35;

/** Width of a word with `ls` extra pixels between its letters (letters are then drawn one by one). */
function wordWidth(ctx: CanvasRenderingContext2D, w: string, ls: number): number {
  if (!ls) return ctx.measureText(w).width;
  const chars = [...w];
  return chars.reduce((a, ch) => a + ctx.measureText(ch).width, 0) + ls * (chars.length - 1);
}

function drawWord(ctx: CanvasRenderingContext2D, w: string, x: number, y: number, ls: number, stroke: boolean): void {
  if (!ls) { if (stroke) ctx.strokeText(w, x, y); else ctx.fillText(w, x, y); return; }
  for (const ch of w) {
    if (stroke) ctx.strokeText(ch, x, y); else ctx.fillText(ch, x, y);
    x += ctx.measureText(ch).width + ls;
  }
}

/** Graphemes, so a broken word never splits an emoji or a letter from its accent. */
const graphemes = (w: string): string[] => (typeof Intl.Segmenter === 'function'
  ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(w), (x) => x.segment) : [...w]);

/**
 * Word-wraps paragraphs; returns lines as lists of indices into `words`. A word wider than the line (a long word in
 * big letters, a hashtag, Chinese without spaces) is broken between letters instead of being cut off at the frame's
 * edges; `owner` maps each piece to the word it came from, counted across paragraphs (caption highlight and reveal).
 */
function layout(ctx: CanvasRenderingContext2D, paragraphs: string[][], maxW: number, ls: number): { words: string[]; owner: number[]; lines: number[][] } {
  const words: string[] = [];
  const owner: number[] = [];
  const lines: number[][] = [];
  let k = 0;
  for (const para of paragraphs) {
    let line: number[] = [];
    let text = '';
    const put = (w: string) => { line.push(words.length); words.push(w); owner.push(k); };
    for (const w of para) {
      if (wordWidth(ctx, w, ls) > maxW) {
        if (line.length) { lines.push(line); line = []; }
        let piece = '', pw = 0;
        for (const g of graphemes(w)) {
          const gw = wordWidth(ctx, g, ls) + (piece ? ls : 0);
          if (piece && pw + gw > maxW) { put(piece); lines.push(line); line = []; piece = g; pw = gw; }
          else { piece += g; pw += gw; }
        }
        put(piece);
        text = piece;
      } else {
        const next = text ? `${text} ${w}` : w;
        if (line.length && wordWidth(ctx, next, ls) > maxW) { lines.push(line); line = []; text = w; }
        else text = next;
        put(w);
      }
      k++;
    }
    lines.push(line);
  }
  return { words, owner, lines };
}

/** A caption at a moment, as the renderer needs it: the caption layer's source (core/frame). */
export type CaptionState = Pick<Extract<LayerSource, { kind: 'caption' }>, 'clip' | 'words' | 'active' | 'shown' | 'said' | 'fill' | 'enter'>;

/** How a caption's words look right now (v1.5): roles from core/captions, plus what the roles are drawn with. */
interface Look { roles: WordRole[]; highlight: string; emphasis?: CaptionEmphasis; motion: CaptionMotion; reveal: boolean; enter: number }
interface Pos { i: number; x: number; y: number; li: number }

/**
 * Renders text and captions to canvases sized in output pixels, LRU-cached by content and size.
 * Words are laid out one by one so a caption can highlight the word being spoken.
 */
export class TextRasterizer {
  private cache = new Map<string, Drawable | null>();
  /**
   * Canvases of drawings the cache let go, drawn on again: a karaoke fill draws a word many times, and iOS Safari counts
   * canvases still waiting for garbage collection against its canvas memory limit.
   */
  private spare: HTMLCanvasElement[] = [];
  /** Scratch canvases: the letters' silhouette (solid copies) and one word drawn on its own (a word that moves or fades). */
  private sil: HTMLCanvasElement | null = null;
  private stamp: HTMLCanvasElement | null = null;

  constructor(private readonly limit = 96) {}

  clear(): void { this.cache.clear(); }

  /** `mask`: only the letters' fill, in white, laid out exactly as the text (the readability check on ?styles). */
  get(clip: TextClip, chars: number, W: number, H: number, mask = false): Drawable | null {
    const text = Number.isFinite(chars) ? [...clip.text].slice(0, chars).join('') : clip.text;
    const paragraphs = text.split('\n').map((p) => p.split(/\s+/).filter(Boolean));
    return this.cached(mask ? [text, clip.style, W, H, mask] : [text, clip.style, W, H], () => this.render(paragraphs, clip.style, W, H, null, Infinity, mask));
  }

  /** `mask`: only the letters' fill, in white, laid out exactly as the caption (the readability check on ?styles). */
  getCaption(st: CaptionState, W: number, H: number, mask = false): Drawable | null {
    const { clip, words } = st;
    if (!words.length || st.shown <= 0) return null;
    const n = Math.min(st.shown, words.length);
    const roles = wordRoles(clip, words.length, st.active, st.said, st.fill, st.enter < 1);
    const look: Look = {
      roles, highlight: clip.highlight ?? '#ffffff', emphasis: clip.highlight ? clip.emphasis : undefined,
      motion: clip.motion ?? 'none', reveal: !!clip.reveal, enter: roles.some((r) => r.enter || r.big) ? st.enter : 1,
    };
    const key = [words, roles.map((r) => [r.lit, +r.box, +r.underline, +r.big, +r.dim, +r.enter].join('')), n, look.enter, clip.style, clip.highlight, look.emphasis ?? '', look.motion, look.reveal, W, H, mask];
    return this.cached(key, () => this.render([words], clip.style, W, H, look, n, mask));
  }

  private cached(keyParts: unknown[], make: () => Drawable | null): Drawable | null {
    const key = JSON.stringify(keyParts);
    if (this.cache.has(key)) {
      const hit = this.cache.get(key)!;
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const d = make();
    if (d) d.key = key;
    this.cache.set(key, d);
    if (this.cache.size > this.limit) {
      const old = this.cache.keys().next().value!;
      const gone = this.cache.get(old);
      this.cache.delete(old);
      // The compositor keeps its own copy (a texture), so a canvas the cache drops can be drawn on again.
      if (gone && gone.image instanceof HTMLCanvasElement && this.spare.length < 8) this.spare.push(gone.image);
    }
    return d;
  }

  private scratch(which: 'sil' | 'stamp', w: number, h: number): CanvasRenderingContext2D {
    const c = (this[which] ??= document.createElement('canvas'));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, w, h);
    return ctx;
  }

  /**
   * `shown`: only the first words are drawn (the rest keep their place in the layout, so the line never jumps).
   * Every size is a fraction of the font size, so the preview and the export (other pixel sizes) draw the same picture.
   */
  private render(paragraphs: string[][], style: TextStyle, W: number, H: number, look: Look | null, shown = Infinity, mask = false): Drawable | null {
    if (!paragraphs.some((p) => p.length)) return null;
    const s = saneStyle(style); // a style from a backup decides no canvas of 10⁵ px and no 10⁷ stamps
    const px = Math.max(4, s.size * H);
    const upper = (w: string) => (s.uppercase ? w.toLocaleUpperCase() : w);
    const paras = paragraphs.map((p) => p.map(upper));
    const canvas = this.spare.pop() ?? document.createElement('canvas');
    let ctx = canvas.getContext('2d')!;
    const font = fontCss(s, px);
    ctx.font = font;
    const ls = (s.letterSpacing ?? 0) * px;
    const bg = s.background;
    const bgPad = bg ? px * (bg.padding ?? TEXT_BG_PADDING) : 0;
    // A wide background padding narrows the lines, so the block still fits the frame.
    const { words, owner, lines } = layout(ctx, paras, Math.max(px * 2, W * 0.9 - 2 * Math.max(0, bgPad - px * TEXT_BG_PADDING)), ls);
    const stroke = s.stroke ? s.stroke.width * px : 0;
    const ring = stroke + (s.outline2 ? s.outline2.width * px : 0); // outer edge of the outlines
    // Thick outlines eat a narrow space (heavy faces have 0.19–0.2 em): words keep a visible gap; the bigger spoken
    // word gets room of its own.
    const sideways = Math.max(0, ...(s.copies ?? []).map((c) => Math.abs(c.x) * px)); // solid copies to the side fill the gap too
    const space = Math.max(ctx.measureText(' ').width + ls * 2, (ring + sideways) * 2 + px * 0.06) + (look?.emphasis === 'scale' ? px * 0.14 : 0);
    const wordW = words.map((w) => wordWidth(ctx, w, ls));
    const lineW = lines.map((l) => l.reduce((a, i) => a + wordW[i], 0) + space * Math.max(0, l.length - 1));
    const lineH = px * (s.lineHeight ?? TEXT_LINE_HEIGHT);
    const reach = Math.max(0, ...(s.copies ?? []).map((c) => Math.max(Math.abs(c.x), Math.abs(c.y)) * px));
    const glow = s.shadow && !!s.shadowColor;
    const pad = (bg ? bgPad : px * 0.2) + ring + reach + (glow ? px * 0.3 : 0);
    // Room for words drawn bigger or shifted than their place in the layout (a word that pops in, the bigger spoken word).
    // A long spoken word grows less (bigger), so it never covers its neighbours: at most ~0.2 font sizes a side.
    const big = (i: number) => 1 + (bigScale(look!.enter) - 1) * Math.min(1, (px * 1.2) / Math.max(1, wordW[i]));
    const grow = look?.reveal ? motionGrow(look.motion) : 1;
    const mx = (Math.max(0, ...wordW) * (grow - 1)) / 2 + (look?.reveal && look.motion === 'slide' ? px * 0.6 : 0) + (look?.emphasis === 'scale' ? px * 0.2 : 0);
    const my = px * (Math.max(grow, look?.emphasis === 'scale' ? bigScale(0) : 1) - 1) * 0.6 + (look?.reveal && look.motion === 'rise' ? px * 0.4 : 0);
    const w = Math.ceil(Math.max(1, ...lineW) + pad * 2 + mx * 2);
    const inner = w - mx * 2; // the text block's width without that room
    const vpad = pad + Math.max(0, (px * TEXT_LINE_HEIGHT - lineH) / 2); // tight lines still fit their glyphs
    const h = Math.ceil(lines.length * lineH + vpad * 2 + my * 2);
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext('2d')!; // resizing resets context state
    const setup = (c: CanvasRenderingContext2D) => { c.font = font; c.textBaseline = 'middle'; c.textAlign = 'left'; c.lineJoin = 'round'; };
    setup(ctx);
    const positions: Pos[] = lines.flatMap((l, li) => {
      let x = mx + (s.align === 'left' ? pad : s.align === 'right' ? inner - pad - lineW[li] : (inner - lineW[li]) / 2);
      const y = my + vpad + lineH * (li + 0.5);
      return l.map((i) => { const p = { i, x, y, li }; x += wordW[i] + space; return p; });
    }).filter((p) => owner[p.i] < shown);
    const role = (p: Pos): WordRole | undefined => look?.roles[owner[p.i]];

    if (bg && !mask) {
      ctx.globalAlpha = bg.opacity;
      ctx.fillStyle = bg.color;
      ctx.beginPath();
      const r = px * (bg.radius ?? 0.3);
      if (bg.lines) {
        // One box per line, hugging the words drawn so far; one fill, so where boxes overlap the colour stays even.
        const ex = bgPad + ring, ey = (bgPad + ring) * 0.55;
        for (let li = 0; li < lines.length; li++) {
          const on = positions.filter((p) => p.li === li);
          if (!on.length) continue;
          const x0 = on[0].x - ex, x1 = on[on.length - 1].x + wordW[on[on.length - 1].i] + ex, y = on[0].y;
          ctx.roundRect(x0, y - lineH / 2 - ey, x1 - x0, lineH + ey * 2, r);
        }
      } else ctx.roundRect(mx, my, inner, h - my * 2, r);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    const grads = new Map<CanvasRenderingContext2D, CanvasGradient[]>();
    const gradient = (c: CanvasRenderingContext2D, li: number): CanvasGradient => {
      let g = grads.get(c);
      if (!g) grads.set(c, (g = []));
      if (!g[li]) {
        const y = my + vpad + lineH * (li + 0.5);
        g[li] = c.createLinearGradient(0, y - px * 0.45, 0, y + px * 0.45);
        g[li].addColorStop(0, s.color);
        g[li].addColorStop(1, s.gradient!);
      }
      return g[li];
    };
    const hl = look?.highlight ?? s.color;
    const fillOf = (c: CanvasRenderingContext2D, p: Pos, r: WordRole | undefined): string | CanvasGradient =>
      mask ? '#ffffff' : r?.box ? readableOn(hl, s.color) : r && r.lit >= 1 ? hl : s.gradient ? gradient(c, p.li) : s.color;

    // Solid copies under the letters: their silhouette (outlines included) is drawn once and stamped at each offset.
    const copies = (c: CanvasRenderingContext2D, ps: Pos[]) => {
      const list = s.copies?.filter((cp) => cp.x || cp.y);
      const at = ps.filter((p) => !role(p)?.box);
      if (mask || !list?.length || !at.length) return;
      const sc = this.scratch('sil', w, h);
      setup(sc);
      sc.fillStyle = sc.strokeStyle = '#000000';
      sc.lineWidth = ring * 2;
      for (const p of at) { if (ring > 0) drawWord(sc, words[p.i], p.x, p.y, ls, true); drawWord(sc, words[p.i], p.x, p.y, ls, false); }
      // Only the letters' box is recoloured and stamped (a 3D block stamps it at every step).
      const e = ring + px * 0.1;
      const x0 = Math.max(0, Math.floor(Math.min(...at.map((p) => p.x)) - e)), x1 = Math.min(w, Math.ceil(Math.max(...at.map((p) => p.x + wordW[p.i])) + e));
      const y0 = Math.max(0, Math.floor(Math.min(...at.map((p) => p.y)) - lineH / 2 - e)), y1 = Math.min(h, Math.ceil(Math.max(...at.map((p) => p.y)) + lineH / 2 + e));
      if (x1 <= x0 || y1 <= y0) return;
      for (const cp of list) {
        sc.globalCompositeOperation = 'source-in';
        sc.fillStyle = cp.color;
        sc.fillRect(x0, y0, x1 - x0, y1 - y0);
        const steps = cp.depth ? Math.max(1, Math.ceil((Math.max(Math.abs(cp.x), Math.abs(cp.y)) * px) / Math.max(1, px * 0.02))) : 1;
        for (let j = steps; j >= 1; j--) c.drawImage(this.sil!, x0, y0, x1 - x0, y1 - y0, x0 + (cp.x * px * j) / steps, y0 + (cp.y * px * j) / steps, x1 - x0, y1 - y0);
      }
    };

    // Everything a group of words needs, bottom to top; pass by pass, so no word's outline covers a neighbour's letters.
    const paint = (c: CanvasRenderingContext2D, ps: Pos[]) => {
      for (const p of ps) {
        if (mask || !role(p)?.box) continue;
        c.fillStyle = hl;
        c.beginPath();
        c.roundRect(p.x - px * 0.16, p.y - px * 0.6, wordW[p.i] + px * 0.32, px * 1.16, px * 0.22);
        c.fill();
      }
      copies(c, ps);
      const outlined = mask ? [] : ps.filter((p) => !role(p)?.box);
      // A glow goes under the outlines: drawn with the letters it would cover the outline and blur the letters' edge.
      const glowFirst = glow && !bg && !mask && outlined.length > 0 && ring > 0;
      if (glowFirst) {
        c.shadowColor = s.shadowColor!;
        c.shadowBlur = px * 0.45;
        c.fillStyle = s.color; // only the glow shows: the letters are drawn again over it
        for (const p of outlined) drawWord(c, words[p.i], p.x, p.y, ls, false);
        c.shadowColor = 'transparent';
        c.shadowBlur = 0;
      }
      if (s.outline2 && s.outline2.width > 0) {
        c.strokeStyle = s.outline2.color;
        c.lineWidth = ring * 2;
        for (const p of outlined) drawWord(c, words[p.i], p.x, p.y, ls, true);
      }
      if (s.stroke && stroke > 0) {
        c.strokeStyle = s.stroke.color;
        c.lineWidth = stroke * 2;
        for (const p of outlined) drawWord(c, words[p.i], p.x, p.y, ls, true);
      }
      if (s.shadow && !bg && !mask && !glowFirst) {
        c.shadowColor = s.shadowColor ?? 'rgba(0,0,0,0.55)';
        c.shadowBlur = px * (glow ? 0.45 : 0.18);
        c.shadowOffsetY = glow ? 0 : px * 0.05;
      }
      // Gradient letters: drawn in one colour, then each line's gradient laid over them at once (gradient text drawn
      // letter by letter is several times slower in WebKit).
      const graded = s.gradient && !mask ? ps.filter((p) => { const r = role(p); return !r?.box && !(r && r.lit >= 1); }) : [];
      if (graded.length) {
        const sc = this.scratch('sil', w, h);
        setup(sc);
        sc.fillStyle = '#000000';
        for (const p of graded) drawWord(sc, words[p.i], p.x, p.y, ls, false);
        sc.globalCompositeOperation = 'source-atop'; // 'source-in' would also clear the other lines' letters
        for (const li of new Set(graded.map((p) => p.li))) {
          const top = li === 0 ? 0 : my + vpad + lineH * li, bottom = li === lines.length - 1 ? h : my + vpad + lineH * (li + 1);
          sc.fillStyle = gradient(sc, li);
          sc.fillRect(0, top, w, bottom - top);
        }
        c.drawImage(this.sil!, 0, 0);
      }
      for (const p of ps) { if (graded.includes(p)) continue; c.fillStyle = fillOf(c, p, role(p)); drawWord(c, words[p.i], p.x, p.y, ls, false); }
      c.shadowColor = 'transparent';
      c.shadowBlur = 0;
      c.shadowOffsetY = 0;
      if (mask) return;
      for (const p of ps) {
        const r = role(p);
        if (r && r.lit > 0 && r.lit < 1) {
          // Karaoke: the sung part of the word in the highlight colour.
          c.save();
          c.beginPath();
          c.rect(p.x - px, p.y - lineH, px + wordW[p.i] * r.lit, lineH * 2);
          c.clip();
          c.fillStyle = hl;
          drawWord(c, words[p.i], p.x, p.y, ls, false);
          c.restore();
        }
        if (r?.underline) {
          const uh = px * 0.09;
          c.beginPath();
          c.roundRect(p.x, p.y + px * 0.5 - uh / 2, wordW[p.i], uh, uh / 2);
          if (s.stroke && stroke > 0) { c.strokeStyle = s.stroke.color; c.lineWidth = Math.min(stroke, px * 0.06) * 2; c.stroke(); }
          c.fillStyle = hl;
          c.fill();
        }
      }
    };

    // A word that moves, grows or fades is drawn on its own and placed over the others; the rest are drawn together.
    const motion = (p: Pos) => {
      const r = role(p);
      let k = 1, dx = 0, dy = 0, a = r?.dim ? 0.5 : 1;
      if (r?.big) k *= big(p.i);
      if (r?.enter) { const m = motionAt(look!.motion, look!.enter); k *= m.k; dx += m.x * px * 0.6; dy += m.y * px * 0.4; a *= m.a; }
      return { k, dx, dy, a: mask ? 1 : a };
    };
    const still = positions.filter((p) => { const m = motion(p); return m.k === 1 && !m.dx && !m.dy && m.a === 1; });
    paint(ctx, still);
    for (const p of positions) {
      if (still.includes(p)) continue;
      const { k, dx, dy, a } = motion(p);
      if (a <= 0 || k <= 0) continue;
      // Only the word's own box is drawn and placed (outlines, copies, glow and its highlight box included): a word that
      // moves costs its size, not the whole caption's.
      const e = ring + reach + (glow ? px * 0.45 : 0) + px * 0.25;
      const cx = p.x + wordW[p.i] / 2;
      const hw = (wordW[p.i] / 2 + e) * k, hh = (lineH / 2 + e) * k;
      const x0 = Math.max(0, Math.floor(cx + dx - hw)), y0 = Math.max(0, Math.floor(p.y + dy - hh));
      const x1 = Math.min(w, Math.ceil(cx + dx + hw)), y1 = Math.min(h, Math.ceil(p.y + dy + hh));
      if (x1 <= x0 || y1 <= y0) continue;
      const sc = this.scratch('stamp', x1 - x0, y1 - y0);
      setup(sc);
      sc.translate(cx + dx - x0, p.y + dy - y0);
      sc.scale(k, k);
      sc.translate(-cx, -p.y);
      paint(sc, [p]);
      ctx.globalAlpha = a;
      ctx.drawImage(this.stamp!, x0, y0);
      ctx.globalAlpha = 1;
    }
    return { image: canvas, w, h, key: '' };
  }
}
