import type { FrameDesc } from '../core/frame';
import { slotOf } from './compositor';
import type { MediaPool } from './media';
import { faceBoxes } from './faces';
import { personMask } from './segment';
import type { Drawable, TextRasterizer } from './text';

/** Fetches every texture a frame needs (video frames decode in parallel across clips). */
export async function resolveDrawables(
  desc: FrameDesc, pool: MediaPool, text: TextRasterizer, W: number, H: number,
): Promise<Map<string, Drawable>> {
  const out = new Map<string, Drawable>();
  const jobs = new Map<string, Promise<void>>();
  const cutout = new Set(desc.layers.filter((l) => l.removeBg).map(slotOf));
  for (const l of desc.layers) {
    const slot = slotOf(l);
    if (!slot || jobs.has(slot)) continue;
    const s = l.source;
    jobs.set(slot, (async () => {
      if (s.kind === 'video') {
        const f = await pool.frame(s.clipId, s.assetId, s.time);
        if (f) out.set(slot, { image: f.canvas, w: f.canvas.width, h: f.canvas.height, key: `${s.clipId}:${f.timestamp}` });
      } else if (s.kind === 'image') {
        const b = await pool.image(s.assetId);
        out.set(slot, { image: b, w: b.width, h: b.height, key: s.assetId });
      } else if (s.kind === 'text') {
        const d = text.get(s.clip, s.chars, W, H);
        if (d) out.set(slot, d);
      } else if (s.kind === 'caption') {
        const d = text.getCaption(s.clip, s.words, s.active, W, H);
        if (d) out.set(slot, d);
      }
    })());
  }
  await Promise.all(jobs.values());
  // Person masks for layers with "Remove background" (computed after decoding; cached per frame).
  await Promise.all([...cutout].map(async (slot) => {
    const d = slot ? out.get(slot) : undefined;
    if (d) d.seg = (await personMask(d.key, d.image).catch(() => null)) ?? undefined;
  }));
  // Face boxes for layers that hide faces (cached per frame, like person masks).
  const faces = new Set(desc.layers.filter((l) => l.privacy?.faces).map(slotOf));
  await Promise.all([...faces].map(async (slot) => {
    const d = slot ? out.get(slot) : undefined;
    // Fail closed: if detection fails, hide the whole picture rather than show faces the user asked to hide.
    if (d) d.faces = await faceBoxes(d.key, d.image, d.w, d.h).catch(() => [{ x: 0, y: 0, w: 1, h: 1 }]);
  }));
  return out;
}
