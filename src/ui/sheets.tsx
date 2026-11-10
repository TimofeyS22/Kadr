import { TrianglesCenterlineDashedVertical, TrianglesCenterlineDashedHorizontal } from 'lucide-react';
import { produce } from 'immer';
import { useEffect, useMemo, useRef, useState } from 'react';
import { evalAnim, hasKeys, keyIndexAt, setAnim, toggleKey } from '../core/anim';
import { TEXT_CATEGORIES, TEXT_PRESETS } from '../core/presets';
import { ASPECTS, defaultAdjust, defaultTransform } from '../core/defaults';
import { FILTERS, FILTER_CATEGORIES, adjustRange } from '../core/filters';
import { LookActions } from './LookControls';
import { IosFormatBody } from './IosFormatSheet';
import { useLookTiles, type LookClip } from './lookTiles';
import { CURVE_PRESETS } from '../core/speed';
import { applyTransitionToAll, expectedAudioKey, findClip, keepsPitch, setCurve, setSpeed, setTransition, isSound } from '../core/timeline';
import { CurveEditor } from './CurveEditor';
import {
  ADJUST_KEYS, TEXT_ANIM_TYPES, TEXT_LOOP_TYPES, TRANSITION_TYPES,
  type AdjustKey, type AspectId, type BlendMode, type Clip, type SoundClip, type TextAnimType, type TextClip,
  type Transform, type Transition,
} from '../core/types';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor, type SheetId } from '../state/store';
import { detachSelectedAudio, editClip, updateClipSound, toggleFlip } from './actions';
import { Chips, ClipScrub, Sheet, Slider, Swatches, Toggle, pct, secs, signed, useSheetGuard } from './controls';
import { StylePicker, type TileDraw } from './picker';
import { FontPicker } from './FontPicker';
import { TextLook } from './TextLook';
import { drawTextTile } from './tiles';
import { CameraSheet } from './CameraSheet';
import { licenseText } from '../core/music';
import { VOICE_IDS, VOICE_LABEL } from '../core/voicefx';
import { MusicBody } from './MusicSheet';
import { ReelBody } from './ReelSheet';
import { ExportSheet } from './ExportSheet';
import { EffectsBody, LutSection, PrivacyBody } from './FxSheets';
import { CaptionEditBody, CaptionsBody, CropBody, StickersBody, VoiceoverBody } from './ToolSheets';
import { BeatsBody, LayersBody, MaskBody, PausesBody, SfxBody } from './MoreSheets';
import { t } from '../lib/i18n';
import { useHoldUpdates } from '../lib/update';
import { TRANSITION_LABELS } from './transitionNames';

function useSelected(): Clip | null {
  return useEditor((s) => (s.project && s.selection ? findClip(s.project, s.selection)?.clip ?? null : null));
}

const TITLES: Record<SheetId, string> = {
  speed: 'Speed', volume: 'Volume', adjust: 'Adjust', filters: 'Filters', transform: 'Transform & keyframes',
  text: 'Text', transition: 'Transition', canvas: 'Canvas', export: 'Export',
  crop: 'Crop', captions: 'Auto captions', captionEdit: 'Captions', voiceover: 'Voice-over', stickers: 'Stickers',
  pauses: 'Remove pauses', mask: 'Mask', sfx: 'Sound effects', beats: 'Beat', effects: 'Effects', privacy: 'Hide faces', camera: 'Camera', music: 'Music', reel: 'Reel in 1 tap', chroma: 'Chroma key', voice: 'Voice', layers: 'Layers', iosFormat: 'Videos in seconds',
};

/** The sheets that are about the project, not about a selected clip. */
const NO_CLIP = new Set<SheetId>(['export', 'camera', 'music', 'reel', 'canvas', 'transition', 'captions', 'voiceover', 'stickers', 'sfx', 'iosFormat']);

