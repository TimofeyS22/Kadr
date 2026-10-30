// Text and caption style presets (one tap in the UI). Everything stays editable after applying.
// v1.5: catalogs by category, as in CapCut; every caption template reads on any background (an outline of at least
// 0.04 font sizes, or a box) — checked by core/presets.test.ts and, in pixels, by e2e/qa-caption-styles.spec.ts.
import type { CaptionLook } from './captions';
import type { TextAnim, TextStyle } from './types';

export { CAPTION_ACCENT } from './captions';

const base: TextStyle = {
  font: 'inter', size: 0.055, weight: 700, italic: false, color: '#ffffff', align: 'center',
  stroke: null, background: null, shadow: true,
};
const black = (width: number) => ({ color: '#000000', width });

export type TextCategory = 'basic' | 'titles' | 'glow' | 'retro' | 'tech' | 'hand' | 'classy' | 'labels' | 'fun';
export const TEXT_CATEGORIES: { id: TextCategory; name: string }[] = [
  { id: 'basic', name: 'Basic' }, { id: 'titles', name: 'Titles' }, { id: 'glow', name: 'Glow' }, { id: 'labels', name: 'Labels' },
  { id: 'fun', name: 'Fun' }, { id: 'retro', name: 'Retro' }, { id: 'tech', name: 'Games & tech' }, { id: 'hand', name: 'Handwriting' },
  { id: 'classy', name: 'Classy' },
];

