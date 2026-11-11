// Font, weight and "Add font" for text and captions (v1.6: captions got the fonts text had, the owner's request).
// Chetko Ч4 release 5: a font is chosen by its own letters, in groups, like the styles above it; the weight is one row
// of three segments; a font of one's own is added from the heading of the part.
import { Plus } from 'lucide-react';
import { FONT_IDS, type FontId, type TextStyle } from '../core/types';
import { fontOf, fontWeight, type AnyFontId, type FontGroup } from '../engine/text';
import { t, useLocale } from '../lib/i18n';
import { useEditor } from '../state/store';
import { addCustomFont } from './actions';
import { Chips } from './controls';
import { Button } from './ck/controls';
import { StylePicker } from './picker';

const BUILT_IN = FONT_IDS as readonly FontId[];
const WEIGHTS = [400, 700, 900] as const;
const GROUPS: readonly { id: FontGroup | 'custom'; name: string }[] = [
  { id: 'custom', name: 'Yours' }, { id: 'sans', name: 'Sans' }, { id: 'display', name: 'Display' }, { id: 'serif', name: 'Serif' },
  { id: 'script', name: 'Script' }, { id: 'mono', name: 'Mono' },
];

export function FontPicker({ clipId, style, onFont, onWeight }: {
  clipId: string; style: TextStyle; onFont: (f: AnyFontId) => void; onWeight: (w: TextStyle['weight']) => void;
}) {
  const fonts = useEditor((st) => st.project?.fonts);
  // «Ёж»: Ж shows the character of a face and that it has Cyrillic at all; Ё carries the two marks of the sign.
  const letters = useLocale((st) => (st.locale === 'ru' ? 'Ёж' : 'Ag'));
  const items = [
    ...Object.entries(fonts ?? {}).map(([id, f]) => ({ id: `custom:${id}`, name: f.name, cat: 'custom' })),
    ...BUILT_IN.map((id) => ({ id: id as string, name: fontOf(id).label, cat: fontOf(id).group as string })),
  ];
  return (
    <>
      <div className="ck-panel-part">
        <h3>{t('Font')}</h3>
        <Button variant="plain" icon={<Plus aria-hidden="true" />} onClick={() => void addCustomFont(clipId)}>{t('Add font')}</Button>
      </div>
      <StylePicker items={items} categories={GROUPS} value={style.font} label={t('Font')} kind="font"
        onChange={(id) => onFont(id as AnyFontId)}
        art={(it) => <span className="ck-font-letters" style={{ fontFamily: fontOf(it.id as AnyFontId).family, fontWeight: fontWeight(it.id as AnyFontId, style.weight) }}>{letters}</span>} />
      <Chips options={WEIGHTS} value={style.weight} label={t('Weight')} onChange={onWeight} even
        render={(w) => (w === 400 ? t('Regular') : w === 700 ? t('Bold') : t('Black'))} />
    </>
  );
}