export function Sheets() {
  const sheet = useEditor((s) => s.sheet);
  const clip = useSelected();
  // A sheet about a clip outlives its clip after an Undo: nothing to show, and the editor stays folded for it (audit V-158).
  const orphan = !!sheet && !clip && !NO_CLIP.has(sheet);
  useEffect(() => { if (orphan) useEditor.getState().openSheet(null); }, [orphan]);
  if (!sheet) return null;
  if (sheet === 'export') return <ExportSheet />;
  if (sheet === 'camera') return <CameraSheet />;
  if (sheet === 'music') return <Sheet title={TITLES.music}><MusicBody /></Sheet>;
  if (sheet === 'reel') return <Sheet title={TITLES.reel}><ReelBody /></Sheet>;
  if (sheet === 'iosFormat') return <Sheet title={TITLES.iosFormat}><IosFormatBody /></Sheet>;
  if (sheet === 'canvas') return <Sheet title={TITLES.canvas}><CanvasBody /></Sheet>;
  if (sheet === 'transition') return <Sheet title={TITLES.transition}><TransitionBody /></Sheet>;
  if (sheet === 'captions') return <Sheet title={TITLES.captions}><CaptionsBody /></Sheet>;
  if (sheet === 'voiceover') return <Sheet title={TITLES.voiceover}><VoiceoverBody /></Sheet>;
  if (sheet === 'stickers') return <Sheet title={TITLES.stickers}><StickersBody /></Sheet>;
  if (sheet === 'sfx') return <Sheet title={TITLES.sfx}><SfxBody /></Sheet>;
  if (!clip) return null;
  return (
    <Sheet title={TITLES[sheet]}>
      {sheet === 'speed' && <SpeedBody clip={clip} />}
      {sheet === 'volume' && <VolumeBody clip={clip} />}
      {sheet === 'adjust' && (clip.kind === 'video' || clip.kind === 'image') && <AdjustBody clip={clip} />}
      {sheet === 'filters' && (clip.kind === 'video' || clip.kind === 'image') && <FiltersBody clip={clip} />}
      {sheet === 'transform' && <TransformBody clip={clip} />}
      {sheet === 'chroma' && (clip.kind === 'video' || clip.kind === 'image') && <ChromaControls clip={clip} />}
      {sheet === 'voice' && isSound(clip) && <VoiceBody clip={clip} />}
      {sheet === 'text' && clip.kind === 'text' && <TextBody clip={clip} />}
      {sheet === 'crop' && (clip.kind === 'video' || clip.kind === 'image') && <CropBody clip={clip} />}
      {sheet === 'captionEdit' && clip.kind === 'caption' && <CaptionEditBody clip={clip} />}
      {sheet === 'pauses' && (clip.kind === 'video' || clip.kind === 'audio') && <PausesBody clip={clip} />}
      {sheet === 'mask' && (clip.kind === 'video' || clip.kind === 'image') && <MaskBody clip={clip} />}
      {sheet === 'beats' && clip.kind === 'audio' && <BeatsBody clip={clip} />}
      {sheet === 'effects' && (clip.kind === 'video' || clip.kind === 'image') && <EffectsBody clip={clip} />}
      {sheet === 'privacy' && (clip.kind === 'video' || clip.kind === 'image') && <PrivacyBody clip={clip} />}
      {sheet === 'layers' && <LayersBody clip={clip} />}
    </Sheet>
  );
}

const SPEEDS = [0.25, 0.5, 1, 1.25, 1.5, 2, 4] as const;
const toPos = (s: number) => Math.log(s / 0.1) / Math.log(100);
const fromPos = (p: number) => Math.round(0.1 * 100 ** p * 100) / 100;

function SpeedBody({ clip }: { clip: Clip }) {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return null;
  const set = (v: number) => useEditor.getState().commit((d) => setSpeed(d, clip.id, v), `speed:${clip.id}`);
  const curve = (points: number[] | null, key?: string) => useEditor.getState().commit((d) => setCurve(d, clip.id, points), key);
  const preset = clip.curve && CURVE_PRESETS.find((p) => p.points.join() === clip.curve!.join())?.id;
  return (
    <>
      <Chips options={['normal', 'curve'] as const} value={clip.curve ? 'curve' : 'normal'} render={(m) => (m === 'normal' ? t('Normal') : t('Curve'))}
        onChange={(m) => curve(m === 'curve' ? CURVE_PRESETS[0].points : null)} />
      <Slider label={clip.curve ? t('Base speed') : t('Speed')} value={toPos(clip.speed)} min={0} max={1} step={0.001} format={() => `${clip.speed}×`} onChange={(p) => set(fromPos(p))} reset={toPos(1)} />
      {clip.curve ? (
        <>
          <Chips options={CURVE_PRESETS.map((p) => p.id)} value={preset ?? null} render={(id) => CURVE_PRESETS.find((p) => p.id === id)!.name}
            onChange={(id) => curve(CURVE_PRESETS.find((p) => p.id === id)!.points)} />
          <CurveEditor points={clip.curve} onChange={(pts) => curve(pts, `curve:${clip.id}`)} />
          <p className="hint">{t('Drag the points: up is faster, down is slower. The sound follows the curve like tape.')}</p>
        </>
      ) : (
        <>
          <Chips options={SPEEDS} value={clip.speed} onChange={set} render={(v) => `${v}×`} />
          <KeepPitchToggle clip={clip} />
        </>
      )}
    </>
  );
}