export interface TextPreset { id: string; name: string; cat: TextCategory; style: TextStyle; animIn?: TextAnim }

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'classic', name: 'Classic', cat: 'basic', style: base },
  { id: 'outline', name: 'Outline', cat: 'basic', style: { ...base, font: 'anton', weight: 400, size: 0.07, uppercase: true, stroke: black(0.08), shadow: false } },
  { id: 'box', name: 'Box', cat: 'labels', style: { ...base, size: 0.045, background: { color: '#000000', opacity: 0.65 }, shadow: false } },
  { id: 'yellow', name: 'Yellow', cat: 'titles', style: { ...base, font: 'bebas', weight: 400, size: 0.08, color: '#ffd23f', uppercase: true, stroke: black(0.06) } },
  { id: 'neon', name: 'Neon', cat: 'glow', style: { ...base, weight: 900, color: '#ff4fa3', shadowColor: '#ff4fa3' } },
  { id: 'script', name: 'Script', cat: 'hand', style: { ...base, font: 'pacifico', weight: 400, size: 0.06 } },
  { id: 'serif', name: 'Serif', cat: 'classy', style: { ...base, font: 'playfair', italic: true, size: 0.06 } },
  { id: 'headline', name: 'Headline', cat: 'titles', style: { ...base, font: 'montserrat', weight: 900, size: 0.06, uppercase: true } },
  { id: 'wide', name: 'Wide', cat: 'titles', style: { ...base, font: 'unbounded', weight: 700, size: 0.05, uppercase: true, color: '#ffffff', shadowColor: '#7c5cff' } },
  { id: 'condensed', name: 'Condensed', cat: 'titles', style: { ...base, font: 'oswald', weight: 700, size: 0.075, uppercase: true, color: '#ffd23f', stroke: black(0.06) } },
  { id: 'chunky', name: 'Chunky', cat: 'fun', style: { ...base, font: 'rubikMono', weight: 400, size: 0.05, color: '#ffffff', stroke: { color: '#ff4fa3', width: 0.1 }, shadow: false } },
  { id: 'pixel', name: 'Pixel', cat: 'tech', style: { ...base, font: 'pixel', weight: 400, size: 0.035, color: '#7CFC00', background: { color: '#000000', opacity: 0.7 }, shadow: false } },
  { id: 'hand', name: 'Handwritten', cat: 'hand', style: { ...base, font: 'caveat', weight: 700, size: 0.075 } },
  { id: 'vintage', name: 'Vintage', cat: 'retro', style: { ...base, font: 'lobster', weight: 400, size: 0.065, color: '#ffe8c2', shadowColor: '#7a3b12' } },
  { id: 'elegant', name: 'Elegant', cat: 'classy', style: { ...base, font: 'yeseva', weight: 400, size: 0.06 } },
  // v0.8 style pack: font + colour + outline/background/glow + entrance, ready for short videos.
  { id: 'highlighter', name: 'Highlighter', cat: 'labels', style: { ...base, font: 'inter', weight: 900, size: 0.05, color: '#111111', background: { color: '#ffd23f', opacity: 1 }, shadow: false }, animIn: { type: 'pop', duration: 0.3 } },
  { id: 'news', name: 'Breaking news', cat: 'labels', style: { ...base, font: 'oswald', weight: 700, size: 0.05, uppercase: true, color: '#ffffff', background: { color: '#e5322d', opacity: 1 }, shadow: false } },
  { id: 'comic', name: 'Comic', cat: 'fun', style: { ...base, font: 'rubikMono', weight: 400, size: 0.055, color: '#ffd23f', stroke: black(0.12), shadow: false }, animIn: { type: 'pop', duration: 0.35 } },
  { id: 'glow', name: 'Glow', cat: 'glow', style: { ...base, font: 'exo', weight: 900, size: 0.06, color: '#ffffff', shadowColor: '#00e5ff' } },
  { id: 'retro80', name: 'Retro 80s', cat: 'retro', style: { ...base, font: 'unbounded', weight: 900, size: 0.055, italic: true, uppercase: true, color: '#ff4fa3', shadowColor: '#00e5ff' } },
  { id: 'luxury', name: 'Luxury', cat: 'classy', style: { ...base, font: 'yeseva', weight: 400, size: 0.065, color: '#e9c46a', shadowColor: '#000000' }, animIn: { type: 'fade', duration: 0.6 } },
  { id: 'love', name: 'Love', cat: 'hand', style: { ...base, font: 'lobster', weight: 400, size: 0.07, color: '#ff6b9a', shadowColor: '#ff2d6f' } },
  { id: 'notebook', name: 'Notebook', cat: 'labels', style: { ...base, font: 'caveat', weight: 700, size: 0.065, color: '#1d3557', background: { color: '#fffbe6', opacity: 0.95 }, shadow: false } },
  { id: 'kids', name: 'Kids', cat: 'fun', style: { ...base, font: 'comfortaa', weight: 700, size: 0.06, color: '#ffffff', stroke: { color: '#7c5cff', width: 0.1 }, shadow: false }, animIn: { type: 'pop', duration: 0.4 } },
  { id: 'minimal', name: 'Minimal', cat: 'basic', style: { ...base, font: 'raleway', weight: 400, size: 0.04, uppercase: true, color: '#ffffff', shadow: false }, animIn: { type: 'fade', duration: 0.5 } },
  { id: 'cinema', name: 'Cinema', cat: 'classy', style: { ...base, font: 'playfair', weight: 700, size: 0.055, uppercase: true, color: '#ffffff' }, animIn: { type: 'fade', duration: 0.8 } },
  { id: 'quote', name: 'Quote', cat: 'classy', style: { ...base, font: 'lora', weight: 700, size: 0.05, italic: true, color: '#ffffff' }, animIn: { type: 'rise', duration: 0.5 } },
  { id: 'sport', name: 'Sport', cat: 'titles', style: { ...base, font: 'russo', weight: 400, size: 0.065, italic: true, uppercase: true, color: '#ffffff', stroke: { color: '#e5322d', width: 0.08 } }, animIn: { type: 'pop', duration: 0.3 } },
  { id: 'gaming', name: 'Gaming', cat: 'tech', style: { ...base, font: 'pixel', weight: 400, size: 0.04, color: '#ffd23f', stroke: black(0.15), shadow: false } },
  { id: 'sticker', name: 'Sticker', cat: 'labels', style: { ...base, font: 'rubik', weight: 900, size: 0.055, color: '#111111', background: { color: '#ffffff', opacity: 1 }, shadow: true }, animIn: { type: 'pop', duration: 0.35 } },
  { id: 'neonBlue', name: 'Neon blue', cat: 'glow', style: { ...base, font: 'exo', weight: 700, size: 0.06, color: '#7df9ff', shadowColor: '#00b3ff' } },
  { id: 'vlog', name: 'Vlog', cat: 'basic', style: { ...base, font: 'montserrat', weight: 700, size: 0.05, color: '#ffffff' }, animIn: { type: 'rise', duration: 0.4 } },
  { id: 'book', name: 'Book', cat: 'classy', style: { ...base, font: 'ptSerif', weight: 700, size: 0.05, color: '#ffffff' } },
  { id: 'marker', name: 'Marker', cat: 'hand', style: { ...base, font: 'marck', weight: 400, size: 0.07, color: '#ffffff' } },
  { id: 'tall', name: 'Tall', cat: 'titles', style: { ...base, font: 'amatic', weight: 700, size: 0.09, uppercase: true, color: '#ffffff' } },
  { id: 'warning', name: 'Warning', cat: 'labels', style: { ...base, font: 'bebas', weight: 400, size: 0.075, uppercase: true, color: '#111111', background: { color: '#ffd23f', opacity: 1 }, shadow: false } },
  { id: 'ice', name: 'Ice', cat: 'glow', style: { ...base, font: 'unbounded', weight: 700, size: 0.05, color: '#dff6ff', stroke: { color: '#3a86ff', width: 0.08 } } },
  { id: 'space', name: 'Space', cat: 'glow', style: { ...base, font: 'exo', weight: 900, size: 0.06, uppercase: true, color: '#c7b8ff', shadowColor: '#7c5cff' }, animIn: { type: 'rise', duration: 0.6 } },
  { id: 'pastel', name: 'Pastel', cat: 'fun', style: { ...base, font: 'comfortaa', weight: 700, size: 0.06, color: '#ffd6e7', stroke: { color: '#8a5cf6', width: 0.08 }, shadow: false } },
  { id: 'terminal', name: 'Terminal', cat: 'tech', style: { ...base, font: 'mono', weight: 400, size: 0.04, color: '#3bd16f', background: { color: '#000000', opacity: 0.85 }, shadow: false }, animIn: { type: 'typewriter', duration: 1 } },
  // v1.5: gradients, double outlines, solid and 3D shadows, boxes per line, new faces.
  { id: 'rounded', name: 'Rounded', cat: 'basic', style: { ...base, font: 'nunito', weight: 900, size: 0.06, stroke: black(0.08), shadow: false } },
  { id: 'social', name: 'Social', cat: 'labels', style: { ...base, size: 0.045, color: '#111111', background: { color: '#ffffff', opacity: 1, lines: true, radius: 0.25, padding: 0.3 }, shadow: false }, animIn: { type: 'pop', duration: 0.3 } },
  { id: 'subtitle', name: 'Subtitle', cat: 'labels', style: { ...base, size: 0.042, background: { color: '#000000', opacity: 0.72, lines: true, radius: 0.12, padding: 0.25 }, shadow: false } },
  { id: 'tag', name: 'Label', cat: 'labels', style: { ...base, font: 'nunito', weight: 900, size: 0.05, background: { color: '#d6156f', opacity: 1, lines: true, radius: 0.6, padding: 0.4 }, shadow: false }, animIn: { type: 'slideLeft', duration: 0.35 } },
  { id: 'cutout', name: 'Paper cut', cat: 'labels', style: { ...base, font: 'dela', weight: 400, size: 0.05, uppercase: true, color: '#111111', background: { color: '#ffd23f', opacity: 1, lines: true, radius: 0.05, padding: 0.3 }, shadow: false }, animIn: { type: 'drop', duration: 0.45 } },
  { id: 'sunsetTitle', name: 'Sunset', cat: 'titles', style: { ...base, font: 'unbounded', weight: 900, size: 0.06, uppercase: true, color: '#ffd23f', gradient: '#ff4fa3', stroke: { color: '#2b0a3d', width: 0.08 }, shadow: false }, animIn: { type: 'zoom', duration: 0.4 } },
  { id: 'block3d', name: '3D', cat: 'titles', style: { ...base, font: 'dela', weight: 400, size: 0.065, uppercase: true, stroke: black(0.05), copies: [{ color: '#ff4fa3', x: 0.07, y: 0.07, depth: true }], shadow: false }, animIn: { type: 'pop', duration: 0.35 } },
  { id: 'hero', name: 'Hero', cat: 'titles', style: { ...base, font: 'dela', weight: 400, size: 0.07, uppercase: true, gradient: '#ffd23f', stroke: black(0.08), copies: [{ color: '#000000', x: 0, y: 0.09, depth: true }], shadow: false }, animIn: { type: 'drop', duration: 0.5 } },
  { id: 'double', name: 'Double stroke', cat: 'titles', style: { ...base, font: 'montserrat', weight: 900, size: 0.06, uppercase: true, color: '#ffd23f', stroke: black(0.07), outline2: { color: '#ffffff', width: 0.06 }, shadow: false } },
  { id: 'fire', name: 'Fire', cat: 'glow', style: { ...base, font: 'russo', weight: 400, size: 0.065, uppercase: true, color: '#ffe066', gradient: '#ff3b1f', stroke: { color: '#2b0a00', width: 0.06 }, shadowColor: '#ff6a00' } },
  { id: 'neonPink', name: 'Hot pink', cat: 'glow', style: { ...base, font: 'nunito', weight: 900, size: 0.06, color: '#ffd1ec', stroke: { color: '#3d0026', width: 0.04 }, shadowColor: '#ff2d95' } },
  { id: 'retroShadow', name: 'Retro shadow', cat: 'retro', style: { ...base, font: 'days', weight: 400, size: 0.055, uppercase: true, color: '#ffe8c2', stroke: { color: '#1d3557', width: 0.05 }, copies: [{ color: '#e5322d', x: 0.05, y: 0.05 }, { color: '#1d3557', x: 0.1, y: 0.1 }], shadow: false } },
  { id: 'vhs', name: 'VHS', cat: 'retro', style: { ...base, font: 'mono', weight: 700, size: 0.05, uppercase: true, letterSpacing: 0.08, stroke: black(0.04), copies: [{ color: '#ff2d6f', x: -0.04, y: 0 }, { color: '#00e5ff', x: 0.04, y: 0 }], shadow: false } },
  { id: 'glitchText', name: 'Glitch', cat: 'tech', style: { ...base, font: 'glitch', weight: 400, size: 0.065, uppercase: true, stroke: black(0.04), copies: [{ color: '#00e5ff', x: -0.05, y: 0 }, { color: '#ff2d6f', x: 0.05, y: 0 }], shadow: false } },
  { id: 'cyber', name: 'Cyber', cat: 'tech', style: { ...base, font: 'tektur', weight: 900, size: 0.06, uppercase: true, color: '#7df9ff', stroke: { color: '#001a33', width: 0.06 }, shadowColor: '#00b3ff' } },
  { id: 'arcade', name: 'Arcade', cat: 'tech', style: { ...base, font: 'pixel', weight: 400, size: 0.04, color: '#3bd16f', stroke: { color: '#0b3d1a', width: 0.1 }, copies: [{ color: '#0b3d1a', x: 0.08, y: 0.08, depth: true }], shadow: false } },
  { id: 'bubbleText', name: 'Bubbles', cat: 'fun', style: { ...base, font: 'bubbles', weight: 400, size: 0.07, color: '#ff6bb5', stroke: { color: '#5e1a6e', width: 0.06 }, outline2: { color: '#ffffff', width: 0.06 }, shadow: false }, animIn: { type: 'pop', duration: 0.4 } },
  { id: 'graffiti', name: 'Graffiti', cat: 'fun', style: { ...base, font: 'spray', weight: 400, size: 0.07, uppercase: true, stroke: black(0.04), copies: [{ color: '#ff2d6f', x: 0.05, y: 0.05 }], shadow: false } },
  { id: 'comicHand', name: 'Speech bubble', cat: 'fun', style: { ...base, font: 'pangolin', weight: 400, size: 0.06, color: '#111111', background: { color: '#ffffff', opacity: 1, lines: true, radius: 0.5, padding: 0.4 }, shadow: false }, animIn: { type: 'spin', duration: 0.45 } },
  { id: 'chalk', name: 'Chalk', cat: 'hand', style: { ...base, font: 'pangolin', weight: 400, size: 0.06, color: '#f2f2f2', stroke: { color: '#1d1d1d', width: 0.05 } } },
  { id: 'editorial', name: 'Editorial', cat: 'classy', style: { ...base, font: 'cormorant', weight: 700, size: 0.075, italic: true, stroke: black(0.04) }, animIn: { type: 'blur', duration: 0.7 } },
  { id: 'gold', name: 'Gold', cat: 'classy', style: { ...base, font: 'cormorant', weight: 700, size: 0.06, uppercase: true, letterSpacing: 0.12, color: '#fff1a8', gradient: '#b8862b', stroke: { color: '#2a1c05', width: 0.05 }, shadow: false }, animIn: { type: 'fade', duration: 0.8 } },
];

