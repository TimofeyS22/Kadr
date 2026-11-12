// Font pairs in the gallery (`?ds`, docs/18 П4): the tile of a pair in each of its states, drawn by the video's renderer
// on the black of the stage, and the part of the text sheet a pair brings — «Весь текст · Строка 1 · Строка 2» with
// «Поменять местами» and «Один шрифт» under it. Shown whether or not `?pairs` is on: the gallery shows the system.
import { useEffect, useMemo, useRef, useState } from 'react';
import { createTextClip } from '../core/defaults';
import { PAIRS, pairStyle } from '../core/pairs';
import { Button } from './ck/controls';
import { Chips } from './controls';
import { StylePicker } from './picker';
import { lookTile, type LookItem } from './tiles';
import './sheets.css';

const NEW_TEXT = createTextClip(0, '').style;
const items: LookItem[] = PAIRS.map((p) => ({ id: p.id, name: p.name.ru, cat: 'pairs', style: pairStyle(p, NEW_TEXT), pair: p }));
const CATS = [{ id: 'pairs', name: 'Пары' }];

export function DsPairs() {
  const [pair, setPair] = useState(PAIRS[1].id);
  const [own, setOwn] = useState(PAIRS[0].id);
  const [line, setLine] = useState<'all' | number>('all');
  const [said, setSaid] = useState('Нажмите «Поменять местами» или «Один шрифт»');
  const sample = useMemo(() => lookTile('Привет', 'Ваш текст', true), []);
  const mine = useMemo(() => lookTile('Лето', 'С днём рождения, Аня', true), []);
  // A tile waiting for its faces stays black (its canvas fades in once drawn); pressed and focused as a finger and a
  // keyboard leave them.
  const states = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const tiles = states.current?.querySelectorAll<HTMLElement>('.ck-ptile');
    tiles?.[1]?.setAttribute('data-demo', 'pressed');
    tiles?.[2]?.setAttribute('data-demo', 'focus');
  }, []);
  const waiting: LookItem[] = items.slice(0, 4).map((it, i) => ({ ...it, name: ['Обычная', 'Нажата', 'Фокус', 'Ждёт шрифт'][i] }));
  return (
    <section>
      <h2>Пары шрифтов</h2>
      <p className="ds-dim">Плитка пары — её образец, пока текст человека не набран, и его собственный текст, разбитый по правилу пары, когда набран. Выбранная обведена белым с зазором.</p>
      <StylePicker items={items} categories={CATS} value={pair} label="Пара на образце" ground="stage" draw={sample} onChange={setPair} rows={1} />
      <StylePicker items={items} categories={CATS} value={own} label="Пара на тексте «С днём рождения, Аня»" ground="stage" draw={mine} onChange={setOwn} rows={1} />
      <div ref={states}>
        <StylePicker items={waiting} categories={CATS} value={null} label="Состояния плитки" ground="stage" rows={1}
          draw={(it, canvas, time, redraw) => { if (it.name !== 'Ждёт шрифт') sample(it, canvas, time, redraw); }} onChange={() => undefined} />
      </div>
      <p className="ds-dim">Лист «Текст» у пары: правка всего текста или одной строки, ниже две половины по 44 px.</p>
      <Chips options={['all' as const, 0, 1]} value={line} label="Строка" onChange={setLine} even
        render={(i) => (i === 'all' ? 'Весь текст' : `Строка ${i + 1}`)} />
      <div className="ck-line-acts">
        <Button variant="plain" onClick={() => setSaid('Строки поменялись местами, каждая со своим шрифтом')}>Поменять местами</Button>
        <Button variant="plain" onClick={() => setSaid('Пара снята: весь текст шрифтом опоры')}>Один шрифт</Button>
      </div>
      <p className="ds-dim" aria-live="polite">{said}</p>
    </section>
  );
}
