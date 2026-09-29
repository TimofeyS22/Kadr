import {
  ADJUST_KEYS, SCHEMA_VERSION,
  type Adjustments, type Anim, type AspectId, type Asset, type AudioClip, type CaptionClip, type CaptionWord, type ChromaKey, type ImageClip,
  type Project, type TextClip, type Transform, type VideoClip,
} from './types';

export function uid(): string {
  const b = new Uint8Array(9);
  crypto.getRandomValues(b);
  return Array.from(b, (x) => (x % 36).toString(36)).join('');
}

export const anim = (v: number): Anim => ({ v });

export const defaultTransform = (): Transform => ({
  x: anim(0), y: anim(0), scale: anim(1), rotation: anim(0), opacity: anim(1),
});

export const defaultAdjust = (): Adjustments =>
  Object.fromEntries(ADJUST_KEYS.map((k) => [k, 0])) as Adjustments;

export const defaultChroma = (): ChromaKey => ({ enabled: false, color: '#00ff00', similarity: 0.3, smoothness: 0.1 });

/** Canonical render size per aspect (short side 1080). Export may scale it. */
export const ASPECTS: Record<AspectId, [number, number]> = {
  '9:16': [1080, 1920],
  '16:9': [1920, 1080],
  '1:1': [1080, 1080],
  '4:5': [1080, 1350],
  '3:4': [1080, 1440],
};

export const IMAGE_DEFAULT_DURATION = 3;
export const TEXT_DEFAULT_DURATION = 3;

export function createProject(name: string, aspect: AspectId, now = Date.now()): Project {
  const [width, height] = ASPECTS[aspect];
  return {
    id: uid(),
    version: SCHEMA_VERSION,
    name,
    createdAt: now,
    updatedAt: now,
    settings: { aspect, width, height, fps: 30, background: { mode: 'color', color: '#000000' } },
    tracks: [{ id: uid(), kind: 'main', clips: [] }],
    assets: {},
  };
}

const look = () => ({ adjust: defaultAdjust(), filter: null, chroma: defaultChroma() });

export function createVideoClip(asset: Asset, start = 0): VideoClip {
  return {
    kind: 'video', id: uid(), assetId: asset.id, start, duration: asset.duration, in: 0, speed: 1,
    volume: 1, muted: false, fadeIn: 0, fadeOut: 0, transform: defaultTransform(), blend: 'normal', ...look(),
  };
}

export function createImageClip(asset: Asset, start = 0, duration = IMAGE_DEFAULT_DURATION): ImageClip {
  return {
    kind: 'image', id: uid(), assetId: asset.id, start, duration, transform: defaultTransform(), blend: 'normal', ...look(),
  };
}

export function createAudioClip(asset: Asset, start = 0): AudioClip {
  return {
    kind: 'audio', id: uid(), assetId: asset.id, start, duration: asset.duration, in: 0, speed: 1,
    volume: 1, muted: false, fadeIn: 0, fadeOut: 0,
  };
}

export function createTextClip(start = 0, text = 'Your text'): TextClip {
  return {
    kind: 'text', id: uid(), start, duration: TEXT_DEFAULT_DURATION, text,
    style: {
      font: 'inter', size: 0.055, weight: 700, italic: false, color: '#ffffff', align: 'center',
      stroke: null, background: null, shadow: true,
    },
    animIn: { type: 'fade', duration: 0.3 },
    animOut: { type: 'fade', duration: 0.3 },
    transform: defaultTransform(),
    blend: 'normal',
  };
}

/** Caption clip from words in timeline time; word times are stored relative to the clip start. */
export function createCaptionClip(words: CaptionWord[], preset: { id: string; style: CaptionClip['style']; highlight: string | null; wordsPerPage: number }): CaptionClip {
  const start = Math.max(0, words[0]?.t0 ?? 0);
  const end = words.length ? words[words.length - 1].t1 + 0.5 : start + 3;
  const transform = defaultTransform();
  transform.y = anim(0.18); // above the caption/music zone of TikTok, Reels and Shorts
  return {
    kind: 'caption', id: uid(), start, duration: end - start,
    words: words.map((w) => ({ ...w, t0: w.t0 - start, t1: w.t1 - start })),
    style: { ...preset.style }, highlight: preset.highlight, wordsPerPage: preset.wordsPerPage, preset: preset.id,
    transform, blend: 'normal',
  };
}
