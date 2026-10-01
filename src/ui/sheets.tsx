import { useEffect, useRef, useState } from 'react';
import { evalAnim, hasKeys, keyIndexAt, setAnim, toggleKey } from '../core/anim';
import { TEXT_PRESETS } from '../core/presets';
import { ASPECTS, defaultAdjust, defaultTransform } from '../core/defaults';
import { FILTERS, adjustRange } from '../core/filters';
import { CURVE_PRESETS } from '../core/speed';
import { applyTransitionToAll, expectedAudioKey, findClip, setCurve, setSpeed, setTransition } from '../core/timeline';
import { CurveEditor } from './CurveEditor';
import {
  ADJUST_KEYS, TRANSITION_TYPES,
  type AdjustKey, type AspectId, type BlendMode, type Clip, type FontId, type SoundClip, type TextAnimType, type TextClip,
  type Transform, type Transition, type TransitionType,
} from '../core/types';
import { FONTS, fontWeight } from '../engine/text';
import { errorMessage } from '../lib/telemetry';
import { editor, useEditor, type SheetId } from '../state/store';
import { detachSelectedAudio, editClip, updateClipSound } from './actions';
import { Chips, Sheet, Slider, Swatches, Toggle, pct, secs, signed } from './controls';
import { CameraSheet } from './CameraSheet';
import { licenseText } from '../core/music';
import { MusicBody } from './MusicSheet';
import { ExportSheet } from './ExportSheet';
import { EffectsBody, LutSection, PrivacyBody } from './FxSheets';
import { CaptionEditBody, CaptionsBody, CropBody, StickersBody, VoiceoverBody } from './ToolSheets';
import { BeatsBody, MaskBody, PausesBody, SfxBody } from './MoreSheets';
import { t } from '../lib/i18n';

function useSelected(): Clip | null {
  return useEditor((s) => (s.project && s.selection ? findClip(s.project, s.selection)?.clip ?? null : null));
}

const TITLES: Record<SheetId, string> = {
  speed: 'Speed', volume: 'Volume', adjust: 'Adjust', filters: 'Filters', transform: 'Transform & keyframes',
  text: 'Text', transition: 'Transition', canvas: 'Canvas', export: 'Export',
  crop: 'Crop', captions: 'Auto captions', captionEdit: 'Captions', voiceover: 'Voice-over', stickers: 'Stickers',
  pauses: 'Remove pauses', mask: 'Mask', sfx: 'Sound effects', beats: 'Beat', effects: 'Effects', privacy: 'Hide faces', camera: 'Camera', music: 'Music',
};

export function Sheets() {
  const sheet = useEditor((s) => s.sheet);
  const clip = useSelected();
  if (!sheet) return null;
  if (sheet === 'export') return <ExportSheet />;
  if (sheet === 'camera') return <CameraSheet />;
  if (sheet === 'music') return <Sheet title={TITLES.music}><MusicBody /></Sheet>;
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
      {sheet === 'adjust' && <AdjustBody clip={clip} />}
      {sheet === 'filters' && <FiltersBody clip={clip} />}
      {sheet === 'transform' && <TransformBody clip={clip} />}
      {sheet === 'text' && clip.kind === 'text' && <TextBody clip={clip} />}
      {sheet === 'crop' && (clip.kind === 'video' || clip.kind === 'image') && <CropBody clip={clip} />}
      {sheet === 'captionEdit' && clip.kind === 'caption' && <CaptionEditBody clip={clip} />}
      {sheet === 'pauses' && (clip.kind === 'video' || clip.kind === 'audio') && <PausesBody clip={clip} />}
      {sheet === 'mask' && (clip.kind === 'video' || clip.kind === 'image') && <MaskBody clip={clip} />}
      {sheet === 'beats' && clip.kind === 'audio' && <BeatsBody clip={clip} />}
      {sheet === 'effects' && (clip.kind === 'video' || clip.kind === 'image') && <EffectsBody clip={clip} />}
      {sheet === 'privacy' && (clip.kind === 'video' || clip.kind === 'image') && <PrivacyBody clip={clip} />}
    </Sheet>
  );
}

const SPEEDS = [0.25, 0.5, 1, 1.5, 2, 4] as const;
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

function AdjustBody({ clip }: { clip: Clip }) {
  if (clip.kind === 'audio' || clip.kind === 'text' || clip.kind === 'caption') return null;
  return (
    <>
      {ADJUST_KEYS.map((k) => {
        const [min, max] = adjustRange(k);
        return (
          <Slider key={k} label={ADJUST_LABELS[k]} value={clip.adjust[k]} min={min} max={max} format={signed} reset={0}
            onChange={(v) => editClip(clip.id, (c) => { if ('adjust' in c) c.adjust[k] = v; }, `adj:${k}:${clip.id}`)} />
        );
      })}
      <button className="btn" onClick={() => editClip(clip.id, (c) => { if ('adjust' in c) c.adjust = defaultAdjust(); })}>{t('Reset all')}</button>
    </>
  );
}

