// The styles of a text, and with the pairs flag its font pairs (docs/18 Ф4): one strip, on the black of the stage, on the
// person's own words. A pair puts its faces over the person's style and breaks a one-line text where Russian allows it.
import { useEffect, useMemo, useState } from 'react';
import { PAIRS, pairStyle, splitForPair } from '../core/pairs';
import { TEXT_CATEGORIES, TEXT_PRESETS } from '../core/presets';
import { PLACEHOLDERS } from '../core/previewWord';
import { createTextClip } from '../core/defaults';
import type { TextClip } from '../core/types';
import { t, useLocale } from '../lib/i18n';
import { editClip } from './actions';
import { usePreviewWord } from './FontPicker';
import { pairsOn } from './pairsFlag';
import { StylePicker } from './picker';
import { lookTile, type LookItem } from './tiles';

/** The look a pair's tile is drawn with: the faces of the pair over a new text's white letters. */
const NEW_TEXT = createTextClip(0, '').style;

export function TextStyles({ clip }: { clip: TextClip }) {
  const word = usePreviewWord(clip.text);
  const ru = useLocale((st) => st.locale === 'ru');
  // The pair tiles follow the text once typing pauses, as the word of the style tiles does.
  const [text, setText] = useState(clip.text);
  useEffect(() => { const id = setTimeout(() => setText(clip.text), 300); return () => clearTimeout(id); }, [clip.text]);
  const pairs = pairsOn();
  const items: LookItem[] = useMemo(() => [
    ...TEXT_PRESETS.map((p) => ({ id: p.id, name: p.name, cat: p.cat as string, style: p.style })),
    ...(pairs ? PAIRS.map((p) => ({ id: `pair:${p.id}`, name: ru ? p.name.ru : p.name.en, cat: 'pairs', style: pairStyle(p, NEW_TEXT), pair: p })) : []),
  ], [pairs, ru]);
  // «Пары» right after «Базовые»; the other categories keep their order (Ж1).
  const categories = pairs && PAIRS.length ? [TEXT_CATEGORIES[0], { id: 'pairs', name: 'Pairs' }, ...TEXT_CATEGORIES.slice(1)] : TEXT_CATEGORIES;
  const draw = useMemo(() => lookTile(word, text, ru), [word, text, ru]);
  const choose = (id: string) => editClip(clip.id, (c) => {
    if (c.kind !== 'text') return;
    const it = items.find((x) => x.id === id);
    if (it?.pair) {
      c.style = pairStyle(it.pair, c.style);
      const placeholder = !c.text.trim() || PLACEHOLDERS.includes(c.text.trim());
      c.text = placeholder ? (ru ? it.pair.sample.ru : it.pair.sample.en) : splitForPair(c.text, it.pair.split);
      return;
    }
    const pr = TEXT_PRESETS.find((p) => p.id === id);
    if (!pr) return;
    c.style = structuredClone(pr.style); // a style is one face: the looks of a pair go with it
    if (pr.animIn) c.animIn = { ...pr.animIn };
  });
  return <StylePicker items={items} categories={categories} value={null} label={t('Style')} draw={draw} ground="stage" onChange={choose} />;
}
