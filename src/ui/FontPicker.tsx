// Font, weight and "Add font" for text and captions (v1.6: captions got the fonts text had, the owner's request).
import { FONT_IDS, type FontId, type TextStyle } from '../core/types';
import { fontOf, fontWeight, type AnyFontId } from '../engine/text';
import { t } from '../lib/i18n';
import { useEditor } from '../state/store';
import { addCustomFont } from './actions';
import { Chips } from './controls';

const BUILT_IN = FONT_IDS as readonly FontId[];
const WEIGHTS = [400, 700, 900] as const;

export function FontPicker({ clipId, style, onFont, onWeight }: {
  clipId: string; style: TextStyle; onFont: (f: AnyFontId) => void; onWeight: (w: TextStyle['weight']) => void;
}) {
  const fonts = useEditor((st) => st.project?.fonts);
  return (
    <>
      <h3>{t('Font')}</h3>
      <Chips options={[...Object.keys(fonts ?? {}).map((id): AnyFontId => `custom:${id}`), ...BUILT_IN]} value={style.font} scroll label={t('Font')}
        onChange={onFont}
        render={(f) => <span style={{ fontFamily: fontOf(f).family, fontWeight: fontWeight(f, 700) }}>{f.startsWith('custom:') ? fonts?.[f.slice(7)]?.name : fontOf(f).label}</span>} />
      <button className="btn" onClick={() => void addCustomFont(clipId)}>{t('Add font')}</button>
      <Chips options={WEIGHTS} value={style.weight} label={t('Weight')} onChange={onWeight}
        render={(w) => (w === 400 ? t('Regular') : w === 700 ? t('Bold') : t('Black'))} />
    </>
  );
}
