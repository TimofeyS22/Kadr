// Text and caption style presets (one tap in the UI). Everything stays editable after applying.
import type { TextAnim, TextStyle } from './types';

const base: TextStyle = {
  font: 'inter', size: 0.055, weight: 700, italic: false, color: '#ffffff', align: 'center',
  stroke: null, background: null, shadow: true,
};

export interface TextPreset { id: string; name: string; style: TextStyle; animIn?: TextAnim }

export const TEXT_PRESETS: TextPreset[] = [
  { id: 'classic', name: 'Classic', style: base },
  { id: 'outline', name: 'Outline', style: { ...base, font: 'anton', weight: 400, size: 0.07, uppercase: true, stroke: { color: '#000000', width: 0.08 }, shadow: false } },
  { id: 'box', name: 'Box', style: { ...base, size: 0.045, background: { color: '#000000', opacity: 0.65 }, shadow: false } },
  { id: 'yellow', name: 'Yellow', style: { ...base, font: 'bebas', weight: 400, size: 0.08, color: '#ffd23f', uppercase: true, stroke: { color: '#000000', width: 0.06 } } },
  { id: 'neon', name: 'Neon', style: { ...base, weight: 900, color: '#ff4fa3', shadowColor: '#ff4fa3' } },
  { id: 'script', name: 'Script', style: { ...base, font: 'pacifico', weight: 400, size: 0.06 } },
  { id: 'serif', name: 'Serif', style: { ...base, font: 'playfair', italic: true, size: 0.06 } },
  { id: 'headline', name: 'Headline', style: { ...base, font: 'montserrat', weight: 900, size: 0.06, uppercase: true } },
  { id: 'wide', name: 'Wide', style: { ...base, font: 'unbounded', weight: 700, size: 0.05, uppercase: true, color: '#ffffff', shadowColor: '#7c5cff' } },
  { id: 'condensed', name: 'Condensed', style: { ...base, font: 'oswald', weight: 700, size: 0.075, uppercase: true, color: '#ffd23f', stroke: { color: '#000000', width: 0.06 } } },
  { id: 'chunky', name: 'Chunky', style: { ...base, font: 'rubikMono', weight: 400, size: 0.05, color: '#ffffff', stroke: { color: '#ff4fa3', width: 0.1 }, shadow: false } },
  { id: 'pixel', name: 'Pixel', style: { ...base, font: 'pixel', weight: 400, size: 0.035, color: '#7CFC00', background: { color: '#000000', opacity: 0.7 }, shadow: false } },
  { id: 'hand', name: 'Handwritten', style: { ...base, font: 'caveat', weight: 700, size: 0.075 } },
  { id: 'vintage', name: 'Vintage', style: { ...base, font: 'lobster', weight: 400, size: 0.065, color: '#ffe8c2', shadowColor: '#7a3b12' } },
  { id: 'elegant', name: 'Elegant', style: { ...base, font: 'yeseva', weight: 400, size: 0.06 } },
  // v0.8 style pack: font + colour + outline/background/glow + entrance, ready for short videos.
  { id: 'highlighter', name: 'Highlighter', style: { ...base, font: 'inter', weight: 900, size: 0.05, color: '#111111', background: { color: '#ffd23f', opacity: 1 }, shadow: false }, animIn: { type: 'pop', duration: 0.3 } },
  { id: 'news', name: 'Breaking news', style: { ...base, font: 'oswald', weight: 700, size: 0.05, uppercase: true, color: '#ffffff', background: { color: '#e5322d', opacity: 1 }, shadow: false } },
  { id: 'comic', name: 'Comic', style: { ...base, font: 'rubikMono', weight: 400, size: 0.055, color: '#ffd23f', stroke: { color: '#000000', width: 0.12 }, shadow: false }, animIn: { type: 'pop', duration: 0.35 } },
  { id: 'glow', name: 'Glow', style: { ...base, font: 'exo', weight: 900, size: 0.06, color: '#ffffff', shadowColor: '#00e5ff' } },
  { id: 'retro80', name: 'Retro 80s', style: { ...base, font: 'unbounded', weight: 900, size: 0.055, italic: true, uppercase: true, color: '#ff4fa3', shadowColor: '#00e5ff' } },
  { id: 'luxury', name: 'Luxury', style: { ...base, font: 'yeseva', weight: 400, size: 0.065, color: '#e9c46a', shadowColor: '#000000' }, animIn: { type: 'fade', duration: 0.6 } },
  { id: 'love', name: 'Love', style: { ...base, font: 'lobster', weight: 400, size: 0.07, color: '#ff6b9a', shadowColor: '#ff2d6f' } },
  { id: 'notebook', name: 'Notebook', style: { ...base, font: 'caveat', weight: 700, size: 0.065, color: '#1d3557', background: { color: '#fffbe6', opacity: 0.95 }, shadow: false } },
  { id: 'kids', name: 'Kids', style: { ...base, font: 'comfortaa', weight: 700, size: 0.06, color: '#ffffff', stroke: { color: '#7c5cff', width: 0.1 }, shadow: false }, animIn: { type: 'pop', duration: 0.4 } },
  { id: 'minimal', name: 'Minimal', style: { ...base, font: 'raleway', weight: 400, size: 0.04, uppercase: true, color: '#ffffff', shadow: false }, animIn: { type: 'fade', duration: 0.5 } },
  { id: 'cinema', name: 'Cinema', style: { ...base, font: 'playfair', weight: 700, size: 0.055, uppercase: true, color: '#ffffff' }, animIn: { type: 'fade', duration: 0.8 } },
  { id: 'quote', name: 'Quote', style: { ...base, font: 'lora', weight: 700, size: 0.05, italic: true, color: '#ffffff' }, animIn: { type: 'rise', duration: 0.5 } },
  { id: 'sport', name: 'Sport', style: { ...base, font: 'russo', weight: 400, size: 0.065, italic: true, uppercase: true, color: '#ffffff', stroke: { color: '#e5322d', width: 0.08 } }, animIn: { type: 'pop', duration: 0.3 } },
  { id: 'gaming', name: 'Gaming', style: { ...base, font: 'pixel', weight: 400, size: 0.04, color: '#ffd23f', stroke: { color: '#000000', width: 0.15 }, shadow: false } },
  { id: 'sticker', name: 'Sticker', style: { ...base, font: 'rubik', weight: 900, size: 0.055, color: '#111111', background: { color: '#ffffff', opacity: 1 }, shadow: true }, animIn: { type: 'pop', duration: 0.35 } },
  { id: 'neonBlue', name: 'Neon blue', style: { ...base, font: 'exo', weight: 700, size: 0.06, color: '#7df9ff', shadowColor: '#00b3ff' } },
  { id: 'vlog', name: 'Vlog', style: { ...base, font: 'montserrat', weight: 700, size: 0.05, color: '#ffffff' }, animIn: { type: 'rise', duration: 0.4 } },
  { id: 'book', name: 'Book', style: { ...base, font: 'ptSerif', weight: 700, size: 0.05, color: '#ffffff' } },
  { id: 'marker', name: 'Marker', style: { ...base, font: 'marck', weight: 400, size: 0.07, color: '#ffffff' } },
  { id: 'tall', name: 'Tall', style: { ...base, font: 'amatic', weight: 700, size: 0.09, uppercase: true, color: '#ffffff' } },
  { id: 'warning', name: 'Warning', style: { ...base, font: 'bebas', weight: 400, size: 0.075, uppercase: true, color: '#111111', background: { color: '#ffd23f', opacity: 1 }, shadow: false } },
  { id: 'ice', name: 'Ice', style: { ...base, font: 'unbounded', weight: 700, size: 0.05, color: '#dff6ff', stroke: { color: '#3a86ff', width: 0.08 } } },
  { id: 'space', name: 'Space', style: { ...base, font: 'exo', weight: 900, size: 0.06, uppercase: true, color: '#c7b8ff', shadowColor: '#7c5cff' }, animIn: { type: 'rise', duration: 0.6 } },
  { id: 'pastel', name: 'Pastel', style: { ...base, font: 'comfortaa', weight: 700, size: 0.06, color: '#ffd6e7', stroke: { color: '#8a5cf6', width: 0.08 }, shadow: false } },
  { id: 'terminal', name: 'Terminal', style: { ...base, font: 'mono', weight: 400, size: 0.04, color: '#3bd16f', background: { color: '#000000', opacity: 0.85 }, shadow: false }, animIn: { type: 'typewriter', duration: 1 } },
];

