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
