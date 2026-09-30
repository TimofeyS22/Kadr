import type { CaptionClip, FontId, TextClip, TextStyle } from '../core/types';

/** Single-channel alpha mask (e.g. person segmentation) aligned with the drawable's pixels. */
export interface SegMask { data: Uint8Array; w: number; h: number; key: string }
export interface Drawable {
  image: TexImageSource; w: number; h: number; key: string; seg?: SegMask;
  /** Detected faces in UV space (for layers that hide faces). */
  faces?: import('../core/types').Rect[];
}

export const FONTS: Record<FontId, { label: string; family: string }> = {
  inter: { label: 'Inter', family: '"Inter", system-ui, sans-serif' },
  anton: { label: 'Anton', family: '"Anton", Impact, sans-serif' },
  bebas: { label: 'Bebas', family: '"Bebas Neue", Impact, sans-serif' },
  pacifico: { label: 'Pacifico', family: '"Pacifico", cursive' },
  playfair: { label: 'Playfair', family: '"Playfair Display", Georgia, serif' },
  mono: { label: 'Mono', family: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' },
};

export const fontCss = (s: TextStyle, px: number): string =>
  `${s.italic ? 'italic ' : ''}${s.weight} ${px}px ${FONTS[s.font].family}`;

/** Resolves when the bundled fonts are usable by canvas text rendering. */
export function loadFonts(): Promise<unknown> {
  const specs = ['400 32px "Inter"', '700 32px "Inter"', '900 32px "Inter"', '32px "Anton"', '32px "Bebas Neue"', '32px "Pacifico"', '400 32px "Playfair Display"', '700 32px "Playfair Display"'];
  return Promise.all(specs.map((s) => document.fonts.load(s).catch(() => undefined)));
}

/** Word-wraps paragraphs; returns lines as lists of word indices into `words`. */
function layout(ctx: CanvasRenderingContext2D, paragraphs: string[][], maxW: number): { words: string[]; lines: number[][] } {
  const words: string[] = [];
  const lines: number[][] = [];
  for (const para of paragraphs) {
    let line: number[] = [];
    let text = '';
    for (const w of para) {
      const next = text ? `${text} ${w}` : w;
      if (line.length && ctx.measureText(next).width > maxW) { lines.push(line); line = []; text = w; }
      else text = next;
      line.push(words.length);
      words.push(w);
    }
    lines.push(line);
  }
  return { words, lines };
}

/**
 * Renders text and captions to canvases sized in output pixels, LRU-cached by content and size.
 * Words are laid out one by one so a caption can highlight the word being spoken.
 */
export class TextRasterizer {
  private cache = new Map<string, Drawable | null>();

  clear(): void { this.cache.clear(); }

  get(clip: TextClip, chars: number, W: number, H: number): Drawable | null {
    const text = Number.isFinite(chars) ? [...clip.text].slice(0, chars).join('') : clip.text;
    const paragraphs = text.split('\n').map((p) => p.split(/\s+/).filter(Boolean));
    return this.cached([text, clip.style, W, H], () => this.render(paragraphs, clip.style, W, H, -1, null));
  }

  getCaption(clip: CaptionClip, words: string[], active: number, W: number, H: number): Drawable | null {
    if (!words.length) return null;
    const hl = clip.highlight;
    return this.cached([words, hl ? active : -1, clip.style, hl, W, H], () => this.render([words], clip.style, W, H, active, hl));
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
    if (this.cache.size > 96) this.cache.delete(this.cache.keys().next().value!);
    return d;
  }

  private render(paragraphs: string[][], s: TextStyle, W: number, H: number, active: number, highlight: string | null): Drawable | null {
    if (!paragraphs.some((p) => p.length)) return null;
    const px = Math.max(4, s.size * H);
    const upper = (w: string) => (s.uppercase ? w.toLocaleUpperCase() : w);
    const paras = paragraphs.map((p) => p.map(upper));
    const canvas = document.createElement('canvas');
    let ctx = canvas.getContext('2d')!;
    ctx.font = fontCss(s, px);
    const { words, lines } = layout(ctx, paras, W * 0.9);
    const space = ctx.measureText(' ').width;
    const wordW = words.map((w) => ctx.measureText(w).width);
    const lineW = lines.map((l) => l.reduce((a, i) => a + wordW[i], 0) + space * Math.max(0, l.length - 1));
    const lineH = px * 1.25;
    const stroke = s.stroke ? s.stroke.width * px : 0;
    const glow = s.shadow && !!s.shadowColor;
    const pad = (s.background ? px * 0.35 : px * 0.2) + stroke + (glow ? px * 0.3 : 0);
    const w = Math.ceil(Math.max(1, ...lineW) + pad * 2);
    const h = Math.ceil(lines.length * lineH + pad * 2);
    canvas.width = w;
    canvas.height = h;
    ctx = canvas.getContext('2d')!; // resizing resets context state
    ctx.font = fontCss(s, px);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.lineJoin = 'round';
    if (s.background) {
      ctx.globalAlpha = s.background.opacity;
      ctx.fillStyle = s.background.color;
      ctx.beginPath();
      ctx.roundRect(0, 0, w, h, px * 0.3);
      ctx.fill();
      ctx.globalAlpha = 1;
    }
    const positions = lines.flatMap((l, li) => {
      let x = s.align === 'left' ? pad : s.align === 'right' ? w - pad - lineW[li] : (w - lineW[li]) / 2;
      const y = pad + lineH * (li + 0.5);
      return l.map((i) => { const p = { i, x, y }; x += wordW[i] + space; return p; });
    });
    if (s.stroke && stroke > 0) {
      ctx.strokeStyle = s.stroke.color;
      ctx.lineWidth = stroke * 2;
      for (const p of positions) ctx.strokeText(words[p.i], p.x, p.y);
    }
    if (s.shadow && !s.background) {
      ctx.shadowColor = s.shadowColor ?? 'rgba(0,0,0,0.55)';
      ctx.shadowBlur = px * (glow ? 0.45 : 0.18);
      ctx.shadowOffsetY = glow ? 0 : px * 0.05;
    }
    for (const p of positions) {
      ctx.fillStyle = p.i === active && highlight ? highlight : s.color;
      ctx.fillText(words[p.i], p.x, p.y);
    }
    return { image: canvas, w, h, key: '' };
  }
}
