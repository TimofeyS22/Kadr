// v0.6 sheets: video effects, hiding faces and areas, imported LUTs.
import { evalAnim, hasKeys, keyIndexAt, setAnim, toggleKey } from '../core/anim';
import { anim } from '../core/defaults';
import { EFFECTS } from '../core/effects';
import { EFFECT_IDS, type ImageClip, type Privacy, type VideoClip } from '../core/types';
import { t } from '../lib/i18n';
import { useEditor } from '../state/store';
import { editClip, importLut, setHideFaces } from './actions';
import { Chips, Slider, Toggle, pct } from './controls';

type MediaVisual = VideoClip | ImageClip;
const MAX_AREAS = 6;

export function EffectsBody({ clip }: { clip: MediaVisual }) {
  const ids = ['none', ...EFFECT_IDS] as const;
  return (
    <>
      <Chips options={ids} value={clip.effect?.id ?? 'none'}
        render={(id) => t(id === 'none' ? 'None' : EFFECTS.find((e) => e.id === id)!.name)}
        onChange={(id) => editClip(clip.id, (c) => {
          if (c.kind !== 'video' && c.kind !== 'image') return;
          if (id === 'none') delete c.effect;
          else c.effect = { id, amount: c.effect?.amount ?? 0.6 };
        })} />
      {clip.effect && (
        <Slider label={t('Strength')} value={clip.effect.amount} min={0} max={1} format={pct} reset={0.6}
          onChange={(v) => editClip(clip.id, (c) => { if ((c.kind === 'video' || c.kind === 'image') && c.effect) c.effect.amount = v; }, `fx:${clip.id}`)} />
      )}
      <p className="hint">{t('Effects look the same in the preview and in the exported video.')}</p>
    </>
  );
}

export function PrivacyBody({ clip }: { clip: MediaVisual }) {
  const time = useEditor((s) => s.time);
  const local = time - clip.start;
  const outside = local < 0 || local > clip.duration;
  const pv: Privacy = clip.privacy ?? { faces: false, areas: [], style: 'blur' };
  const set = (fn: (p: Privacy) => void, key?: string) => editClip(clip.id, (c) => {
    if (c.kind !== 'video' && c.kind !== 'image') return;
    c.privacy ??= { faces: false, areas: [], style: 'blur' };
    fn(c.privacy);
  }, key);
  return (
    <>
      <Toggle label={t('Hide faces automatically')} value={pv.faces} onChange={(v) => void setHideFaces(clip.id, v)} />
      <Chips options={['blur', 'pixelate'] as const} value={pv.style} render={(s) => (s === 'blur' ? t('Blur') : t('Pixelate'))}
        onChange={(s) => set((p) => { p.style = s; })} />
      {pv.areas.map((a, i) => (
        <div key={i} className="privacy-area">
          <h3>{t('Area {n}', { n: i + 1 })}</h3>
          {(['x', 'y'] as const).map((k) => (
            <Slider key={k} label={k === 'x' ? t('Position X') : t('Position Y')} value={evalAnim(a[k], local)} min={0} max={1} format={pct} reset={0.5}
              onChange={(v) => set((p) => { setAnim(p.areas[i][k], local, v); }, `pv:${k}:${i}:${clip.id}`)}
              keyframe={{ active: keyIndexAt(a[k], local) >= 0, animated: hasKeys(a[k]), disabled: outside, toggle: () => set((p) => { toggleKey(p.areas[i][k], local); }) }} />
          ))}
          <Slider label={t('Width')} value={a.w} min={0.03} max={1} format={pct} reset={0.3} onChange={(v) => set((p) => { p.areas[i].w = v; }, `pv:w:${i}:${clip.id}`)} />
          <Slider label={t('Height')} value={a.h} min={0.03} max={1} format={pct} reset={0.15} onChange={(v) => set((p) => { p.areas[i].h = v; }, `pv:h:${i}:${clip.id}`)} />
          <button className="btn" onClick={() => set((p) => { p.areas.splice(i, 1); })}>{t('Remove area')}</button>
        </div>
      ))}
      <button className="btn" disabled={pv.areas.length >= MAX_AREAS}
        onClick={() => set((p) => { p.areas.push({ x: anim(0.5), y: anim(0.5), w: 0.3, h: 0.15 }); })}>{t('Add area')}</button>
      <p className="hint">{t('Faces are found on this device in every frame, best when they look at the camera. Add an area for number plates or anything else; ◆ makes it follow a moving object.')}</p>
    </>
  );
}

export function LutSection({ clip }: { clip: MediaVisual }) {
  const luts = useEditor((s) => s.project?.luts) ?? {};
  const ids = ['none', ...Object.keys(luts)];
  return (
    <>
      <h3>{t('LUT')}</h3>
      {ids.length > 1 && (
        <Chips options={ids} value={clip.lut && luts[clip.lut.id] ? clip.lut.id : 'none'} render={(id) => (id === 'none' ? t('None') : luts[id].name)}
          onChange={(id) => editClip(clip.id, (c) => {
            if (c.kind !== 'video' && c.kind !== 'image') return;
            if (id === 'none') delete c.lut;
            else c.lut = { id, intensity: c.lut?.intensity ?? 1 };
          })} />
      )}
      {clip.lut && luts[clip.lut.id] && (
        <Slider label={t('Intensity')} value={clip.lut.intensity} min={0} max={1} format={pct} reset={1}
          onChange={(v) => editClip(clip.id, (c) => { if ((c.kind === 'video' || c.kind === 'image') && c.lut) c.lut.intensity = v; }, `lut:${clip.id}`)} />
      )}
      <button className="btn" onClick={() => void importLut(clip.id)}>{t('Import LUT (.cube)')}</button>
    </>
  );
}
