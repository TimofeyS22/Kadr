// Project document model. Pure data: JSON-serializable, no DOM types.
// Times are in seconds. Clip-relative times (keyframes) start at 0 = clip.start.

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
  'inter', 'montserrat', 'rubik', 'raleway', 'exo', 'comfortaa', 'unbounded', 'oswald', 'anton', 'bebas', 'russo', 'rubikMono', 'pixel', 'playfair', 'lora', 'ptSerif', 'yeseva', 'pacifico', 'lobster', 'caveat', 'marck', 'amatic', 'mono',
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
  /** `padding` (v0.9, optional): space around the text, as a fraction of the font size. */
  background: { color: string; opacity: number; padding?: number } | null;
  shadow: boolean;
  /** Optional (added in v0.2): render in upper case; shadow/glow color. */
  uppercase?: boolean;
  shadowColor?: string;
  /** Optional (v0.9): extra space between letters (fraction of the font size), line height (× font size). */
  letterSpacing?: number;
  lineHeight?: number;
}
export type TextAnimType = 'none' | 'fade' | 'rise' | 'pop' | 'typewriter';
export interface TextAnim { type: TextAnimType; duration: number }

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
  keepPitch?: boolean;
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
}

export type VideoClip = ClipBase & Visual & MediaRef & Sound & Look & { kind: 'video' };
export type ImageClip = ClipBase & Visual & Look & { kind: 'image'; assetId: string };
export type AudioClip = ClipBase & MediaRef & Sound & { kind: 'audio' };
export type TextClip = ClipBase & Visual & {
  kind: 'text'; text: string; style: TextStyle; animIn: TextAnim; animOut: TextAnim;
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
  derived?: { denoise?: string; enhance?: string; pitch?: Record<string, string> };
  /** Beat grid of the asset's sound, in source seconds. */
  beats?: { bpm: number; times: number[] };
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
