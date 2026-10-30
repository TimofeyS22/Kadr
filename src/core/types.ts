// Project document model. Pure data: JSON-serializable, no DOM types.
// Times are in seconds. Clip-relative times (keyframes) start at 0 = clip.start.
import type { VoiceId } from './voicefx';

export const SCHEMA_VERSION = 1;

export type Easing = 'linear' | 'in' | 'out' | 'inOut' | 'hold';
export interface Keyframe { t: number; v: number; e?: Easing }
/** Animatable number: static value `v`, or keyframes `k` when non-empty. */
export interface Anim { v: number; k?: Keyframe[] }

export interface Transform {
  /** Offset of the layer center from the canvas center, in canvas widths / heights. */
  x: Anim;
  y: Anim;
  /** 1 = fit inside the canvas. */
  scale: Anim;
  /** Degrees, clockwise. */
  rotation: Anim;
  opacity: Anim;
}

export const ADJUST_KEYS = [
  'exposure', 'brightness', 'contrast', 'saturation', 'temperature', 'tint',
  'highlights', 'shadows', 'fade', 'vignette', 'sharpen', 'grain',
] as const;
export type AdjustKey = (typeof ADJUST_KEYS)[number];
/** Signed keys are in [-1, 1]; fade, vignette, sharpen, grain are in [0, 1]. */
export type Adjustments = Record<AdjustKey, number>;

export interface FilterRef { id: string; intensity: number }
export interface ChromaKey { enabled: boolean; color: string; similarity: number; smoothness: number }
export type BlendMode = 'normal' | 'screen' | 'multiply' | 'add';

export const TRANSITION_TYPES = [
  'fade', 'black', 'white', 'slideLeft', 'slideRight', 'slideUp', 'slideDown', 'wipeLeft', 'wipeRight', 'zoom',
  // v0.7
  'whip', 'spin', 'blur', 'glitch', 'flash', 'circle', 'doors', 'pixelate', 'zoomOut', 'shake',
] as const;
export type TransitionType = (typeof TRANSITION_TYPES)[number];
export interface Transition { type: TransitionType; duration: number }

export const FONT_IDS = [
  'inter', 'montserrat', 'rubik', 'nunito', 'raleway', 'exo', 'comfortaa', 'unbounded', 'oswald', 'anton', 'bebas', 'russo', 'dela', 'days', 'tektur', 'rubikMono', 'glitch', 'bubbles', 'spray', 'pixel', 'playfair', 'lora', 'ptSerif', 'cormorant', 'yeseva', 'pacifico', 'lobster', 'caveat', 'pangolin', 'marck', 'amatic', 'mono',
] as const;
export type FontId = (typeof FONT_IDS)[number];
/** A font the user added (v0.8): `custom:<id>` keyed into `Project.fonts`. */
export type CustomFontId = `custom:${string}`;
export interface TextStyle {
  font: FontId | CustomFontId;
  /** Font size as a fraction of canvas height. */
  size: number;
  weight: 400 | 700 | 900;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  stroke: { color: string; width: number } | null;
  /**
   * `padding` (v0.9, optional): space around the text, as a fraction of the font size. v1.5, optional: `lines` draws
   * one box per line, hugging it; `radius` is the corner radius (× font size, 0.3 by default).
   */
  background: { color: string; opacity: number; padding?: number; lines?: boolean; radius?: number } | null;
  shadow: boolean;
  /** Optional (added in v0.2): render in upper case; shadow/glow color. */
  uppercase?: boolean;
  shadowColor?: string;
  /** Optional (v0.9): extra space between letters (fraction of the font size), line height (× font size). */
  letterSpacing?: number;
  lineHeight?: number;
  /** Optional (v1.5): second fill colour; the letters fade from `color` at the top to it at the bottom. */
  gradient?: string;
  /** Optional (v1.5): a second outline around the first one, `width` a fraction of the font size like the stroke's. */
  outline2?: { color: string; width: number };
  /**
   * Optional (v1.5): solid copies of the letters under them, offset by (x, y) font sizes: a hard shadow, a 3D block
   * (`depth`: every step in between is drawn) or a two-colour glitch.
   */
  copies?: { color: string; x: number; y: number; depth?: boolean }[];
}
export const TEXT_ANIM_TYPES = ['none', 'fade', 'rise', 'pop', 'typewriter', 'slideLeft', 'slideRight', 'drop', 'zoom', 'spin', 'blur'] as const;
export type TextAnimType = (typeof TEXT_ANIM_TYPES)[number];
export interface TextAnim { type: TextAnimType; duration: number }
/** v1.5: motion that repeats while the text is on screen (period in seconds). */
export const TEXT_LOOP_TYPES = ['none', 'pulse', 'float', 'swing', 'shake', 'blink'] as const;
export type TextLoopType = (typeof TEXT_LOOP_TYPES)[number];
export interface TextLoop { type: TextLoopType; period: number }