function VolumeBody({ clip }: { clip: Clip }) {
  if (clip.kind !== 'video' && clip.kind !== 'audio') return null;
  const e = (fn: (c: SoundClip) => void, key: string) =>
    editClip(clip.id, (c) => { if (c.kind === 'video' || c.kind === 'audio') fn(c); }, `${key}:${clip.id}`);
  const maxFade = Math.min(5, clip.duration / 2);
  return (
    <>
      <Slider label={t('Volume')} value={clip.volume} min={0} max={2} format={pct} reset={1} onChange={(v) => e((c) => { c.volume = v; }, 'vol')} />
      <Slider label={t('Fade in')} value={clip.fadeIn} min={0} max={maxFade} step={0.05} format={secs} reset={0} onChange={(v) => e((c) => { c.fadeIn = v; }, 'fi')} />
      <Slider label={t('Fade out')} value={clip.fadeOut} min={0} max={maxFade} step={0.05} format={secs} reset={0} onChange={(v) => e((c) => { c.fadeOut = v; }, 'fo')} />
      <Toggle label={t('Mute')} value={clip.muted} onChange={(v) => e((c) => { c.muted = v; }, 'mute')} />
      <EnhanceToggle clip={clip} />
      {!clip.enhance && <DenoiseToggle clip={clip} />}
      {clip.kind === 'audio' && (
        <>
          <Toggle label={t('Lower when others speak')} value={(clip.duck ?? 0) > 0} onChange={(v) => e((c) => { c.duck = v ? 0.7 : 0; }, 'duck')} />
          {(clip.duck ?? 0) > 0 && (
            <Slider label={t('How much')} value={clip.duck ?? 0.7} min={0.2} max={0.95} format={pct} reset={0.7} onChange={(v) => e((c) => { c.duck = v; }, 'duckd')} />
          )}
          <Toggle label={t('Guide track: plays while editing, not exported')} value={!!clip.guide} onChange={(v) => e((c) => { c.guide = v; }, 'guide')} />
          {clip.guide && <p className="hint">{t('Edit to any song, even a trending one, then add it in TikTok or Instagram: there it is licensed.')}</p>}
          <LicenseButton assetId={clip.assetId} />
        </>
      )}
      {clip.kind === 'video' && <button className="btn" onClick={detachSelectedAudio}>{t('Extract audio to its own track')}</button>}
    </>
  );
}

const ADJUST_LABELS: Record<AdjustKey, string> = {
  exposure: 'Exposure', brightness: 'Brightness', contrast: 'Contrast', saturation: 'Saturation', temperature: 'Temperature',
  tint: 'Tint', highlights: 'Highlights', shadows: 'Shadows', fade: 'Fade', vignette: 'Vignette', sharpen: 'Sharpen', grain: 'Grain',
};

const ADJUST_ITEMS: { id: AdjustKey; name: string; cat: string }[] = (['exposure', 'brightness', 'contrast', 'highlights', 'shadows', 'saturation', 'temperature', 'tint', 'fade', 'vignette', 'sharpen', 'grain'] as const)
  .map((id, i) => ({ id, name: ADJUST_LABELS[id], cat: i < 5 ? 'light' : i < 8 ? 'colour' : 'detail' }));
const ADJUST_CATEGORIES = [{ id: 'light', name: 'Light' }, { id: 'colour', name: 'Colour' }, { id: 'detail', name: 'Detail' }];