function FiltersBody({ clip }: { clip: Clip }) {
  if (clip.kind === 'audio' || clip.kind === 'text' || clip.kind === 'caption') return null;
  const ids = ['none', ...FILTERS.map((f) => f.id)] as const;
  const name = (id: string) => (id === 'none' ? 'None' : FILTERS.find((f) => f.id === id)!.name);
  return (
    <>
      <Chips options={ids} value={clip.filter?.id ?? 'none'} render={name}
        onChange={(id) => (clip.filter?.id ?? 'none') !== id && editClip(clip.id, (c) => { if ('filter' in c) c.filter = id === 'none' ? null : { id, intensity: c.filter?.intensity ?? 0.8 }; })} />
      {clip.filter && (
        <Slider label={t('Intensity')} value={clip.filter.intensity} min={0} max={1} format={pct} reset={0.8}
          onChange={(v) => editClip(clip.id, (c) => { if ('filter' in c && c.filter) c.filter.intensity = v; }, `fint:${clip.id}`)} />
      )}
      <LutSection clip={clip} />
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
      <h3>{t('Blend')}</h3>
      <Chips options={BLENDS} value={clip.blend} onChange={(b) => editClip(clip.id, (c) => { if (c.kind !== 'audio') c.blend = b; })} />
      {(clip.kind === 'video' || clip.kind === 'image') && <ChromaControls clip={clip} />}
      <button className="btn" onClick={() => editClip(clip.id, (c) => { if (c.kind !== 'audio') c.transform = defaultTransform(); })}>{t('Reset transform')}</button>
    </>
  );
}

function ChromaControls({ clip }: { clip: Extract<Clip, { chroma: unknown }> }) {
  const k = clip.chroma;
  const e = (fn: (ck: typeof k) => void, key?: string) => editClip(clip.id, (c) => { if ('chroma' in c) fn(c.chroma); }, key && `${key}:${clip.id}`);
  return (
    <>
      <h3>{t('Chroma key')}</h3>
      <Toggle label={t('Remove color (green screen)')} value={k.enabled} onChange={(v) => e((ck) => { ck.enabled = v; })} />
      {k.enabled && (
        <>
          <Swatches label={t('Key color')} value={k.color} onChange={(col) => e((ck) => { ck.color = col; })} />
          <Slider label={t('Strength')} value={k.similarity} min={0} max={1} format={pct} reset={0.3} onChange={(v) => e((ck) => { ck.similarity = v; }, 'cks')} />
          <Slider label={t('Softness')} value={k.smoothness} min={0} max={1} format={pct} reset={0.1} onChange={(v) => e((ck) => { ck.smoothness = v; }, 'ckf')} />
        </>
      )}
    </>
  );
}

const ANIMS: readonly TextAnimType[] = ['none', 'fade', 'rise', 'pop', 'typewriter'];
const FONT_IDS = Object.keys(FONTS) as FontId[];

