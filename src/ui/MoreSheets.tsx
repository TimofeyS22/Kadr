import { ArrowDown, ArrowUp, BringToFront, Play, SendToBack } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PAUSES, removedSeconds, silenceLevel, speechRanges } from '../core/silence';
import { clipBeatTimes, cutMainToBeats, layerPlace, moveLayer, removeSourceGaps, soundAssetId, type LayerMove } from '../core/timeline';
import type { AudioClip, Clip, ImageClip, Mask, SoundClip, VideoClip } from '../core/types';
import { detectBeats } from '../engine/analysis';
import { PEAKS_PER_SEC, waveform } from '../engine/media';
import { SFX, renderSfx } from '../engine/sfx';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { addSfx, editClip } from './actions';
import { Chips, Slider, Toggle, Values, pct, secs, useSheetGuard } from './controls';
import { t } from '../lib/i18n';
import { useHoldUpdates } from '../lib/update';
import { Button } from './ck/controls';
import { useLookTiles } from './lookTiles';
import { Tiles } from './ck/choice';

// ---------- Remove pauses ----------

const toDb = (a: number) => 20 * Math.log10(a);
const fromDb = (db: number) => 10 ** (db / 20);

export function PausesBody({ clip }: { clip: SoundClip }) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [o, setO] = useState(DEFAULT_PAUSES);
  const from = clip.in, to = clip.in + clip.duration * clip.speed;
  useEffect(() => {
    void waveform(soundAssetId(clip)).then(
      (x) => { setPeaks(x); setO((v) => ({ ...v, threshold: silenceLevel(x, PEAKS_PER_SEC, from, to) })); },
      (e) => { editor().toast(t('Could not read the sound of this clip: {error}', { error: errorMessage(e) }), 'error'); editor().openSheet(null); }, // not "Listening…" for ever
    );
  }, [clip.assetId, clip.audioAssetId]);
  const keep = useMemo(() => (peaks ? speechRanges(peaks, PEAKS_PER_SEC, from, to, o) : []), [peaks, from, to, o]);
  const removed = removedSeconds(keep, from, to) / clip.speed;

  function apply() {
    editor().commit((d) => { removeSourceGaps(d, clip.id, keep); });
    editor().openSheet(null);
    editor().toast(t('Removed {n} pauses, {s} s shorter', { n: keep.length ? keep.length - 1 : 0, s: removed.toFixed(1) }));
    track('pauses_removed', { pauses: Math.max(0, keep.length - 1), seconds: Math.round(removed) });
  }

  if (!peaks) return <p className="ck-hint">{t('Listening to the clip…')}</p>;
  return (
    <>
      <Values label={t('Remove pauses')}>
      <Slider label={t('Silence level')} value={toDb(o.threshold)} min={-60} max={-20} step={1} format={(v) => `${Math.round(v)} dB`} reset={toDb(DEFAULT_PAUSES.threshold)}
        onChange={(v) => setO({ ...o, threshold: fromDb(v) })} />
      <Slider label={t('Shortest pause')} value={o.minPause} min={0.2} max={2} step={0.05} format={secs} reset={DEFAULT_PAUSES.minPause} onChange={(v) => setO({ ...o, minPause: v })} />
      <Slider label={t('Keep around words')} value={o.pad} min={0} max={0.4} step={0.01} format={secs} reset={DEFAULT_PAUSES.pad} onChange={(v) => setO({ ...o, pad: v })} />
      </Values>
      <p className="ck-hint">
        {removed < 0.05 ? t('No pauses found with these settings. Raise the silence level if the background is noisy.')
          : t('Cuts {n} pauses and makes the clip {s} s shorter. You can undo it.', { n: Math.max(0, keep.length - 1), s: removed.toFixed(1) })}
      </p>
      <Button variant="primary" disabled={removed < 0.05} onClick={apply}>{t('Remove pauses')}</Button>
    </>
  );
}

// ---------- Mask ----------

type Shape = 'none' | Mask['shape'];
/** The shapes as tiles: each drawn on the person's own frame (DESIGN.md, Tiles) — the words alone said nothing of what a
 *  «Градиент» does to a picture (the art director, Ч4 release 5). */
const SHAPE_ITEMS: { id: Shape; name: string; cat: string }[] = [
  { id: 'none', name: 'None', cat: 'shape' }, { id: 'circle', name: 'Circle', cat: 'shape' },
  { id: 'rect', name: 'Rectangle', cat: 'shape' }, { id: 'linear', name: 'Gradient', cat: 'shape' },
];
/** A shape on the person's own frame, the frame whole in its proportions inside 72 px: a circle reads as a circle, and
 *  four tiles stand in a row on a 375 px screen (the art director, Ч4). */