/** One slider under tiles that each show what their setting does: the picture stays in view, unlike twelve sliders. */
function AdjustBody({ clip }: { clip: LookClip }) {
  const [active, setActive] = useState<AdjustKey>('exposure');
  const paint = useLookTiles(clip);
  const draw = useMemo<TileDraw<(typeof ADJUST_ITEMS)[number]>>(() => (item, canvas) => paint(canvas, (c) => {
    const [, hi] = adjustRange(item.id);
    c.adjust[item.id] = Math.min(hi, c.adjust[item.id] + 0.6);
  }), [paint]);
  const items = ADJUST_ITEMS.map((it) => (Math.abs(clip.adjust[it.id]) >= 0.005 ? { ...it, note: signed(clip.adjust[it.id]) } : it));
  const [min, max] = adjustRange(active);
  const changed = ADJUST_KEYS.some((k) => Math.abs(clip.adjust[k]) >= 0.005);
  return (
    <>
      <LookActions clip={clip} parts={['adjust']} />
      <StylePicker items={items} categories={ADJUST_CATEGORIES} value={active} onChange={(id) => setActive(id as AdjustKey)} label={t('Adjust')} draw={draw} rows={1} />
      <Slider key={active} label={ADJUST_LABELS[active]} value={clip.adjust[active]} min={min} max={max} format={signed} reset={0}
        onChange={(v) => editClip(clip.id, (c) => { if ('adjust' in c) c.adjust[active] = v; }, `adj:${active}:${clip.id}`)} />
      <button className="btn" disabled={!changed} onClick={() => editClip(clip.id, (c) => { if ('adjust' in c) c.adjust = defaultAdjust(); })}>{t('Reset all')}</button>
    </>
  );
}

const FILTER_ITEMS = [{ id: 'none', name: 'None', cat: FILTERS[0].cat }, ...FILTERS];

function FiltersBody({ clip }: { clip: LookClip }) {
  const paint = useLookTiles(clip);
  const draw = useMemo<TileDraw<(typeof FILTER_ITEMS)[number]>>(() => (item, canvas) => paint(canvas, (c) => {
    c.filter = item.id === 'none' ? null : { id: item.id, intensity: c.filter?.intensity ?? 0.8 };
  }), [paint]);
  return (
    <>
      <LookActions clip={clip} parts={['filter']} />
      <StylePicker items={FILTER_ITEMS} categories={FILTER_CATEGORIES} value={clip.filter?.id ?? 'none'} label={t('Filters')} draw={draw} rows={1}
        onChange={(id) => (clip.filter?.id ?? 'none') !== id && editClip(clip.id, (c) => { if ('filter' in c) c.filter = id === 'none' ? null : { id, intensity: c.filter?.intensity ?? 0.8 }; })} />
      {clip.filter && (
        <Slider label={t('Intensity')} value={clip.filter.intensity} min={0} max={1} format={pct} reset={0.8}
          onChange={(v) => editClip(clip.id, (c) => { if ('filter' in c && c.filter) c.filter.intensity = v; }, `fint:${clip.id}`)} />
      )}
      <LutSection clip={clip} paint={paint} />
    </>
  );
}

const TF: { key: keyof Transform; label: string; min: number; max: number; format: (v: number) => string; reset: number }[] = [
  { key: 'x', label: t('Position X'), min: -1, max: 1, format: signed, reset: 0 },
  { key: 'y', label: t('Position Y'), min: -1, max: 1, format: signed, reset: 0 },
  { key: 'scale', label: t('Scale'), min: 0.05, max: 4, format: pct, reset: 1 },
  { key: 'rotation', label: t('Rotation'), min: -180, max: 180, format: (v) => `${Math.round(v)}°`, reset: 0 },
  { key: 'opacity', label: t('Opacity'), min: 0, max: 1, format: pct, reset: 1 },
];
const BLENDS: readonly BlendMode[] = ['normal', 'screen', 'multiply', 'add'];

