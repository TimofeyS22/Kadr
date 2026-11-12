// Live previews for looks (filters, LUTs, adjustments, effects): the clip's own frame through the same buildFrame layer
// and Compositor as the video, so a tile shows what the choice really gives (principle 3). One small WebGL context while
// the sheet is open; it and the copied frame go when the sheet closes.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { visualLayer, type Layer } from '../core/frame';
import { clipEnd } from '../core/timeline';
import type { ImageClip, Project, VideoClip } from '../core/types';
import { Compositor, slotOf, type Source } from '../engine/compositor';
import { player } from '../engine/player';
import { useEditor } from '../state/store';

export type LookClip = VideoClip | ImageClip;

/** Long side of the frame copy: a tile is at most ~310 device pixels wide. */
const POSTER_SIDE = 480;

/** The moment a tile shows: the playhead if it is on this clip, otherwise the clip's middle. */
function posterTime(c: LookClip, now: number): number {
  return now >= c.start && now < clipEnd(c) ? now : c.start + c.duration / 2;
}

/** A private copy of the clip's frame: the decoder's canvases are reused for the next frame. */
async function readPoster(p: Project, c: LookClip, at: number): Promise<Source | null> {
  const s = visualLayer(p, c, at).source;
  let image: CanvasImageSource, w: number, h: number, hdr: Source['hdr'];
  if (s.kind === 'video') {
    const f = await player.pool.picture(s.clipId, s.assetId, s.time, false, 0); // 0: an upright canvas, not a decoder frame
    if (!f) return null;
    ({ image, width: w, height: h, hdr } = f as typeof f & { image: CanvasImageSource });
  } else if (s.kind === 'image') {
    const b = await player.pool.image(s.assetId);
    image = b; w = b.width; h = b.height;
  } else return null;
  const k = Math.min(1, POSTER_SIDE / Math.max(w, h));
  const copy = document.createElement('canvas');
  copy.width = Math.max(1, Math.round(w * k));
  copy.height = Math.max(1, Math.round(h * k));
  copy.getContext('2d')!.drawImage(image, 0, 0, copy.width, copy.height);
  return { image: copy, w: copy.width, h: copy.height, hdr, key: `look:${c.id}:${at}` };
}

/** The tile's view of a layer: the whole picture, nothing of its place in the project but its crop and mirror. */
const tileLayer = (l: Layer): Layer => ({
  ...l, x: 0, y: 0, scale: 1, rotation: 0, opacity: 1, fit: 'cover', blend: 'normal', mask: null, wipe: null, privacy: null, chroma: null, removeBg: false, blur: false,
});

/** Paints `canvas` with the clip after `edit`. Identity changes when the tiles have to be repainted. `keep: 'mask'`: the
 *  tile shows the piece's mask (the mask sheet's own tiles), which every other look leaves out. */
export function useLookTiles(clip: LookClip): (canvas: HTMLCanvasElement, edit: (c: LookClip) => void, play?: number, keep?: 'mask') => void {
  const project = useEditor((s) => s.project);
  const at = useMemo(() => posterTime(clip, useEditor.getState().time), [clip.id]); // eslint-disable-line react-hooks/exhaustive-deps
  const [poster, setPoster] = useState<Source | null>(null);
  const [comp, setComp] = useState<Compositor | null>(null);

  useEffect(() => {
    let gone = false;
    const p = useEditor.getState().project;
    if (p) void readPoster(p, clip, at).then((s) => { if (!gone) setPoster(s); }, (e: unknown) => console.warn('look tiles: no frame', e));
    return () => { gone = true; };
  }, [clip.id, at]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let made: Compositor | null = null;
    try {
      made = new Compositor(document.createElement('canvas'));
      setComp(made);
    } catch (e) {
      console.warn('look tiles: no WebGL context', e); // the tiles keep their names
    }
    return () => { made?.dispose(true); setComp(null); };
  }, []);

  useEffect(() => () => {
    if (poster?.image instanceof HTMLCanvasElement) poster.image.width = 0; // the memory goes now, not at the next collection
  }, [poster]);

  return useCallback((canvas, edit, play, keep) => {
    if (!poster || !comp || !project) return;
    if (comp.canvas.width !== canvas.width || comp.canvas.height !== canvas.height) {
      comp.canvas.width = canvas.width;
      comp.canvas.height = canvas.height;
    }
    const candidate = structuredClone(clip);
    edit(candidate);
    // An effect that moves the picture (shake, zoom punch) is that move: the tile keeps it, measured from the piece without
    // the effect, at the moment the effect is at its height (a punch lands every half second). They looked like «Нет».
    // `play`: seconds into the tile's own loop, for an effect that is a motion (shake, glitch): a still frame cannot show it.
    const when = play === undefined ? at : clip.start + ((at - clip.start + play) % Math.max(clip.duration, 1e-3));
    const plain = { ...candidate, effect: undefined };
    const moved = visualLayer(project, candidate, when), still = visualLayer(project, plain, when);
    const layer = { ...tileLayer(moved), x: moved.x - still.x, y: moved.y - still.y, scale: moved.scale / (still.scale || 1), rotation: moved.rotation - still.rotation, ...(keep === 'mask' ? { mask: moved.mask } : {}) };
    const slot = slotOf(layer);
    if (!slot) return;
    comp.draw({ t: when, background: '#000', layers: [layer] }, new Map([[slot, poster]]));
    // In the same task as the draw: the context does not keep its picture afterwards.
    canvas.getContext('2d')?.drawImage(comp.canvas, 0, 0);
  }, [clip, project, poster, comp, at]);
}