function TextBody({ clip }: { clip: TextClip }) {
  const e = (fn: (c: TextClip) => void, key?: string) => editClip(clip.id, (c) => { if (c.kind === 'text') fn(c); }, key && `${key}:${clip.id}`);
  const s = clip.style;
  return (
    <>
      <Chips options={TEXT_PRESETS.map((p) => p.id)} value={null} scroll label={t('Style')}
        render={(id) => { const pr = TEXT_PRESETS.find((p) => p.id === id)!; return <span style={{ fontFamily: FONTS[pr.style.font].family }}>{t(pr.name)}</span>; }}
        onChange={(id) => e((c) => { const pr = TEXT_PRESETS.find((p) => p.id === id)!; c.style = { ...pr.style }; if (pr.animIn) c.animIn = { ...pr.animIn }; })} />
      <textarea className="text-input" value={clip.text} rows={2} maxLength={500} aria-label={t('Text')}
        onChange={(ev) => e((c) => { c.text = ev.target.value; }, 'txt')} />
      <Chips options={FONT_IDS} value={s.font} scroll label={t('Font')} onChange={(f) => e((c) => { c.style.font = f; })}
        render={(f) => <span style={{ fontFamily: FONTS[f].family, fontWeight: fontWeight(f, 700) }}>{FONTS[f].label}</span>} />
      <Slider label={t('Size')} value={s.size} min={0.02} max={0.2} step={0.001} format={(v) => `${Math.round(v * 1000) / 10}`} reset={0.055}
        onChange={(v) => e((c) => { c.style.size = v; }, 'tsize')} />
      <Chips options={[400, 700, 900] as const} value={s.weight} render={(w) => (w === 400 ? t('Regular') : w === 700 ? t('Bold') : t('Black'))}
        onChange={(w) => e((c) => { c.style.weight = w; })} />
      <Chips options={['left', 'center', 'right'] as const} value={s.align} onChange={(a) => e((c) => { c.style.align = a; })} />
      <Toggle label={t('Italic')} value={s.italic} onChange={(v) => e((c) => { c.style.italic = v; })} />
      <h3>{t('Color')}</h3>
      <Swatches label={t('Text color')} value={s.color} onChange={(col) => e((c) => { c.style.color = col; })} />
      <Toggle label={t('Outline')} value={!!s.stroke} onChange={(v) => e((c) => { c.style.stroke = v ? { color: '#000000', width: 0.08 } : null; })} />
      {s.stroke && (
        <>
          <Swatches label={t('Outline color')} value={s.stroke.color} onChange={(col) => e((c) => { if (c.style.stroke) c.style.stroke.color = col; })} />
          <Slider label={t('Outline width')} value={s.stroke.width} min={0.01} max={0.3} format={pct} reset={0.08}
            onChange={(v) => e((c) => { if (c.style.stroke) c.style.stroke.width = v; }, 'sw')} />
        </>
      )}
      <Toggle label={t('Background')} value={!!s.background} onChange={(v) => e((c) => { c.style.background = v ? { color: '#000000', opacity: 0.6 } : null; })} />
      {s.background && (
        <>
          <Swatches label={t('Background color')} value={s.background.color} onChange={(col) => e((c) => { if (c.style.background) c.style.background.color = col; })} />
          <Slider label={t('Opacity')} value={s.background.opacity} min={0.05} max={1} format={pct} reset={0.6}
            onChange={(v) => e((c) => { if (c.style.background) c.style.background.opacity = v; }, 'bgo')} />
        </>
      )}
      <Toggle label={t('Shadow')} value={s.shadow} onChange={(v) => e((c) => { c.style.shadow = v; })} />
      <h3>{t('Animation in')}</h3>
      <Chips options={ANIMS} value={clip.animIn.type} onChange={(t) => e((c) => { c.animIn.type = t; })} />
      <Slider label={t('Duration')} value={clip.animIn.duration} min={0.1} max={2} step={0.05} format={secs} reset={0.3} onChange={(v) => e((c) => { c.animIn.duration = v; }, 'ain')} />
      <h3>{t('Animation out')}</h3>
      <Chips options={ANIMS} value={clip.animOut.type} onChange={(t) => e((c) => { c.animOut.type = t; })} />
      <Slider label={t('Duration')} value={clip.animOut.duration} min={0.1} max={2} step={0.05} format={secs} reset={0.3} onChange={(v) => e((c) => { c.animOut.duration = v; }, 'aout')} />
    </>
  );
}

const TRANSITION_LABELS: Record<TransitionType, string> = {
  fade: 'Dissolve', black: 'Dip to black', white: 'Dip to white', slideLeft: 'Slide ←', slideRight: 'Slide →',
  slideUp: 'Slide ↑', slideDown: 'Slide ↓', wipeLeft: 'Wipe ←', wipeRight: 'Wipe →', zoom: 'Zoom',
  whip: 'Whip pan', spin: 'Spin', blur: 'Blur', glitch: 'Glitch', flash: 'Flash', circle: 'Circle', doors: 'Doors',
  pixelate: 'Pixelate', zoomOut: 'Zoom out', shake: 'Shake',
};

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
      <Chips options={[24, 25, 30, 60] as const} value={settings.fps} render={(f) => `${f} fps`} onChange={(f) => commit((d) => { d.settings.fps = f; })} />
    </>
  );
}

/** Runs on-device sound processing for a clip setting and shows its progress inline. */
function useSoundJob(clipId: string) {
  const [busy, setBusy] = useState<number | null>(null);
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
  const stale = !!clip.keepPitch && clip.speed !== 1 && clip.audioKey !== expectedAudioKey(clip);
  useEffect(() => {
    if (!stale) return;
    const t = setTimeout(() => void run(() => undefined), 800);
    return () => clearTimeout(t);
  }, [stale, clip.speed]);
  return progress ?? <Toggle label={t('Keep natural voice pitch')} value={!!clip.keepPitch} onChange={(v) => void run((c) => { c.keepPitch = v; })} />;
}