function TransformBody({ clip }: { clip: Clip }) {
  const time = useEditor((s) => s.time);
  if (clip.kind === 'audio') return null;
  const local = time - clip.start;
  const outside = local < 0 || local > clip.duration;
  return (
    <>
      <ClipScrub clip={clip} keys={TF.flatMap(({ key }) => clip.transform[key].k?.map((x) => x.t) ?? [])} />
      {TF.map(({ key, label, min, max, format, reset }) => {
        const a = clip.transform[key];
        return (
          <Slider key={key} label={label} value={evalAnim(a, local)} min={min} max={max} format={format} reset={reset}
            step={key === 'rotation' ? 1 : 0.01}
            onChange={(v) => editClip(clip.id, (c) => { if (c.kind !== 'audio') setAnim(c.transform[key], local, v); }, `tf:${key}:${clip.id}`)}
            keyframe={{
              active: keyIndexAt(a, local) >= 0, animated: hasKeys(a), disabled: outside,
              toggle: () => editClip(clip.id, (c) => { if (c.kind !== 'audio') toggleKey(c.transform[key], local); }),
            }} />
        );
      })}
      <p className="hint">{t('Tap ◆ to add a keyframe at the playhead. When a property has keyframes, changes create keyframes.')}</p>
      {(clip.kind === 'video' || clip.kind === 'image') && (
        <div className="flip-row">
          <button className="btn" aria-pressed={!!clip.flipX} onClick={() => toggleFlip('x')}><TrianglesCenterlineDashedVertical size={18} aria-hidden /> {t('Mirror')}</button>
          <button className="btn" aria-pressed={!!clip.flipY} onClick={() => toggleFlip('y')}><TrianglesCenterlineDashedHorizontal size={18} aria-hidden /> {t('Upside down')}</button>
        </div>
      )}
      <h3>{t('Blend')}</h3>
      <Chips options={BLENDS} value={clip.blend} onChange={(b) => editClip(clip.id, (c) => { if (c.kind !== 'audio') c.blend = b; })} />
      <button className="btn" onClick={() => editClip(clip.id, (c) => { if (c.kind !== 'audio') c.transform = defaultTransform(); })}>{t('Reset transform')}</button>
    </>
  );
}

function ChromaControls({ clip }: { clip: Extract<Clip, { chroma: unknown }> }) {
  const k = clip.chroma;
  const e = (fn: (ck: typeof k) => void, key?: string) => editClip(clip.id, (c) => { if ('chroma' in c) fn(c.chroma); }, key && `${key}:${clip.id}`);
  return (
    <>
      <Toggle label={t('Remove color (green screen)')} value={k.enabled} onChange={(v) => e((ck) => { ck.enabled = v; })} />
      {k.enabled && (
        <>
          {/* The eyedropper picks the key colour from the picture as it is, with the key off (else it is see-through). */}
          <Swatches label={t('Key color')} value={k.color} onChange={(col) => e((ck) => { ck.color = col; })}
            from={() => { const p = editor().project; return p && produce(p, (d) => { const f = findClip(d, clip.id); if (f && 'chroma' in f.clip) f.clip.chroma.enabled = false; }); }} />
          <Slider label={t('Strength')} value={k.similarity} min={0} max={1} format={pct} reset={0.3} onChange={(v) => e((ck) => { ck.similarity = v; }, 'cks')} />
          <Slider label={t('Softness')} value={k.smoothness} min={0} max={1} format={pct} reset={0.1} onChange={(v) => e((ck) => { ck.smoothness = v; }, 'ckf')} />
        </>
      )}
    </>
  );
}

const ANIMS: readonly TextAnimType[] = TEXT_ANIM_TYPES;

