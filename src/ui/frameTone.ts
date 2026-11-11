// How light, and how busy, the picture is under a text (docs/18 Ш6): the band of the frame where the text stands, at the
// playhead if it is on the text, else at its middle. A font pair is set in light or dark letters by it, and offers a box
// on a busy picture. Read once when the text sheet opens, so a tap on a pair never waits for the decoder.
import { evalAnim } from '../core/anim';
import { visualLayer } from '../core/frame';
import { clipEnd, mainTrack } from '../core/timeline';
import type { ImageClip, Project, TextClip, VideoClip } from '../core/types';
import { player } from '../engine/player';

export interface Tone { mean: number; spread: number }

const W = 36, H = 64; // enough for a mean and a spread, and cheap
const lin = (v: number) => { const c = v / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

/** Mean and standard deviation of WCAG luminance over rows `from`…`to` (0 top … 1 bottom) of `image`. */
function measure(image: CanvasImageSource, from: number, to: number): Tone {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, W, H);
  const y0 = Math.max(0, Math.floor(from * H)), y1 = Math.min(H, Math.max(y0 + 1, Math.ceil(to * H)));
  const px = ctx.getImageData(0, y0, W, y1 - y0).data;
  c.width = 0;
  const ls: number[] = [];
  for (let i = 0; i < px.length; i += 4) ls.push(0.2126 * lin(px[i]) + 0.7152 * lin(px[i + 1]) + 0.0722 * lin(px[i + 2]));
  const mean = ls.reduce((a, b) => a + b, 0) / ls.length;
  return { mean, spread: Math.sqrt(ls.reduce((a, b) => a + (b - mean) ** 2, 0) / ls.length) };
}

export async function toneUnder(p: Project, clip: TextClip, now: number): Promise<Tone | null> {
  const at = now >= clip.start && now < clipEnd(clip) ? now : clip.start + clip.duration / 2;
  const y = 0.5 + evalAnim(clip.transform.y, at - clip.start);
  const band: [number, number] = [y - 0.08, y + 0.08];
  const under = mainTrack(p).clips.find((c): c is VideoClip | ImageClip => (c.kind === 'video' || c.kind === 'image') && at >= c.start && at < clipEnd(c));
  if (!under) {
    // No picture: the text lies on the project's background colour.
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = p.settings.background.color;
    ctx.fillRect(0, 0, 1, 1);
    return measure(c, 0, 1);
  }
  const s = visualLayer(p, under, at).source;
  if (s.kind === 'video') {
    const f = await player.pool.picture(s.clipId, s.assetId, s.time, false, 0); // 0: an upright canvas, not a decoder frame
    return f ? measure((f as typeof f & { image: CanvasImageSource }).image, ...band) : null;
  }
  if (s.kind === 'image') return measure(await player.pool.image(s.assetId), ...band);
  return null;
}
