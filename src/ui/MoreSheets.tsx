import { Play } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PAUSES, removedSeconds, speechRanges } from '../core/silence';
import { clipEnd, cutMainToBeats, keepSourceRanges, soundAssetId, sourceSpan, timelineTimeOf } from '../core/timeline';
import type { AudioClip, ImageClip, Mask, Project, SoundClip, VideoClip } from '../core/types';
import { detectBeats } from '../engine/analysis';
import { PEAKS_PER_SEC, waveform } from '../engine/media';
import { SFX, renderSfx } from '../engine/sfx';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { addSfx, editClip } from './actions';
import { Chips, Slider, Toggle, pct, secs } from './controls';
import { t } from './i18n';

// ---------- Remove pauses ----------

const toDb = (a: number) => 20 * Math.log10(a);
const fromDb = (db: number) => 10 ** (db / 20);

export function PausesBody({ clip }: { clip: SoundClip }) {
  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [o, setO] = useState(DEFAULT_PAUSES);
  useEffect(() => { void waveform(soundAssetId(clip)).then(setPeaks); }, [clip.assetId, clip.audioAssetId]);
  const from = clip.in, to = clip.in + clip.duration * clip.speed;
  const keep = useMemo(() => (peaks ? speechRanges(peaks, PEAKS_PER_SEC, from, to, o) : []), [peaks, from, to, o]);
  const removed = removedSeconds(keep, from, to) / clip.speed;

  function apply() {
    editor().commit((d) => { keepSourceRanges(d, clip.id, keep); });
    editor().openSheet(null);
    editor().toast(t('Removed {n} pauses, {s} s shorter', { n: keep.length ? keep.length - 1 : 0, s: removed.toFixed(1) }));
    track('pauses_removed', { pauses: Math.max(0, keep.length - 1), seconds: Math.round(removed) });
  }

  if (!peaks) return <p className="hint">{t('Listening to the clip…')}</p>;
  return (
    <>
      <Slider label={t('Silence level')} value={toDb(o.threshold)} min={-60} max={-20} step={1} format={(v) => `${Math.round(v)} dB`} reset={toDb(DEFAULT_PAUSES.threshold)}
        onChange={(v) => setO({ ...o, threshold: fromDb(v) })} />
      <Slider label={t('Shortest pause')} value={o.minPause} min={0.2} max={2} step={0.05} format={secs} reset={DEFAULT_PAUSES.minPause} onChange={(v) => setO({ ...o, minPause: v })} />
      <Slider label={t('Keep around words')} value={o.pad} min={0} max={0.4} step={0.01} format={secs} reset={DEFAULT_PAUSES.pad} onChange={(v) => setO({ ...o, pad: v })} />
      <p className="hint">
        {removed < 0.05 ? t('No pauses found with these settings. Raise the silence level if the background is noisy.')
          : t('Cuts {n} pauses and makes the clip {s} s shorter. You can undo it.', { n: Math.max(0, keep.length - 1), s: removed.toFixed(1) })}
      </p>
      <button className="btn primary big" disabled={removed < 0.05} onClick={apply}>{t('Remove pauses')}</button>
    </>
  );
}

// ---------- Mask ----------

const SHAPES = ['none', 'circle', 'rect', 'linear'] as const;
const SHAPE_LABEL = { none: 'None', circle: 'Circle', rect: 'Rectangle', linear: 'Gradient' };