function TextBody({ clip }: { clip: TextClip }) {
  const e = (fn: (c: TextClip) => void, key?: string) => editClip(clip.id, (c) => { if (c.kind === 'text') fn(c); }, key && `${key}:${clip.id}`);
  const s = clip.style;
  return (
    <>
      {/* The words first: under the style grid the field was below the fold on phones shorter than 812 px (audit V-202). */}
      <textarea className="text-input" value={clip.text} rows={2} maxLength={500} aria-label={t('Text')}
        onChange={(ev) => e((c) => { c.text = ev.target.value; }, 'txt')} />
      <StylePicker items={TEXT_PRESETS} categories={TEXT_CATEGORIES} value={null} label={t('Style')} draw={drawTextTile}
        onChange={(id) => e((c) => { const pr = TEXT_PRESETS.find((p) => p.id === id)!; c.style = structuredClone(pr.style); if (pr.animIn) c.animIn = { ...pr.animIn }; })} />
      <FontPicker clipId={clip.id} style={s} onFont={(f) => e((c) => { c.style.font = f; })} onWeight={(w) => e((c) => { c.style.weight = w; })} />
      <Slider label={t('Size')} value={s.size} min={0.02} max={0.2} step={0.001} format={(v) => `${Math.round(v * 1000) / 10}`} reset={0.055}
        onChange={(v) => e((c) => { c.style.size = v; }, 'tsize')} />
      <TextLook style={s} change={(fn, key) => e((c) => fn(c.style), key)} />
      <h3>{t('Animation in')}</h3>
      <Chips options={ANIMS} value={clip.animIn.type} onChange={(t) => e((c) => { c.animIn.type = t; })} />
      <Slider label={t('Duration')} value={clip.animIn.duration} min={0.1} max={2} step={0.05} format={secs} reset={0.3} onChange={(v) => e((c) => { c.animIn.duration = v; }, 'ain')} />
      <h3>{t('Animation out')}</h3>
      <Chips options={ANIMS} value={clip.animOut.type} onChange={(t) => e((c) => { c.animOut.type = t; })} />
      <Slider label={t('Duration')} value={clip.animOut.duration} min={0.1} max={2} step={0.05} format={secs} reset={0.3} onChange={(v) => e((c) => { c.animOut.duration = v; }, 'aout')} />
      <h3>{t('Repeat')}</h3>
      <Chips options={TEXT_LOOP_TYPES} value={clip.loop?.type ?? 'none'} label={t('Repeat')}
        onChange={(l) => e((c) => { if (l === 'none') delete c.loop; else c.loop = { type: l, period: c.loop?.period ?? 1.2 }; })} />
      {clip.loop && <Slider label={t('Cycle')} value={clip.loop.period} min={0.3} max={3} step={0.05} format={secs} reset={1.2}
        onChange={(v) => e((c) => { if (c.loop) c.loop.period = v; }, 'loop')} />}
    </>
  );
}


function TransitionBody() {
  const id = useEditor((s) => s.transitionFor);
  const clip = useEditor((s) => (s.project && id ? findClip(s.project, id)?.clip : undefined));
  if (!clip || clip.kind === 'audio') return null;
  const tr = clip.transitionIn;
  const commit = (next: Transition | null, key?: string) => useEditor.getState().commit((d) => setTransition(d, clip.id, next), key);
  const opts = ['none', ...TRANSITION_TYPES] as const;
  return (
    <>
      <Chips options={opts} value={tr?.type ?? 'none'} render={(t) => (t === 'none' ? 'None' : TRANSITION_LABELS[t])}
        onChange={(t) => commit(t === 'none' ? null : { type: t, duration: tr?.duration ?? 0.5 })} />
      {tr && <Slider label={t('Duration')} value={tr.duration} min={0.1} max={2} step={0.05} format={secs} reset={0.5}
        onChange={(v) => commit({ ...tr, duration: v }, `trd:${clip.id}`)} />}
      <button className="btn" onClick={() => useEditor.getState().commit((d) => applyTransitionToAll(d, tr ?? null))}>{t('Apply to all cuts')}</button>
    </>
  );
}

const ASPECT_IDS = Object.keys(ASPECTS) as AspectId[];
const BG = ['#000000', '#ffffff', '#1f1f1f', '#ffc53d', '#2f9bff', '#3bd16f'];

function CanvasBody() {
  const settings = useEditor((s) => s.project?.settings);
  if (!settings) return null;
  const commit = useEditor.getState().commit;
  return (
    <>
      <h3>{t('Aspect ratio')}</h3>
      <Chips options={ASPECT_IDS} value={settings.aspect} onChange={(a) => commit((d) => {
        const [w, h] = ASPECTS[a];
        Object.assign(d.settings, { aspect: a, width: w, height: h });
      })} />
      <h3>{t('Background')}</h3>
      <Chips options={['color', 'blur'] as const} value={settings.background.mode} render={(m) => (m === 'color' ? t('Color') : t('Blur'))}
        onChange={(m) => commit((d) => { d.settings.background.mode = m; })} />
      <div className="swatches">
        {BG.map((c) => (
          <button key={c} className={`swatch ${c === settings.background.color ? 'on' : ''}`} style={{ background: c }} aria-label={c}
            onClick={() => commit((d) => { d.settings.background.color = c; })} />
        ))}
      </div>
      <h3>{t('Frame rate')}</h3>
      <Chips options={[24, 25, 30, 60] as const} value={settings.fps} render={(f) => `${f} fps`} onChange={(f) => commit((d) => { d.settings.fps = f; d.settings.fpsSet = true; })} />
    </>
  );
}