function MaskArt({ paint, shape, aspect }: { paint: ReturnType<typeof useLookTiles>; shape: Shape; aspect: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const w = aspect >= 1 ? 72 : Math.round(72 * aspect), h = aspect >= 1 ? Math.round(72 / aspect) : 72;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const k = Math.min(2, devicePixelRatio || 1);
    c.width = Math.round(w * k);
    c.height = Math.round(h * k);
    paint(c, (cl) => { if (shape === 'none') delete cl.mask; else cl.mask = maskFor(shape, aspect); }, undefined, 'mask');
  }, [paint, shape, aspect, w, h]);
  return <canvas ref={ref} style={{ width: w, height: h }} />;
}
/** A new mask of a shape, centred, on a picture of `aspect` (width / height): a circle stays round. */
function maskFor(s: Mask['shape'], aspect: number): Mask {
  const w = 0.7;
  return { shape: s, x: 0.5, y: 0.5, w, h: s === 'circle' ? Math.min(1, w * aspect) : 0.7, rotation: 0, feather: s === 'linear' ? 0.15 : 0.02, roundness: s === 'rect' ? 0.2 : 0, invert: false };
}

export function MaskBody({ clip }: { clip: VideoClip | ImageClip }) {
  const asset = useEditor((s) => s.project?.assets[clip.assetId]);
  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const aspect = asset && asset.height ? (asset.width * crop.w) / (asset.height * crop.h) : 1;
  // Before a shape is picked its values are shown, not settable: the sheet keeps its height when the shape comes, and the
  // frame does not shrink just as the person looks at the mask on it (the art director, Ч4).
  const m = clip.mask ?? maskFor('circle', aspect);
  const off = !clip.mask;
  const set = (patch: Partial<Mask>, key = 'mask') =>
    editClip(clip.id, (c) => { if ((c.kind === 'video' || c.kind === 'image') && c.mask) Object.assign(c.mask, patch); }, `${key}:${clip.id}`);
  const shape = (s: Shape) => editClip(clip.id, (c) => {
    if (c.kind !== 'video' && c.kind !== 'image') return;
    if (s === 'none') delete c.mask;
    else c.mask = maskFor(s, aspect);
  });
  const paint = useLookTiles(clip);
  const now: Shape = clip.mask?.shape ?? 'none';
  return (
    <>
      <div className="ck-mask-tiles">
        <Tiles label={t('Mask')} value={now} onChange={(id) => now !== id && shape(id as Shape)}
          items={SHAPE_ITEMS.map((i) => ({ id: i.id, label: t(i.name), art: <MaskArt paint={paint} shape={i.id} aspect={aspect} /> }))} />
      </div>
      {(
        <>
          <Values label={t('Mask')}>
          {m.shape === 'circle' ? (
            <Slider label={t('Size')} value={m.w} min={0.05} max={1.5} format={pct} reset={0.7} disabled={off} onChange={(v) => set({ w: v, h: v * aspect }, 'msize')} />
          ) : m.shape === 'rect' ? (
            <>
              <Slider label={t('Width')} value={m.w} min={0.05} max={1} format={pct} reset={0.7} disabled={off} onChange={(v) => set({ w: v }, 'mw')} />
              <Slider label={t('Height')} value={m.h} min={0.05} max={1} format={pct} reset={0.7} disabled={off} onChange={(v) => set({ h: v }, 'mh')} />
              <Slider label={t('Round corners')} value={m.roundness} min={0} max={1} format={pct} reset={0.2} disabled={off} onChange={(v) => set({ roundness: v }, 'mr')} />
            </>
          ) : null}
          <Slider label={t('Left ↔ right')} value={m.x} min={0} max={1} format={pct} reset={0.5} disabled={off} onChange={(v) => set({ x: v }, 'mx')} />
          <Slider label={t('Up ↕ down')} value={m.y} min={0} max={1} format={pct} reset={0.5} disabled={off} onChange={(v) => set({ y: v }, 'my')} />
          <Slider label={t('Rotation')} value={m.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} reset={0} disabled={off} onChange={(v) => set({ rotation: v }, 'mrot')} />
          <Slider label={t('Soft edge')} value={m.feather} min={0} max={0.5} format={pct} reset={0.02} disabled={off} onChange={(v) => set({ feather: v }, 'mf')} />
          </Values>
          <Toggle label={t('Invert (keep the outside)')} value={m.invert} disabled={off} onChange={(v) => set({ invert: v })} />
        </>
      )}
      <p className="ck-hint">{t('A circle mask on an overlay makes a classic round picture-in-picture.')}</p>
    </>
  );
}

// ---------- Sound effects ----------

export function SfxBody() {
  const ctx = useRef<AudioContext | null>(null);
  useEffect(() => () => { void ctx.current?.close(); }, []);
  async function preview(id: string) {
    ctx.current ??= new AudioContext();
    const sfx = SFX.find((x) => x.id === id)!;
    const node = ctx.current.createBufferSource();
    node.buffer = await renderSfx(sfx);
    node.connect(ctx.current.destination);
    node.start();
  }
  return (
    <>
      <div className="sfx-grid">
        {SFX.map((s) => (
          <div key={s.id} className="sfx">
            <button className="sfx-add" onClick={() => void addSfx(s.id)} aria-label={t('Add {name} at the playhead', { name: t(s.name) })}>{t(s.name)}</button>
            <button className="icon-btn sfx-play" onClick={() => void preview(s.id)} aria-label={t('Listen to {name}', { name: t(s.name) })}><Play size={16} /></button>
          </div>
        ))}
      </div>
      <p className="ck-hint">{t('Tap a sound to add it at the playhead. These sounds are generated on your device, free to use anywhere.')}</p>
    </>
  );
}

