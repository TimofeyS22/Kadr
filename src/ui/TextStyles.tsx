// The styles of a text, and with the pairs flag its font pairs (docs/18 Ф4): one strip, on the black of the stage, on the
// person's own words. A pair puts its faces over the person's style and breaks a one-line text where Russian allows it.
import { useEffect, useMemo, useRef, useState } from 'react';
import { PAIR_VARIANTS, PAIRS, pairPlate, pairStyle, pickVariant, splitForPair } from '../core/pairs';
import { TEXT_CATEGORIES, TEXT_PRESETS } from '../core/presets';
import { PLACEHOLDERS } from '../core/previewWord';
import { createTextClip } from '../core/defaults';
import type { TextClip } from '../core/types';
import { t, useLocale } from '../lib/i18n';
import { useEditor } from '../state/store';
import { editClip } from './actions';
import { Button } from './ck/controls';
import { toneUnder, type Tone } from './frameTone';
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
  // How light and how busy the picture under the text is (Ш6), read once when the sheet opens.
  // The frame may not be decoded yet when the sheet opens: it is asked again a few times.
  const [tone, setTone] = useState<Tone | null>(null);
  useEffect(() => {
    let gone = false, tries = 0, timer = 0;
    const read = () => {
      const st = useEditor.getState();
      if (!pairs || !st.project) return;
      void toneUnder(st.project, clip, st.time).then((v) => {
        if (gone) return;
        if (v) setTone(v); else if (++tries < 8) timer = window.setTimeout(read, 400);
      }, (e: unknown) => console.warn('pairs: no tone under the text', e));
    };
    read();
    return () => { gone = true; clearTimeout(timer); };
  }, [clip.id, pairs]); // eslint-disable-line react-hooks/exhaustive-deps
  const pick = pickVariant(tone);
  // A pair put on before the frame was read takes the letters the frame asks for once it is read (one step of Undo).
  const pending = useRef(false);
  const history = `pair:${clip.id}`;
  useEffect(() => {
    if (!tone || !pending.current) return;
    pending.current = false;
    const v = pickVariant(tone).variant;
    editClip(clip.id, (c) => {
      if (c.kind !== 'text' || !c.style.lines) return;
      Object.assign(c.style, PAIR_VARIANTS[v]);
      if (!PAIR_VARIANTS[v].shadowColor) delete c.style.shadowColor;
    }, history);
  }, [tone]); // eslint-disable-line react-hooks/exhaustive-deps
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
      c.style = pairStyle(it.pair, c.style, pick.variant);
      pending.current = !tone;
      const placeholder = !c.text.trim() || PLACEHOLDERS.includes(c.text.trim());
      c.text = placeholder ? (ru ? it.pair.sample.ru : it.pair.sample.en) : splitForPair(c.text, it.pair.split);
      return;
    }
    const pr = TEXT_PRESETS.find((p) => p.id === id);
    if (!pr) return;
    c.style = structuredClone(pr.style); // a style is one face: the looks of a pair go with it
    if (pr.animIn) c.animIn = { ...pr.animIn };
  }, history);
  // A pair on a picture its bare letters cannot hold (a busy one, or one as light as both variants): a box, one tap.
  const plate = pairs && !!clip.style.lines && !clip.style.background && pick.plate;
  const variant = clip.style.color === PAIR_VARIANTS.dark.color ? 'dark' : 'light';
  return (
    <>
      <StylePicker items={items} categories={categories} value={null} label={t('Style')} draw={draw} ground="stage" onChange={choose} />
      {plate && <Button variant="plain" onClick={() => editClip(clip.id, (c) => { if (c.kind === 'text') c.style.background = pairPlate(variant); })}>{t('Add a box')}</Button>}
    </>
  );
}
