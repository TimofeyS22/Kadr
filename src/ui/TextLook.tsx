// How letters look, the same for text and captions (v1.6.4, the owner: "more caption styles and settings: outline, fonts
// and so on"). One set of controls over one `TextStyle`, so what text can do captions can do, and neither falls behind.
import type { TextStyle } from '../core/types';
import { TEXT_BG_PADDING, TEXT_LINE_HEIGHT } from '../engine/text';
import { t } from '../lib/i18n';
import { Chips, Slider, Swatches, Toggle, pct } from './controls';

type Change = (fn: (s: TextStyle) => void, key?: string) => void;

const SHADOW_KINDS = ['none', 'soft', 'glow', 'hard', 'block'] as const;
type ShadowKind = (typeof SHADOW_KINDS)[number];
const SHADOW_LABELS: Record<ShadowKind, string> = { none: 'None', soft: 'Soft shadow', glow: 'Glow', hard: 'Hard', block: '3D' };
const shadowKind = (s: TextStyle): ShadowKind =>
  s.copies?.length ? (s.copies[0].depth ? 'block' : 'hard') : !s.shadow ? 'none' : s.shadowColor ? 'glow' : 'soft';

/** One kind of shadow at a time: each is a different field of the style, and leftovers of the last would still be drawn. */
function setShadow(s: TextStyle, kind: ShadowKind): void {
  const color = s.copies?.[0]?.color ?? s.shadowColor ?? '#000000';
  delete s.copies;
  delete s.shadowColor;
  s.shadow = kind === 'soft' || kind === 'glow';
  if (kind === 'glow') s.shadowColor = color === '#000000' ? '#ffd60a' : color;
  if (kind === 'hard') s.copies = [{ color, x: 0.06, y: 0.06 }];
  if (kind === 'block') s.copies = [{ color, x: 0.08, y: 0.08, depth: true }];
}