/**
 * How the spoken word stands out (v1.5), in the caption's `highlight` colour: its colour; a box behind it; a line
 * under it; bigger; filled as it is sung (karaoke); every word said so far; the words still to come dimmed.
 */
export const CAPTION_EMPHASES = ['color', 'box', 'underline', 'scale', 'fill', 'past', 'dim'] as const;
export type CaptionEmphasis = (typeof CAPTION_EMPHASES)[number];
/** How captions come in (v1.5): each line; word by word, each word; words appear, each new word. */
export const CAPTION_MOTIONS = ['none', 'pop', 'fade', 'rise', 'slide', 'zoom', 'bounce'] as const;
export type CaptionMotion = (typeof CAPTION_MOTIONS)[number];

interface ClipBase { id: string; start: number; duration: number }
interface Visual { transform: Transform; blend: BlendMode; transitionIn?: Transition }
interface MediaRef {
  assetId: string; in: number; speed: number;
  /** Set on a reversed clip so it can be turned back. */
  reversedFrom?: { assetId: string; in: number };
  /** Speed ramp: multipliers of `speed` along the source range (see core/speed.ts). */
  curve?: number[];
}
interface Sound {
  volume: number; muted: boolean; fadeIn: number; fadeOut: number;
  /** Processed sound (e.g. noise-reduced) to play instead of the source's own audio. */
  audioAssetId?: string;
  /** What audioAssetId contains (see soundAssetId); a stale key falls back to the source sound. */
  audioKey?: string;
  denoise?: boolean;
  /** Enhance voice (v0.6): noise reduction + voice EQ + compression + loudness -16 LUFS. Implies denoise. */
  enhance?: boolean;
  /** Keep natural pitch when speed != 1 (pre-shifted sound, see engine/audiofx). */
  /** Natural voice pitch at any speed; on unless explicitly false (default changed in v1.0). */
  keepPitch?: boolean;
  /** Voice effect (v1.2): chipmunk, robot, telephone… processed into a derived sound, so preview = export. */
  voice?: VoiceId;
  /** Auto-ducking depth 0..1: lower this clip while speech plays in other clips. */
  duck?: number;
  /** Guide track (v0.8): heard while editing, never exported (edit to a trending sound, add it in the app you post to). */
  guide?: boolean;
}
/** Normalized source rectangle (0..1). */
export interface Rect { x: number; y: number; w: number; h: number }
/** Shape mask in layer space: center (x, y) and size (w, h) as fractions of the layer, feather 0..0.5. */
export interface Mask {
  shape: 'circle' | 'rect' | 'linear';
  x: number; y: number; w: number; h: number;
  rotation: number; feather: number; roundness: number; invert: boolean;
}
export const EFFECT_IDS = ['glitch', 'shake', 'zoomPunch', 'vhs', 'blur', 'rgbSplit'] as const;
export type EffectId = (typeof EFFECT_IDS)[number];
/** Video effect (v0.6); amount 0..1. Deterministic in time, so preview and export match. */
export interface Effect { id: EffectId; amount: number }
/** A hidden (blurred/pixelated) area in layer space: center x, y and size w, h as fractions of the layer. */
export interface PrivacyArea { x: Anim; y: Anim; w: number; h: number }
export interface Privacy { faces: boolean; areas: PrivacyArea[]; style: 'blur' | 'pixelate' }
/** Imported 3D LUT (.cube), resampled to at most 33³, RGB8, red fastest, base64. */
export interface LutData { name: string; size: number; data: string }
export interface LutRef { id: string; intensity: number }