export function MaskBody({ clip }: { clip: VideoClip | ImageClip }) {
  const asset = useEditor((s) => s.project?.assets[clip.assetId]);
  const crop = clip.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const aspect = asset && asset.height ? (asset.width * crop.w) / (asset.height * crop.h) : 1;
  const m = clip.mask;
  const set = (patch: Partial<Mask>, key = 'mask') =>
    editClip(clip.id, (c) => { if ((c.kind === 'video' || c.kind === 'image') && c.mask) Object.assign(c.mask, patch); }, `${key}:${clip.id}`);
  const shape = (s: (typeof SHAPES)[number]) => editClip(clip.id, (c) => {
    if (c.kind !== 'video' && c.kind !== 'image') return;
    if (s === 'none') { delete c.mask; return; }
    const w = 0.7;
    c.mask = { shape: s, x: 0.5, y: 0.5, w, h: s === 'circle' ? Math.min(1, w * aspect) : 0.7, rotation: 0, feather: s === 'linear' ? 0.15 : 0.02, roundness: s === 'rect' ? 0.2 : 0, invert: false };
  });
  return (
    <>
      <Chips options={SHAPES} value={m?.shape ?? 'none'} render={(s) => SHAPE_LABEL[s]} onChange={shape} />
      {m && (
        <>
          {m.shape === 'circle' ? (
            <Slider label={t('Size')} value={m.w} min={0.05} max={1.5} format={pct} reset={0.7} onChange={(v) => set({ w: v, h: v * aspect }, 'msize')} />
          ) : m.shape === 'rect' ? (
            <>
              <Slider label={t('Width')} value={m.w} min={0.05} max={1} format={pct} reset={0.7} onChange={(v) => set({ w: v }, 'mw')} />
              <Slider label={t('Height')} value={m.h} min={0.05} max={1} format={pct} reset={0.7} onChange={(v) => set({ h: v }, 'mh')} />
              <Slider label={t('Round corners')} value={m.roundness} min={0} max={1} format={pct} reset={0.2} onChange={(v) => set({ roundness: v }, 'mr')} />
            </>
          ) : null}
          <Slider label={t('Left ↔ right')} value={m.x} min={0} max={1} format={pct} reset={0.5} onChange={(v) => set({ x: v }, 'mx')} />
          <Slider label={t('Up ↕ down')} value={m.y} min={0} max={1} format={pct} reset={0.5} onChange={(v) => set({ y: v }, 'my')} />
          <Slider label={t('Rotation')} value={m.rotation} min={-180} max={180} step={1} format={(v) => `${Math.round(v)}°`} reset={0} onChange={(v) => set({ rotation: v }, 'mrot')} />
          <Slider label={t('Soft edge')} value={m.feather} min={0} max={0.5} format={pct} reset={0.02} onChange={(v) => set({ feather: v }, 'mf')} />
          <Toggle label={t('Invert (keep the outside)')} value={m.invert} onChange={(v) => set({ invert: v })} />
        </>
      )}
      <p className="hint">{t('A circle mask on an overlay makes a classic round picture-in-picture.')}</p>
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
      <p className="hint">{t('Tap a sound to add it at the playhead. These sounds are generated on your device, free to use anywhere.')}</p>
    </>
  );
}

// ---------- Beats ----------

/** Beat times of an audio clip on the timeline (source beats mapped through speed and curves). */
export function clipBeatTimes(p: Project, clip: AudioClip): number[] {
  const beats = p.assets[clip.assetId]?.beats;
  if (!beats) return [];
  const end = clip.in + sourceSpan(clip);
  return beats.times.filter((s) => s >= clip.in && s <= end).map((s) => timelineTimeOf(clip, s)).filter((t) => t <= clipEnd(clip));
}

export function BeatsBody({ clip }: { clip: AudioClip }) {
  const grid = useEditor((s) => s.project?.assets[clip.assetId]?.beats);
  const [busy, setBusy] = useState<number | null>(null);
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
        <button className="btn" onClick={() => abort.current?.abort()}>{t('Cancel')}</button>
      </div>
    );
  }
  if (!grid) {
    return (
      <>
        <p className="hint">{t('Find the beat of this music to see beat marks on the timeline, snap edits to them and cut your clips in rhythm.')}</p>
        <button className="btn primary big" onClick={() => void detect()}>{t('Find the beat')}</button>
      </>
    );
  }
  return (
    <>
      <p className="beat-bpm"><b>{Math.round(grid.bpm)}</b> {t('BPM')}</p>
      <h3>{t('Cut the main track on')}</h3>
      <Chips options={[1, 2, 4] as const} value={null} render={(n) => (n === 1 ? t('every beat') : t('every {n} beats', { n }))} onChange={cut} />
      <p className="hint">{t('Edges of clips also snap to the beat marks when you trim or move them.')}</p>
      <button className="btn" onClick={() => void detect()}>{t('Detect again')}</button>
    </>
  );
}
