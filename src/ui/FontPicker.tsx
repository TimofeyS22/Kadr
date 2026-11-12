// Font, weight and "Add font" for text and captions (v1.6: captions got the fonts text had, the owner's request).
// Chetko Ч4 release 5: fonts in groups like the styles above them; the weight is one row of three segments; a font of
// one's own is added from the heading of the part.
// docs/18 (the owner, 2026-11-11: «серая обложка за шрифтами выглядит ужасно старо»): each font shows the person's own
// word in white on the black of the stage, drawn by the video's renderer, instead of the same «Ёж» on the grey sheet.
import { Plus } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { canSwap, swapLines } from '../core/lineLook';
import { previewWord } from '../core/previewWord';
import { findClip } from '../core/timeline';
import { FONT_IDS, type CustomFontId, type FontId, type TextStyle } from '../core/types';
import { fontOf, type AnyFontId, type FontGroup } from '../engine/text';
import { t, useLocale } from '../lib/i18n';
import { useEditor } from '../state/store';
import { addCustomFont, editClip } from './actions';
import { useLineChoice } from './lineChoice';
import { Chips } from './controls';
import { Button } from './ck/controls';
import { StylePicker } from './picker';
import { fontTile } from './tiles';

const BUILT_IN = FONT_IDS as readonly FontId[];
const WEIGHTS = [400, 700, 900] as const;
const GROUPS: readonly { id: FontGroup | 'custom'; name: string }[] = [
  { id: 'custom', name: 'Yours' }, { id: 'sans', name: 'Sans' }, { id: 'display', name: 'Display' }, { id: 'serif', name: 'Serif' },
  { id: 'script', name: 'Script' }, { id: 'mono', name: 'Mono' },
];
/** The tiles follow the text 300 ms after the last key: the letters on the frame answer at once, the tiles need not. */
const TYPING_MS = 300;

/** The word the font and style tiles are drawn on: the person's own (`previewWord`), settled after typing. */
export function usePreviewWord(text: string): string {
  const fallback = useLocale((st) => (st.locale === 'ru' ? 'Привет' : 'Hello'));
  const now = previewWord(text, fallback);
  const [word, setWord] = useState(now);
  useEffect(() => {
    const id = setTimeout(() => setWord(now), TYPING_MS);
    return () => clearTimeout(id);
  }, [now]);
  return word;
}

export function FontPicker({ clipId, style, onFont, onWeight }: {
  clipId: string; style: TextStyle; onFont: (f: AnyFontId) => void; onWeight: (w: TextStyle['weight']) => void;
}) {
  const fonts = useEditor((st) => st.project?.fonts);
  const text = useEditor((st) => {
    const c = st.project ? findClip(st.project, clipId)?.clip : undefined;
    return c?.kind === 'text' ? c.text : c?.kind === 'caption' ? c.words.map((w) => w.text).join(' ') : '';
  });
  const swappable = useEditor((st) => {
    const c = st.project ? findClip(st.project, clipId)?.clip : undefined;
    return c?.kind === 'text' && canSwap(c.text, c.style);
  });
  // A pair (docs/18 ADR-П7): «Весь текст · Строка 1 · Строка 2». The font and weight of one line, or of the whole text
  // (which takes back what the lines set for themselves); the size and the look below follow the same choice. The
  // tiles show the chosen line's own words.
  const lines = style.lines;
  const [choice, setChoice] = useLineChoice(clipId, style);
  const li = lines?.length && choice !== 'all' ? choice : -1;
  const look = li >= 0 ? lines![li] : null;
  const word = usePreviewWord(li >= 0 ? text.split('\n')[li] ?? '' : text);
  const font = look?.font ?? style.font, weight = look?.weight ?? style.weight;
  const setFont = (f: AnyFontId) => {
    if (!lines?.length) { onFont(f); return; }
    editClip(clipId, (c) => {
      if (c.kind !== 'text' || !c.style.lines) return;
      if (li >= 0) { if (c.style.lines[li]) c.style.lines[li].font = f as FontId | CustomFontId; return; }
      c.style.font = f as FontId | CustomFontId;
      for (const l of c.style.lines) delete l.font;
    });
  };
  const setWeight = (w: TextStyle['weight']) => {
    if (!lines?.length) { onWeight(w); return; }
    editClip(clipId, (c) => {
      if (c.kind !== 'text' || !c.style.lines) return;
      if (li >= 0) { if (c.style.lines[li]) c.style.lines[li].weight = w; return; }
      c.style.weight = w;
      for (const l of c.style.lines) delete l.weight;
    });
  };
  const items = useMemo(() => [
    ...Object.entries(fonts ?? {}).map(([id, f]) => ({ id: `custom:${id}`, name: f.name, cat: 'custom' })),
    ...BUILT_IN.map((id) => ({ id: id as string, name: fontOf(id).label, cat: fontOf(id).group as string })),
  ], [fonts]);
  const italic = look?.italic ?? style.italic, uppercase = look?.uppercase ?? style.uppercase, letterSpacing = look?.letterSpacing ?? style.letterSpacing;
  const draw = useMemo(() => fontTile(word, { weight, italic, uppercase, letterSpacing }), [word, weight, italic, uppercase, letterSpacing]);
  return (
    <>
      <div className="ck-panel-part">
        <h3>{t('Font')}</h3>
        <Button variant="plain" icon={<Plus aria-hidden="true" />} onClick={() => void addCustomFont(clipId)}>{t('Add font')}</Button>
      </div>
      {/* The parts of a pair get the whole width (at 375 px «Весь текст» was cut beside a button); «Поменять местами» and
          «Один шрифт» under them. A swapped line keeps being the chosen one: the choice follows it to its new place. */}
      {lines?.length ? (
        <>
          <Chips options={['all' as const, ...lines.map((_, i) => i)]} value={choice} label={t('Line')} onChange={setChoice} even
            render={(i) => (i === 'all' ? t('Whole text') : t('Line {n}', { n: i + 1 }))} />
          <div className="ck-line-acts">
            {swappable && (
              <Button variant="plain" onClick={() => {
                editClip(clipId, (c) => { if (c.kind === 'text') c.text = swapLines(c.text, c.style); });
                if (choice !== 'all') setChoice(1 - choice);
              }}>{t('Swap lines')}</Button>
            )}
            <Button variant="plain" onClick={() => editClip(clipId, (c) => { if (c.kind === 'text') delete c.style.lines; })}>{t('One font')}</Button>
          </div>
        </>
      ) : null}
      <StylePicker items={items} categories={GROUPS} value={font} label={t('Font')} kind="font" ground="stage" draw={draw}
        onChange={(id) => setFont(id as AnyFontId)} />
      <Chips options={WEIGHTS} value={weight} label={t('Weight')} onChange={setWeight} even
        render={(w) => (w === 400 ? t('Regular') : w === 700 ? t('Bold') : t('Black'))} />
    </>
  );
}
