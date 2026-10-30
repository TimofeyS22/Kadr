import type { FrameDesc } from '../core/frame';
import { slotOf, type Source } from './compositor';
import type { MediaPool } from './media';
import { faceBoxes } from './faces';
import { personMask } from './segment';
import { ensureFont, type TextRasterizer } from './text';

/**
 * Fetches every texture a frame needs (video frames decode in parallel across clips). `frameMax` is the compositor's:
 * exact video frames up to that size go to the GPU as the decoder made them.
 */
export async function resolveDrawables(
  desc: FrameDesc, pool: MediaPool, text: TextRasterizer, W: number, H: number, fast = false, frameMax = 0,
): Promise<Map<string, Source>> {
  const out = new Map<string, Source>();
  const jobs = new Map<string, Promise<void>>();
  const cutout = new Set(desc.layers.filter((l) => l.removeBg).map(slotOf));
  const faces = new Set(desc.layers.filter((l) => l.privacy?.faces).map(slotOf));
  for (const l of desc.layers) {
    const slot = slotOf(l);
    if (!slot || jobs.has(slot)) continue;
    const s = l.source;
    jobs.set(slot, (async () => {
      if (s.kind === 'video') {
        // The person cutout and face detection read the pixels on this thread, upright: those layers keep a canvas.
        const f = await pool.picture(s.clipId, s.assetId, s.time, fast, cutout.has(slot) || faces.has(slot) ? 0 : frameMax);
        if (f) out.set(slot, { image: f.image, w: f.width, h: f.height, turn: f.turn, key: `${s.clipId}:${f.timestamp}:${f.exact ? 1 : 0}`, approx: !f.exact });
      } else if (s.kind === 'image') {
        const b = await pool.image(s.assetId);
        out.set(slot, { image: b, w: b.width, h: b.height, key: s.assetId });
      } else if (s.kind === 'text') {
        await ensureFont(s.clip.style, s.clip.text);
        const d = text.get(s.clip, s.chars, W, H);
        if (d) out.set(slot, d);
      } else if (s.kind === 'caption') {
        await ensureFont(s.clip.style, s.words.join(' '));
        const d = text.getCaption(s.clip, s.words, s.active, s.shown, W, H);
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
  await Promise.all([...faces].map(async (slot) => {
    const d = slot ? out.get(slot) : undefined;
    // Fail closed: if detection fails, hide the whole picture rather than show faces the user asked to hide.
    if (d) d.faces = await faceBoxes(d.key, d.image, d.w, d.h).catch(() => [{ x: 0, y: 0, w: 1, h: 1 }]);
  }));
  return out;
}
