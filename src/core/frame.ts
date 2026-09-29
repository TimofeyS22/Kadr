// buildFrame: project + time → a flat list of layers with resolved parameters.
// Shared by preview and export, so what you see is what you export.
import { evalAnim } from './anim';
import { captionAt } from './captions';
import { resolveAdjust } from './filters';
import { clamp, clipEnd, mainTrack, sourceTime } from './timeline';
import type {
  Adjustments, BlendMode, CaptionClip, ChromaKey, Clip, Mask, Project, Rect, TextAnim, TextClip, TransitionType, VisualClip,
} from './types';

export type LayerSource =
  | { kind: 'video'; clipId: string; assetId: string; time: number }
  | { kind: 'image'; assetId: string }
  | { kind: 'text'; clip: TextClip; chars: number }
  | { kind: 'caption'; clip: CaptionClip; words: string[]; active: number }
  | { kind: 'solid'; color: string };

export interface Layer {
  id: string;
  source: LayerSource;
  /** contain/cover: fit the source into the canvas; native: source pixels are canvas pixels. */
  fit: 'contain' | 'cover' | 'native';
  x: number;
  y: number;
  scale: number;
  rotation: number;
  opacity: number;
  adjust: Adjustments | null;
  chroma: ChromaKey | null;
  /** Source sub-rectangle to show (video/image crop). */
  crop: Rect | null;
  mask: Mask | null;
  /** Cut out people (segmentation mask applied as alpha). */
  removeBg: boolean;
  blend: BlendMode;
  blur: boolean;
  /** Reveal mask in canvas space: direction (dx, dy) and progress 0..1. */
  wipe: [number, number, number] | null;
  selectable: boolean;
}

export interface FrameDesc { t: number; background: string; layers: Layer[] }

const active = (c: Clip, t: number) => t >= c.start && t < clipEnd(c);
const smooth = (p: number) => p * p * (3 - 2 * p);
const backOut = (p: number) => 1 + 2.70158 * (p - 1) ** 3 + 1.70158 * (p - 1) ** 2;

function textAnim(a: TextAnim, p: number, layer: Layer, clip: TextClip): void {
  if (a.type === 'none' || p >= 1) return;
  const q = clamp(p, 0, 1);
  switch (a.type) {
    case 'fade': layer.opacity *= smooth(q); break;
    case 'rise': layer.opacity *= smooth(q); layer.y += (1 - smooth(q)) * 0.04; break;
    case 'pop': layer.scale *= Math.max(0.01, 0.5 + 0.5 * backOut(q)); layer.opacity *= Math.min(1, q * 3); break;
    case 'typewriter':
      if (layer.source.kind === 'text') layer.source.chars = Math.floor(q * [...clip.text].length); break;
  }
}

export function visualLayer(p: Project, c: VisualClip, t: number): Layer {
  const local = t - c.start;
  const tf = c.transform;
  const layer: Layer = {
    id: c.id,
    source: { kind: 'solid', color: '#000' },
    fit: 'contain',
    x: evalAnim(tf.x, local),
    y: evalAnim(tf.y, local),
    scale: evalAnim(tf.scale, local),
    rotation: evalAnim(tf.rotation, local),
    opacity: clamp(evalAnim(tf.opacity, local), 0, 1),
    adjust: null,
    chroma: null,
    crop: null,
    mask: null,
    removeBg: false,
    blend: c.blend,
    blur: false,
    wipe: null,
    selectable: true,
  };
  if (c.kind === 'text') {
    layer.fit = 'native';
    layer.source = { kind: 'text', clip: c, chars: Infinity };
    if (c.animIn.duration > 0) textAnim(c.animIn, local / c.animIn.duration, layer, c);
    if (c.animOut.duration > 0) textAnim(c.animOut, (c.duration - local) / c.animOut.duration, layer, c);
    return layer;
  }
  if (c.kind === 'caption') {
    const at = captionAt(c, local);
    layer.fit = 'native';
    layer.source = { kind: 'caption', clip: c, words: at?.words ?? [], active: at?.active ?? -1 };
    return layer;
  }
  layer.adjust = resolveAdjust(c.adjust, c.filter);
  layer.chroma = c.chroma.enabled ? c.chroma : null;
  layer.crop = c.crop ?? null;
  layer.mask = c.mask ?? null;
  layer.removeBg = !!c.removeBg;
  if (c.kind === 'image') layer.source = { kind: 'image', assetId: c.assetId };
  else {
    const dur = p.assets[c.assetId]?.duration ?? Infinity;
    layer.source = { kind: 'video', clipId: c.id, assetId: c.assetId, time: clamp(sourceTime(c, t), 0, Math.max(0, dur - 1e-3)) };
  }
  return layer;
}