/** Caption template categories (v1.5), as the owner asked: blogger, minimal, bright, karaoke, gaming, business, motion. */
export type CaptionCategory = 'blogger' | 'minimal' | 'bright' | 'karaoke' | 'gaming' | 'business' | 'motion';
export const CAPTION_CATEGORIES: { id: CaptionCategory; name: string }[] = [
  { id: 'blogger', name: 'Blogger' }, { id: 'minimal', name: 'Minimalism' }, { id: 'bright', name: 'Bright' }, { id: 'karaoke', name: 'Karaoke' },
  { id: 'gaming', name: 'Games' }, { id: 'business', name: 'Business' }, { id: 'motion', name: 'Animated' },
];

export interface CaptionPreset extends CaptionLook { name: string; cat: CaptionCategory }

const cap = (id: string, name: string, cat: CaptionCategory, style: TextStyle, rest: Omit<CaptionPreset, 'id' | 'name' | 'cat' | 'style'>): CaptionPreset => ({ id, name, cat, style, ...rest });
const bold = (font: TextStyle['font'], size: number, extra: Partial<TextStyle> = {}): TextStyle =>
  ({ ...base, font, weight: 900, size, uppercase: true, stroke: black(0.1), shadow: false, ...extra });

// The v1.0 looks come first, in their old order (ids and indices kept: saved choices, projects and tests refer to
// them); the picker shows the catalog by category.
export const CAPTION_PRESETS: CaptionPreset[] = [
  cap('pop', 'Pop', 'blogger', bold('anton', 0.07, { weight: 400 }), { highlight: '#ffd23f', wordsPerPage: 3, layout: 'highlight' }),
  cap('clean', 'Clean', 'minimal', { ...base, size: 0.05, stroke: black(0.05) }, { highlight: null, wordsPerPage: 6, layout: 'phrase' }),
  cap('box', 'Box', 'minimal', { ...base, size: 0.045, background: { color: '#000000', opacity: 0.6 }, shadow: false }, { highlight: '#ff5a36', wordsPerPage: 6, layout: 'phrase' }),
  cap('karaoke', 'Karaoke', 'karaoke', { ...base, weight: 900, size: 0.055, stroke: black(0.06), shadow: false }, { highlight: '#3bd16f', wordsPerPage: 4, layout: 'highlight' }),
  cap('minimal', 'Thin', 'minimal', { ...base, weight: 400, size: 0.04, stroke: black(0.045) }, { highlight: null, wordsPerPage: 8, layout: 'phrase' }),
  cap('bold', 'Bold', 'blogger', bold('montserrat', 0.06, { stroke: black(0.12) }), { highlight: '#ffd23f', wordsPerPage: 3, layout: 'highlight' }),
  cap('green', 'Green', 'blogger', bold('rubik', 0.06), { highlight: '#3bd16f', wordsPerPage: 3, layout: 'highlight' }),
  cap('neon', 'Neon', 'bright', { ...base, font: 'exo', weight: 700, size: 0.055, color: '#ffffff', shadowColor: '#00b3ff', stroke: { color: '#001a33', width: 0.05 } }, { highlight: '#7df9ff', wordsPerPage: 4, layout: 'highlight' }),
  cap('bubble', 'Bubble', 'bright', { ...base, font: 'rubik', weight: 700, size: 0.05, color: '#111111', background: { color: '#ffffff', opacity: 1, padding: 0.3 }, shadow: false }, { highlight: '#e5322d', wordsPerPage: 5, layout: 'highlight' }),
  cap('hype', 'Hype', 'blogger', bold('dela', 0.06, { weight: 400, copies: [{ color: '#000000', x: 0, y: 0.08 }] }), { highlight: '#3bd16f', wordsPerPage: 3, layout: 'highlight', emphasis: 'scale', motion: 'pop' }),
  cap('marker', 'Highlighter', 'blogger', bold('montserrat', 0.055, { stroke: black(0.08) }), { highlight: '#6a3df5', wordsPerPage: 3, layout: 'highlight', emphasis: 'box' }),
  cap('feed', 'Feed', 'blogger', { ...base, size: 0.045, color: '#111111', background: { color: '#ffffff', opacity: 1, lines: true, radius: 0.25, padding: 0.3 }, shadow: false }, { highlight: '#ff2d8a', wordsPerPage: 6, layout: 'phrase', motion: 'pop' }),
  cap('vlog', 'Vlog', 'blogger', { ...base, font: 'nunito', weight: 900, size: 0.058, stroke: black(0.08), shadow: false }, { highlight: '#ff4fa3', wordsPerPage: 4, layout: 'highlight', emphasis: 'color', motion: 'rise' }),
  cap('podcast', 'Podcast', 'blogger', { ...base, weight: 900, size: 0.05, stroke: black(0.06), shadow: false }, { highlight: '#ffd23f', wordsPerPage: 5, layout: 'highlight', emphasis: 'underline' }),
  cap('cinema', 'Cinema', 'minimal', { ...base, size: 0.04, background: { color: '#000000', opacity: 0.72, lines: true, radius: 0.08, padding: 0.25 }, shadow: false }, { highlight: null, wordsPerPage: 8, layout: 'phrase', motion: 'fade' }),
  cap('soft', 'Soft', 'minimal', { ...base, font: 'comfortaa', size: 0.048, stroke: { color: '#1d1d1d', width: 0.06 }, shadow: false }, { highlight: '#ffffff', wordsPerPage: 6, layout: 'highlight', emphasis: 'dim' }),
  cap('serif', 'Serif', 'minimal', { ...base, font: 'playfair', italic: true, size: 0.052, stroke: black(0.045) }, { highlight: null, wordsPerPage: 6, layout: 'phrase', motion: 'fade' }),
  cap('sunset', 'Sunset', 'bright', bold('unbounded', 0.05, { color: '#ffd23f', gradient: '#ff4fa3', stroke: { color: '#2b0a3d', width: 0.09 } }), { highlight: '#ffffff', wordsPerPage: 3, layout: 'highlight', emphasis: 'color', motion: 'zoom' }),
  cap('candy', 'Candy', 'bright', { ...base, font: 'bubbles', weight: 400, size: 0.065, color: '#ff6bb5', stroke: { color: '#5e1a6e', width: 0.07 }, outline2: { color: '#ffffff', width: 0.06 }, shadow: false }, { highlight: '#ffe066', wordsPerPage: 3, layout: 'highlight', emphasis: 'color', motion: 'bounce' }),
  cap('comic', 'Comic', 'bright', bold('pangolin', 0.06, { weight: 400, color: '#ffd23f', copies: [{ color: '#000000', x: 0.06, y: 0.07 }] }), { highlight: '#ff3b30', wordsPerPage: 3, layout: 'highlight', emphasis: 'scale' }),
  cap('pastel', 'Pastel', 'bright', { ...base, font: 'nunito', weight: 900, size: 0.058, color: '#ffd6e7', stroke: { color: '#7445e8', width: 0.1 }, shadow: false }, { highlight: '#b8f2e6', wordsPerPage: 4, layout: 'highlight', emphasis: 'color', motion: 'fade' }),
  cap('street', 'Street', 'bright', bold('spray', 0.065, { weight: 400, stroke: black(0.06), copies: [{ color: '#ff2d6f', x: 0.06, y: 0.06 }] }), { highlight: '#00e5ff', wordsPerPage: 3, layout: 'highlight', emphasis: 'color' }),
  cap('block3d', '3D', 'bright', bold('dela', 0.055, { weight: 400, stroke: black(0.06), copies: [{ color: '#ff4fa3', x: 0.07, y: 0.07, depth: true }] }), { highlight: '#ffd23f', wordsPerPage: 3, layout: 'highlight', emphasis: 'color', motion: 'pop' }),
  cap('fill', 'Fill', 'karaoke', bold('montserrat', 0.055, { stroke: black(0.08) }), { highlight: '#ffd23f', wordsPerPage: 4, layout: 'highlight', emphasis: 'fill' }),
  cap('lyrics', 'Lyrics', 'karaoke', { ...base, font: 'rubik', size: 0.055, stroke: black(0.08), shadow: false }, { highlight: '#00e5ff', wordsPerPage: 5, layout: 'highlight', emphasis: 'past' }),
  cap('karaokeBox', 'Panel', 'karaoke', { ...base, weight: 900, size: 0.05, background: { color: '#000000', opacity: 0.78, lines: true, radius: 0.2, padding: 0.3 }, shadow: false }, { highlight: '#ff4fa3', wordsPerPage: 4, layout: 'highlight', emphasis: 'fill' }),
  cap('gold', 'Gold', 'karaoke', bold('cormorant', 0.06, { weight: 700, stroke: { color: '#1a1205', width: 0.07 } }), { highlight: '#e9c46a', wordsPerPage: 4, layout: 'highlight', emphasis: 'fill', motion: 'fade' }),
  cap('spotlight', 'Spotlight', 'karaoke', bold('oswald', 0.06, { weight: 700, stroke: black(0.08) }), { highlight: '#ffd23f', wordsPerPage: 5, layout: 'highlight', emphasis: 'dim' }),
  cap('pixel', 'Pixel', 'gaming', { ...base, font: 'pixel', weight: 400, size: 0.035, color: '#ffd23f', stroke: black(0.15), shadow: false }, { highlight: '#ff3b30', wordsPerPage: 3, layout: 'highlight', emphasis: 'color', motion: 'pop' }),
  cap('arcade', 'Arcade', 'gaming', { ...base, font: 'pixel', weight: 400, size: 0.032, color: '#3bd16f', background: { color: '#000000', opacity: 0.85, lines: true, radius: 0.05, padding: 0.35 }, shadow: false }, { highlight: '#ffffff', wordsPerPage: 4, layout: 'highlight', emphasis: 'past' }),
  cap('glitch', 'Glitch', 'gaming', bold('glitch', 0.065, { weight: 400, stroke: black(0.05), copies: [{ color: '#00e5ff', x: -0.05, y: 0 }, { color: '#ff2d6f', x: 0.05, y: 0 }] }), { highlight: '#ffd23f', wordsPerPage: 3, layout: 'highlight', emphasis: 'color' }),
  cap('esports', 'Esports', 'gaming', bold('days', 0.05, { weight: 400, italic: true, stroke: { color: '#e5322d', width: 0.08 }, outline2: black(0.05) }), { highlight: '#ffe066', wordsPerPage: 3, layout: 'highlight', emphasis: 'scale', motion: 'slide' }),
  cap('levelup', 'Level up', 'gaming', bold('tektur', 0.058, { stroke: black(0.08) }), { highlight: '#3bd16f', wordsPerPage: 3, layout: 'highlight', emphasis: 'box', motion: 'zoom' }),
  cap('stream', 'Stream', 'gaming', bold('russo', 0.058, { weight: 400, copies: [{ color: '#7c5cff', x: 0.06, y: 0.06 }] }), { highlight: '#00e5ff', wordsPerPage: 3, layout: 'highlight', emphasis: 'color', motion: 'bounce' }),
  cap('corporate', 'Corporate', 'business', { ...base, size: 0.042, background: { color: '#0b2a4a', opacity: 0.92, lines: true, radius: 0.15, padding: 0.3 }, shadow: false }, { highlight: '#7fd3ff', wordsPerPage: 6, layout: 'phrase', motion: 'fade' }),
  cap('news', 'News', 'business', { ...base, font: 'oswald', size: 0.05, uppercase: true, background: { color: '#d62b26', opacity: 1, lines: true, radius: 0.05, padding: 0.3 }, shadow: false }, { highlight: '#ffe066', wordsPerPage: 5, layout: 'phrase', motion: 'slide' }),
  cap('slides', 'Presentation', 'business', { ...base, font: 'montserrat', size: 0.045, color: '#111111', background: { color: '#ffffff', opacity: 0.95, lines: true, radius: 0.2, padding: 0.3 }, shadow: false }, { highlight: '#2f9bff', wordsPerPage: 5, layout: 'highlight', emphasis: 'box' }),
  cap('elegant', 'Elegant', 'business', { ...base, font: 'cormorant', size: 0.06, stroke: black(0.05) }, { highlight: '#e9c46a', wordsPerPage: 5, layout: 'highlight', emphasis: 'underline', motion: 'fade' }),
  cap('tech', 'Tech', 'business', { ...base, font: 'mono', size: 0.04, color: '#3bd16f', background: { color: '#000000', opacity: 0.85, lines: true, radius: 0.05, padding: 0.3 }, shadow: false }, { highlight: '#ffffff', wordsPerPage: 6, layout: 'reveal', emphasis: 'color', motion: 'fade' }),
  cap('interview', 'Interview', 'business', { ...base, font: 'ptSerif', size: 0.048, stroke: black(0.05) }, { highlight: null, wordsPerPage: 7, layout: 'phrase', motion: 'fade' }),
  cap('popup', 'Jump in', 'motion', bold('montserrat', 0.058), { highlight: '#ffd23f', wordsPerPage: 4, layout: 'reveal', emphasis: 'color', motion: 'pop' }),
  cap('fadeIn', 'Appear', 'motion', { ...base, size: 0.05, stroke: black(0.06), shadow: false }, { highlight: '#9be7ff', wordsPerPage: 5, layout: 'reveal', emphasis: 'color', motion: 'fade' }),
  cap('rise', 'Rise', 'motion', bold('rubik', 0.058), { highlight: '#3bd16f', wordsPerPage: 4, layout: 'reveal', emphasis: 'color', motion: 'rise' }),
  cap('oneWord', 'One word', 'motion', bold('anton', 0.09, { weight: 400 }), { highlight: null, wordsPerPage: 1, layout: 'word', motion: 'bounce' }),
  cap('slide', 'Slide', 'motion', bold('oswald', 0.06, { weight: 700 }), { highlight: '#ff5a36', wordsPerPage: 4, layout: 'highlight', emphasis: 'color', motion: 'slide' }),
  cap('zoom', 'Zoom', 'motion', bold('dela', 0.075, { weight: 400 }), { highlight: null, wordsPerPage: 1, layout: 'word', motion: 'zoom' }),
];