export function TextLook({ style: s, change }: { style: TextStyle; change: Change }) {
  const kind = shadowKind(s);
  const shadowColor = s.copies?.[0]?.color ?? s.shadowColor ?? '#000000';
  const offset = s.copies?.length ? Math.max(Math.abs(s.copies[0].x), Math.abs(s.copies[0].y)) : 0.06;
  return (
    <>
      <Toggle label={t('Italic')} value={s.italic} onChange={(v) => change((x) => { x.italic = v; })} />
      <Toggle label={t('ALL CAPS')} value={!!s.uppercase} onChange={(v) => change((x) => { if (v) x.uppercase = true; else delete x.uppercase; })} />

      <h3>{t('Color')}</h3>
      <Swatches label={t('Text color')} value={s.color} onChange={(col) => change((x) => { x.color = col; })} />
      <Toggle label={t('Gradient')} value={!!s.gradient} onChange={(v) => change((x) => { if (v) x.gradient = '#ff2d92'; else delete x.gradient; })} />
      {s.gradient && <Swatches label={t('Gradient color')} value={s.gradient} onChange={(col) => change((x) => { x.gradient = col; })} />}

      {/* The switch names the part: no heading «Обводка» over a switch «Обводка». */}
      <Toggle label={t('Outline')} value={!!s.stroke} onChange={(v) => change((x) => { x.stroke = v ? { color: '#000000', width: 0.08 } : null; if (!v) delete x.outline2; })} />
      {s.stroke && (
        <>
          <Swatches label={t('Outline color')} value={s.stroke.color} onChange={(col) => change((x) => { if (x.stroke) x.stroke.color = col; })} />
          <Slider label={t('Outline width')} value={s.stroke.width} min={0.01} max={0.3} format={pct} reset={0.08}
            onChange={(v) => change((x) => { if (x.stroke) x.stroke.width = v; }, 'sw')} />
          <Toggle label={t('Second outline')} value={!!s.outline2} onChange={(v) => change((x) => { if (v) x.outline2 = { color: '#ffffff', width: 0.14 }; else delete x.outline2; })} />
          {s.outline2 && (
            <>
              <Swatches label={t('Second outline color')} value={s.outline2.color} onChange={(col) => change((x) => { if (x.outline2) x.outline2.color = col; })} />
              <Slider label={t('Second outline width')} value={s.outline2.width} min={0.02} max={0.4} format={pct} reset={0.14}
                onChange={(v) => change((x) => { if (x.outline2) x.outline2.width = v; }, 'o2')} />
            </>
          )}
        </>
      )}

      <h3>{t('Shadow')}</h3>
      <Chips options={SHADOW_KINDS} value={kind} label={t('Shadow')} render={(k) => t(SHADOW_LABELS[k])} onChange={(k) => change((x) => setShadow(x, k))} />
      {(kind === 'glow' || kind === 'hard' || kind === 'block') && (
        <Swatches label={t('Shadow color')} value={shadowColor} onChange={(col) => change((x) => {
          if (x.copies?.length) x.copies[0].color = col; else x.shadowColor = col;
        })} />
      )}
      {(kind === 'hard' || kind === 'block') && (
        <Slider label={t('Shadow distance')} value={offset} min={0.01} max={0.3} format={pct} reset={0.06}
          onChange={(v) => change((x) => { for (const c of x.copies ?? []) { c.x = Math.sign(c.x || 1) * v; c.y = Math.sign(c.y || 1) * v; } }, 'sd')} />
      )}

      {/* The switch names the part itself: a heading «Фон» over a switch «Фон» said it twice. */}
      <Toggle label={t('Background')} value={!!s.background} onChange={(v) => change((x) => { x.background = v ? { color: '#000000', opacity: 0.6 } : null; })} />
      {s.background && (
        <>
          <Swatches label={t('Background color')} value={s.background.color} onChange={(col) => change((x) => { if (x.background) x.background.color = col; })} />
          <Slider label={t('Opacity')} value={s.background.opacity} min={0.05} max={1} format={pct} reset={0.6}
            onChange={(v) => change((x) => { if (x.background) x.background.opacity = v; }, 'bgo')} />
          <Slider label={t('Padding')} value={s.background.padding ?? TEXT_BG_PADDING} min={0} max={1.5} step={0.01} format={(v) => `${Math.round(v * 100)}`} reset={TEXT_BG_PADDING}
            onChange={(v) => change((x) => { if (x.background) x.background.padding = v; }, 'bgp')} />
          <Slider label={t('Corners')} value={s.background.radius ?? 0.3} min={0} max={1} step={0.01} format={pct} reset={0.3}
            onChange={(v) => change((x) => { if (x.background) x.background.radius = v; }, 'bgr')} />
          <Toggle label={t('A box for each line')} value={!!s.background.lines} onChange={(v) => change((x) => { if (x.background) { if (v) x.background.lines = true; else delete x.background.lines; } })} />
        </>
      )}

      <h3>{t('Spacing')}</h3>
      <Slider label={t('Letter spacing')} value={s.letterSpacing ?? 0} min={-0.1} max={0.6} step={0.01} format={(v) => `${Math.round(v * 100)}`} reset={0}
        onChange={(v) => change((x) => { x.letterSpacing = v; }, 'tls')} />
      <Slider label={t('Line spacing')} value={s.lineHeight ?? TEXT_LINE_HEIGHT} min={0.8} max={2.5} step={0.05} format={(v) => `${v.toFixed(2)}×`} reset={TEXT_LINE_HEIGHT}
        onChange={(v) => change((x) => { x.lineHeight = v; }, 'tlh')} />
      <h3>{t('Alignment')}</h3>
      <Chips even options={['left', 'center', 'right'] as const} value={s.align} label={t('Alignment')} render={(a) => t(a === 'left' ? 'Left' : a === 'right' ? 'Right' : 'Center')}
        onChange={(a) => change((x) => { x.align = a; })} />
    </>
  );
}
