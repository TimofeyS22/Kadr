// v0.6 sheets: video effects, hiding faces and areas, imported LUTs.
import { useMemo } from 'react';
import { evalAnim, hasKeys, keyIndexAt, setAnim, toggleKey } from '../core/anim';
import { anim } from '../core/defaults';
import { EFFECTS } from '../core/effects';
import { EFFECT_IDS, type EffectId, type ImageClip, type Privacy, type VideoClip } from '../core/types';
import { t } from '../lib/i18n';
import { useEditor } from '../state/store';
import { editClip, importLut, setHideFaces } from './actions';
import { Chips, ClipScrub, Slider, Toggle, Values, pct } from './controls';
import { LookActions } from './LookControls';
import { useLookTiles } from './lookTiles';
import { StylePicker, type TileDraw } from './picker';
import { Button } from './ck/controls';

type MediaVisual = VideoClip | ImageClip;
const MAX_AREAS = 6;

const EFFECT_ITEMS = [{ id: 'none', name: 'None', cat: 'all' }, ...EFFECT_IDS.map((id) => ({ id, name: EFFECTS.find((e) => e.id === id)!.name, cat: 'all' }))];
const ONE_CATEGORY = [{ id: 'all', name: 'All' }];
const LUT_CATEGORY = [{ id: 'lut', name: 'LUT' }];

export function EffectsBody({ clip }: { clip: MediaVisual }) {
  const paint = useLookTiles(clip);
  // Each tile plays its effect (Ч4 release 5): shake, glitch and a zoom punch are motions, and on a still frame every tile
  // looked like «Нет».
  const draw = useMemo<TileDraw<(typeof EFFECT_ITEMS)[number]>>(() => (item, canvas, time) => paint(canvas, (c) => {
    if (item.id === 'none') delete c.effect;
    else c.effect = { id: item.id as EffectId, amount: c.effect?.amount ?? 0.6 };
  }, time), [paint]);
  return (
    <>
      <LookActions clip={clip} parts={['effect']} />
      <StylePicker items={EFFECT_ITEMS} categories={ONE_CATEGORY} value={clip.effect?.id ?? 'none'} label={t('Effects')} draw={draw} rows={1} animated
        onChange={(id) => editClip(clip.id, (c) => {
          if (c.kind !== 'video' && c.kind !== 'image') return;
          if (id === 'none') delete c.effect;
          else c.effect = { id: id as EffectId, amount: c.effect?.amount ?? 0.6 };
        })} />
      {clip.effect && (
        <Values label={t('Strength')}>
          <Slider label={t('Strength')} value={clip.effect.amount} min={0} max={1} format={pct} reset={0.6}
            onChange={(v) => editClip(clip.id, (c) => { if ((c.kind === 'video' || c.kind === 'image') && c.effect) c.effect.amount = v; }, `fx:${clip.id}`)} />
        </Values>
      )}
      <p className="ck-hint">{t('Effects look the same in the preview and in the exported video.')}</p>
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
      {pv.areas.length > 0 && <ClipScrub clip={clip} keys={pv.areas.flatMap((a) => [...(a.x.k ?? []), ...(a.y.k ?? [])].map((x) => x.t))} />}
      <Toggle label={t('Hide faces automatically')} value={pv.faces} onChange={(v) => void setHideFaces(clip.id, v)} />
      <Chips even options={['blur', 'pixelate'] as const} value={pv.style} render={(s) => (s === 'blur' ? t('Blur') : t('Pixelate'))}
        onChange={(s) => set((p) => { p.style = s; })} />
      {pv.areas.map((a, i) => (
        <div key={i} className="privacy-area">
          <h3>{t('Area {n}', { n: i + 1 })}</h3>
          <Values label={t('Area {n}', { n: i + 1 })}>
          {(['x', 'y'] as const).map((k) => (
            <Slider key={k} label={k === 'x' ? t('Position X') : t('Position Y')} value={evalAnim(a[k], local)} min={0} max={1} format={pct} reset={0.5}
              onChange={(v) => set((p) => { setAnim(p.areas[i][k], local, v); }, `pv:${k}:${i}:${clip.id}`)}
              keyframe={{ active: keyIndexAt(a[k], local) >= 0, animated: hasKeys(a[k]), disabled: outside, toggle: () => set((p) => { toggleKey(p.areas[i][k], local); }) }} />
          ))}
          <Slider label={t('Width')} value={a.w} min={0.03} max={1} format={pct} reset={0.3} onChange={(v) => set((p) => { p.areas[i].w = v; }, `pv:w:${i}:${clip.id}`)} />
          <Slider label={t('Height')} value={a.h} min={0.03} max={1} format={pct} reset={0.15} onChange={(v) => set((p) => { p.areas[i].h = v; }, `pv:h:${i}:${clip.id}`)} />
          </Values>
          <Button onClick={() => set((p) => { p.areas.splice(i, 1); })}>{t('Remove area')}</Button>
        </div>
      ))}
      <Button disabled={pv.areas.length >= MAX_AREAS}
        onClick={() => set((p) => { p.areas.push({ x: anim(0.5), y: anim(0.5), w: 0.3, h: 0.15 }); })}>{t('Add area')}</Button>
      <p className="ck-hint">{t('Faces are found on this device in every frame, best when they look at the camera. Add an area for number plates or anything else; ◆ makes it follow a moving object.')}</p>
    </>
  );
}

export function LutSection({ clip, paint }: { clip: MediaVisual; paint: ReturnType<typeof useLookTiles> }) {
  const luts = useEditor((s) => s.project?.luts) ?? {};
  const items = useMemo(() => [{ id: 'none', name: 'None', cat: 'lut' }, ...Object.entries(luts).map(([id, l]) => ({ id, name: l.name, cat: 'lut' }))], [luts]);
  const draw = useMemo<TileDraw<(typeof items)[number]>>(() => (item, canvas) => paint(canvas, (c) => {
    if (item.id === 'none') delete c.lut;
    else c.lut = { id: item.id, intensity: c.lut?.intensity ?? 1 };
  }), [paint]);
  return (
    <>
      <h3>{t('LUT')}</h3>
      {items.length > 1 && (
        <StylePicker items={items} categories={LUT_CATEGORY} value={clip.lut && luts[clip.lut.id] ? clip.lut.id : 'none'} label={t('LUT')} draw={draw} rows={1}
          onChange={(id) => editClip(clip.id, (c) => {
            if (c.kind !== 'video' && c.kind !== 'image') return;
            if (id === 'none') delete c.lut;
            else c.lut = { id, intensity: c.lut?.intensity ?? 1 };
          })} />
      )}
      {clip.lut && luts[clip.lut.id] && (
        <Values label={t('Intensity')}>
          <Slider label={t('Intensity')} value={clip.lut.intensity} min={0} max={1} format={pct} reset={1}
            onChange={(v) => editClip(clip.id, (c) => { if ((c.kind === 'video' || c.kind === 'image') && c.lut) c.lut.intensity = v; }, `lut:${clip.id}`)} />
        </Values>
      )}
      <Button onClick={() => void importLut(clip.id)}>{t('Import LUT (.cube)')}</Button>
    </>
  );
}