function solid(color: string, opacity: number): Layer {
  return {
    id: '__dip', source: { kind: 'solid', color }, fit: 'cover', x: 0, y: 0, scale: 1, rotation: 0, opacity,
    adjust: null, chroma: null, crop: null, mask: null, removeBg: false, blend: 'normal', blur: false, wipe: null, selectable: false,
  };
}

/** Mutates the outgoing (a) and incoming (b) layers; may return an extra layer drawn on top. */
export function applyTransition(type: TransitionType, p: number, a: Layer, b: Layer): Layer | null {
  const s = smooth(p);
  switch (type) {
    case 'fade': b.opacity *= p; return null;
    case 'black':
    case 'white':
      if (p < 0.5) b.opacity = 0; else a.opacity = 0;
      return solid(type === 'black' ? '#000000' : '#ffffff', 1 - Math.abs(2 * p - 1));
    case 'slideLeft': a.x -= s; b.x += 1 - s; return null;
    case 'slideRight': a.x += s; b.x -= 1 - s; return null;
    case 'slideUp': a.y -= s; b.y += 1 - s; return null;
    case 'slideDown': a.y += s; b.y -= 1 - s; return null;
    case 'wipeLeft': b.wipe = [-1, 0, s]; return null;
    case 'wipeRight': b.wipe = [1, 0, s]; return null;
    case 'zoom': a.scale *= 1 + s; a.opacity *= 1 - p; b.opacity *= p; b.scale *= 1.2 - 0.2 * s; return null;
  }
}

export function buildFrame(p: Project, t: number): FrameDesc {
  const layers: Layer[] = [];
  const { background } = p.settings;
  const main = mainTrack(p);
  const onMain = main.hidden ? [] : main.clips.filter((c): c is VisualClip => c.kind !== 'audio' && active(c, t));

  const mainLayers = onMain.map((c) => visualLayer(p, c, t));
  let extra: Layer | null = null;
  let primary = mainLayers[0];
  if (mainLayers.length >= 2) {
    const [a, b] = mainLayers.slice(-2);
    const inc = onMain[onMain.length - 1];
    const tr = inc.transitionIn;
    const prog = tr ? clamp((t - inc.start) / tr.duration, 0, 1) : 1;
    extra = applyTransition(tr?.type ?? 'fade', prog, a, b);
    primary = prog < 0.5 ? a : b;
  }
  if (background.mode === 'blur' && primary && primary.source.kind !== 'solid') {
    layers.push({ ...primary, id: '__bg', fit: 'cover', x: 0, y: 0, scale: 1.05, rotation: 0, opacity: 1, blend: 'normal', blur: true, wipe: null, chroma: null, mask: null, removeBg: false, selectable: false });
  }
  layers.push(...mainLayers);
  if (extra) layers.push(extra);

  for (const track of p.tracks) {
    if (track.kind !== 'overlay' || track.hidden) continue;
    for (const c of track.clips) if (c.kind !== 'audio' && active(c, t)) layers.push(visualLayer(p, c, t));
  }
  return { t, background: background.color, layers };
}