// ---------- Beats ----------

export function BeatsBody({ clip }: { clip: AudioClip }) {
  const grid = useEditor((s) => s.project?.assets[clip.assetId]?.beats);
  const [busy, setBusy] = useState<number | null>(null);
  useHoldUpdates(busy !== null);
  useSheetGuard(busy !== null ? t('This is still running. Tap again to stop it.') : null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function detect() {
    const p = editor().project;
    if (!p) return;
    const ac = new AbortController();
    abort.current = ac;
    setBusy(0);
    try {
      const g = await detectBeats(p, clip.assetId, setBusy, ac.signal);
      if (!g) { editor().toast(t('No steady beat found in this sound')); return; }
      editor().commit((d) => { const a = d.assets[clip.assetId]; if (a) a.beats = g; });
      track('beats_detected', { bpm: Math.round(g.bpm) });
    } catch (e) {
      if ((e as Error).name !== 'AbortError') editor().toast(t('Beat detection failed: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setBusy(null);
    }
  }

  function cut(every: number) {
    const p = editor().project;
    if (!p) return;
    let moved = 0;
    editor().commit((d) => { moved = cutMainToBeats(d, clipBeatTimes(p, clip), every); });
    editor().toast(moved ? t('{n} cuts now land on the beat', { n: moved }) : t('Add photos or videos to the main track first'));
    track('cut_to_beat', { every, moved });
  }

  if (busy !== null) {
    return (
      <div className="inline-progress">
        <span>{t('Listening for the beat… {p}%', { p: Math.round(busy * 100) })}</span>
        <Button onClick={() => abort.current?.abort()}>{t('Cancel')}</Button>
      </div>
    );
  }
  if (!grid) {
    return (
      <>
        <p className="ck-hint">{t('Find the beat of this music to see beat marks on the timeline, snap edits to them and cut your clips in rhythm.')}</p>
        <Button variant="primary" onClick={() => void detect()}>{t('Find the beat')}</Button>
      </>
    );
  }
  return (
    <>
      <p className="beat-bpm"><b>{Math.round(grid.bpm)}</b> {t('BPM')}</p>
      <h3>{t('Cut the main track on')}</h3>
      <Chips options={[1, 2, 4] as const} value={null} render={(n) => (n === 1 ? t('every beat') : t('every {n} beats', { n }))} onChange={cut} />
      <p className="ck-hint">{t('Edges of clips also snap to the beat marks when you trim or move them.')}</p>
      <Button onClick={() => void detect()}>{t('Detect again')}</Button>
    </>
  );
}

const LAYER_MOVES: { dir: LayerMove; label: string; icon: typeof ArrowUp }[] = [
  { dir: 'front', label: 'To the front', icon: BringToFront },
  { dir: 'up', label: 'Up one layer', icon: ArrowUp },
  { dir: 'down', label: 'Down one layer', icon: ArrowDown },
  { dir: 'back', label: 'To the back', icon: SendToBack },
];

/**
 * Layers (v1.6, the owner: "a layers function, so the overlay lies under the captions"): what is drawn over what,
 * among the clips on screen at the same time. The main video is always the bottom.
 */
export function LayersBody({ clip }: { clip: Clip }) {
  const project = useEditor((s) => s.project); // a selector must not build a new object per call (zustand loops)
  const place = useMemo(() => (project ? layerPlace(project, clip.id) : null), [project, clip.id]);
  if (!place) return <p className="ck-hint">{t('The main video is the bottom layer. Overlays, text and captions go over it.')}</p>;
  const move = (dir: LayerMove) => {
    let moved = false;
    editor().commit((d) => { moved = moveLayer(d, clip.id, dir); });
    if (moved) track('layer_moved', { dir, kind: clip.kind });
  };
  const alone = place.above + place.below === 0;
  return (
    <>
      <p className="ck-hint" role="status">
        {alone ? t('Nothing else is on screen with this clip.') : t('Over it: {above}. Under it: {below}.', { above: place.above, below: place.below })}
      </p>
      <div className="layer-moves">
        {LAYER_MOVES.map(({ dir, label, icon: Icon }) => (
          <Button key={dir} icon={<Icon aria-hidden="true" />} disabled={dir === 'front' || dir === 'up' ? !place.above : !place.below} onClick={() => move(dir)}>
            {t(label)}
          </Button>
        ))}
      </div>
      <p className="ck-hint">{t('Layers count only what is on screen at the same time. A new overlay goes under captions and text.')}</p>
    </>
  );
}