/** Runs on-device sound processing for a clip setting and shows its progress inline. */
function useSoundJob(clipId: string) {
  const [busy, setBusy] = useState<number | null>(null);
  useHoldUpdates(busy !== null);
  useSheetGuard(busy !== null ? t('This is still running. Tap again to stop it.') : null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  const run = async (change: (c: SoundClip) => void) => {
    abort.current?.abort();
    const ac = new AbortController();
    abort.current = ac;
    setBusy(0);
    try {
      await updateClipSound(clipId, change, setBusy, ac.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') editor().toast(t('Sound processing failed: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      if (abort.current === ac) setBusy(null);
    }
  };
  const progress = busy === null ? null : (
    <div className="inline-progress">
      <span>{t('Processing the sound on this device… {p}%', { p: Math.round(busy * 100) })}</span>
      <button className="btn" onClick={() => abort.current?.abort()}>{t('Cancel')}</button>
    </div>
  );
  return { run, progress };
}

/** Copies the license proof of a library track (for a Content ID dispute or a video description). */
function LicenseButton({ assetId }: { assetId: string }) {
  const lib = useEditor((s) => s.project?.assets[assetId]?.library);
  if (!lib) return null;
  const copy = () => navigator.clipboard?.writeText(licenseText(lib))
    .then(() => editor().toast(t('License copied: paste it into a copyright dispute or the description')), () => editor().toast(licenseText(lib)));
  return <button className="btn" onClick={() => void copy()}>{t('Copy license')}</button>;
}

/** Voice effects (docs/09 V1): one tap, processed on the device into a sound that preview and export both play. */
function VoiceBody({ clip }: { clip: SoundClip }) {
  const { run, progress } = useSoundJob(clip.id);
  if (progress) return progress;
  return (
    <>
      <Chips options={['none', ...VOICE_IDS] as const} value={clip.voice ?? 'none'} scroll label={t('Voice')}
        onChange={(v) => {
          track('voice_effect', { voice: v });
          void run((c) => { if (v === 'none') delete c.voice; else c.voice = v; });
        }}
        render={(v) => (v === 'none' ? t('Original') : t(VOICE_LABEL[v]))} />
      <p className="hint">{t('Processed on this device. Speed and noise settings still apply.')}</p>
    </>
  );
}

/** One-tap voice enhancement: noise reduction, voice EQ, compression and even loudness (on device). */
function EnhanceToggle({ clip }: { clip: SoundClip }) {
  const { run, progress } = useSoundJob(clip.id);
  return progress ?? <Toggle label={t('Enhance voice')} value={!!clip.enhance} onChange={(v) => void run((c) => { c.enhance = v; })} />;
}

/** Noise reduction (RNNoise, on device); the processed sound is cached per source file. */
function DenoiseToggle({ clip }: { clip: SoundClip }) {
  const { run, progress } = useSoundJob(clip.id);
  return progress ?? <Toggle label={t('Reduce background noise')} value={!!clip.denoise} onChange={(v) => void run((c) => { c.denoise = v; })} />;
}

/** Keeps natural pitch at any speed; re-processes (debounced) after the speed changes. */
function KeepPitchToggle({ clip }: { clip: SoundClip }) {
  const { run, progress } = useSoundJob(clip.id);
  const stale = keepsPitch(clip) && clip.speed !== 1 && clip.audioKey !== expectedAudioKey(clip);
  useEffect(() => {
    if (!stale) return;
    const t = setTimeout(() => void run(() => undefined), 800);
    return () => clearTimeout(t);
  }, [stale, clip.speed]);
  return progress ?? <Toggle label={t('Keep natural voice pitch')} value={keepsPitch(clip)} onChange={(v) => void run((c) => { c.keepPitch = v; })} />;
}