export interface StickerGroup { id: string; name: string; items: readonly string[] }
/** Emoji stickers by group (v1.5); the first group is the v0.2 set, in its order. Drawn by the device's emoji font. */
export const STICKER_GROUPS: StickerGroup[] = [
  { id: 'popular', name: 'Popular', items: ['😂', '🔥', '❤️', '😍', '👍', '🎉', '✨', '😎', '🤯', '😭', '👀', '💯', '🙌', '👏', '🥳', '😱', '🤔', '💥', '⭐', '✅', '❌', '⚡', '🎵', '📍', '👉', '👇', '💡', '🚀', '🌈', '☀️', '🍕', '☕'] },
  { id: 'faces', name: 'Faces', items: ['😀', '😅', '🤣', '😊', '😇', '🙂', '😉', '😘', '🤩', '😋', '😜', '🤪', '🤗', '🤫', '🤨', '😐', '🙄', '😏', '😴', '🥱', '😷', '🤒', '🥵', '🥶', '😵', '🤠', '🥸', '🤓', '🧐', '😕', '😟', '😮', '😳', '🥺', '😢', '😤', '😡', '🤬', '💀', '👻', '👽', '🤖', '💩', '🙈'] },
  { id: 'hands', name: 'Hands', items: ['👋', '🤚', '✋', '👌', '🤌', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👆', '☝️', '👎', '✊', '👊', '🤝', '🙏', '💪', '✍️', '🫶', '🫵'] },
  { id: 'hearts', name: 'Hearts', items: ['🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💋'] },
  { id: 'party', name: 'Party', items: ['🎊', '🎈', '🎁', '🎂', '🍾', '🥂', '🎆', '🎇', '🎄', '🎃', '🏆', '🥇', '🎯', '🎮', '🎬', '🎤', '🎧', '📸'] },
  { id: 'nature', name: 'Nature', items: ['🌸', '🌹', '🌻', '🌴', '🍀', '🍁', '🌊', '❄️', '☔', '🌙', '🌟', '☁️', '🐶', '🐱', '🦊', '🐻', '🐼', '🦄', '🐝', '🦋'] },
  { id: 'food', name: 'Food', items: ['🍔', '🍟', '🌮', '🍣', '🍜', '🍩', '🍪', '🍫', '🍦', '🍓', '🍉', '🍋', '🥑', '🥐', '🍿', '🥤', '🍷', '🍺'] },
  { id: 'signs', name: 'Signs', items: ['➡️', '⬅️', '⬆️', '⬇️', '↗️', '🔄', '❗', '❓', '‼️', '⁉️', '💤', '💬', '💭', '🆕', '🆗', '🆒', '🔝', '🔴', '🟢', '🔵', '⏰', '📌', '🔔', '💰'] },
];
/** Every sticker, in group order (the v0.2 list first). */
export const STICKERS: readonly string[] = STICKER_GROUPS.flatMap((g) => g.items);