export interface CaptionPreset { id: string; name: string; style: TextStyle; highlight: string | null; wordsPerPage: number }

export const CAPTION_PRESETS: CaptionPreset[] = [
  { id: 'pop', name: 'Pop', style: { ...base, font: 'anton', weight: 400, size: 0.07, uppercase: true, stroke: { color: '#000000', width: 0.1 }, shadow: false }, highlight: '#ffd23f', wordsPerPage: 3 },
  { id: 'clean', name: 'Clean', style: { ...base, size: 0.05 }, highlight: null, wordsPerPage: 6 },
  { id: 'box', name: 'Box', style: { ...base, size: 0.045, background: { color: '#000000', opacity: 0.6 }, shadow: false }, highlight: '#ff5a36', wordsPerPage: 6 },
  { id: 'karaoke', name: 'Karaoke', style: { ...base, weight: 900, size: 0.055, stroke: { color: '#000000', width: 0.06 }, shadow: false }, highlight: '#3bd16f', wordsPerPage: 4 },
  { id: 'minimal', name: 'Minimal', style: { ...base, weight: 400, size: 0.04 }, highlight: null, wordsPerPage: 8 },
];

export const STICKERS = ['😂', '🔥', '❤️', '😍', '👍', '🎉', '✨', '😎', '🤯', '😭', '👀', '💯', '🙌', '👏', '🥳', '😱', '🤔', '💥', '⭐', '✅', '❌', '⚡', '🎵', '📍', '👉', '👇', '💡', '🚀', '🌈', '☀️', '🍕', '☕'] as const;