interface Look {
  adjust: Adjustments; filter: FilterRef | null; chroma: ChromaKey; crop?: Rect; mask?: Mask;
  effect?: Effect; lut?: LutRef; privacy?: Privacy;
  /** Remove the background behind people (on-device segmentation). */
  removeBg?: boolean;
  /** Mirror left–right / upside down (v1.2). The picture, cutout and hidden faces flip together; the mask does not. */
  flipX?: boolean;
  flipY?: boolean;
}

export type VideoClip = ClipBase & Visual & MediaRef & Sound & Look & { kind: 'video' };
export type ImageClip = ClipBase & Visual & Look & { kind: 'image'; assetId: string };
export type AudioClip = ClipBase & MediaRef & Sound & { kind: 'audio' };
export type TextClip = ClipBase & Visual & {
  kind: 'text'; text: string; style: TextStyle; animIn: TextAnim; animOut: TextAnim;
  /** v1.5: repeating motion between the entrance and the exit. */
  loop?: TextLoop;
};
/** Word timing relative to the caption clip start. */
export interface CaptionWord {
  t0: number; t1: number; text: string;
  /** Cue index from an imported subtitle file: lines never merge across cues. */
  cue?: number;
}
export type CaptionClip = ClipBase & Visual & {
  kind: 'caption'; words: CaptionWord[]; style: TextStyle;
  /** Active-word color; null = no highlight. */
  highlight: string | null;
  wordsPerPage: number;
  preset?: string;
  /** v1.0: words appear one by one as they are spoken (the line keeps its final layout, so nothing jumps). */
  reveal?: boolean;
  /** v1.5: how the spoken word stands out; unset = its colour, only while it is spoken (as before v1.5). */
  emphasis?: CaptionEmphasis;
  /** v1.5: how lines (or words) come in; unset = word by word pops, other layouts cut (as before v1.5). */
  motion?: CaptionMotion;
};
export type Clip = VideoClip | ImageClip | AudioClip | TextClip | CaptionClip;
export type VisualClip = VideoClip | ImageClip | TextClip | CaptionClip;
export type SoundClip = VideoClip | AudioClip;
export type MediaClip = VideoClip | AudioClip;

/** main: magnetic video/image track; overlay: free video/image/text; audio: free audio. */
export type TrackKind = 'main' | 'overlay' | 'audio';
export interface Track { id: string; kind: TrackKind; clips: Clip[]; muted?: boolean; hidden?: boolean }

export type AssetKind = 'video' | 'audio' | 'image';
export interface Asset {
  id: string;
  kind: AssetKind;
  name: string;
  mime: string;
  size: number;
  duration: number; // 0 for images
  width: number; // 0 for audio
  height: number;
  hasAudio: boolean;
  /** Cache of processed versions of this asset's sound, e.g. { denoise: assetId }. */
  derived?: { denoise?: string; enhance?: string; pitch?: Record<string, string>; voice?: Record<string, string>; sync?: number };
  /** Beat grid of the asset's sound, in source seconds. */
  beats?: { bpm: number; times: number[] };
  /** The teleprompter text this recording was read from (docs/09 S1): captions take their words from it. Stays on the device. */
  script?: string;
  /** From the built-in music library (v0.8): license proof for the user. */
  library?: { id: string; title: string; artist: string; license: string; licenseUrl: string; source: string };
}

export type AspectId = '9:16' | '16:9' | '1:1' | '4:5' | '3:4';
export interface ProjectSettings {
  aspect: AspectId;
  width: number;
  height: number;
  fps: number;
  background: { mode: 'color' | 'blur'; color: string };
}

export interface Project {
  id: string;
  version: number;
  name: string;
  createdAt: number;
  updatedAt: number;
  settings: ProjectSettings;
  /** Compositing order bottom → top. Exactly one main track. */
  tracks: Track[];
  assets: Record<string, Asset>;
  /** Imported LUTs by id (v0.6), referenced by clips' `lut`. */
  luts?: Record<string, LutData>;
  /** Fonts the user added (v0.8): the file is a blob in local storage under `blobId`. */
  fonts?: Record<string, { name: string; blobId: string }>;
}
