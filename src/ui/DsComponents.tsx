// The components of the Chetko system in the gallery (`?ds`, docs/17 stage Ч3): each one in its states, and then
// together — the bottom of the editor assembled from them, the way the screens will use them.
import {
  AudioLines, AudioWaveform, Blend, Captions, CircleDashed, Contrast, Copy, CopyCheck, Crop, EyeOff, FlipHorizontal2, Gauge, LayoutGrid, Move, PersonStanding, Pipette,
  Minus, Plus, Redo2, Rewind, RotateCcw, ScanFace, Scissors, ScissorsLineDashed, SlidersHorizontal, Snowflake, Trash2, Undo2, Upload, Volume2, X, Zap, type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';
import type { ScaleSpec } from '../core/scale';
import './ck/ck.css';
import { Button, IconButton, Progress, Ribbon, Tabs, Tool } from './ck/controls';
import { Scale } from './ck/Scale';
import { Sheet } from './ck/Sheet';

type Kind = 'speed' | 'volume' | 'colour';
// The order of today's toolbar of a video piece (v1.7.1): nothing moves.
const TOOLS: [string, LucideIcon, Kind | 'danger' | null][] = [
  ['Разрезать', Scissors, null], ['Дублировать', Copy, null], ['Удалить', Trash2, 'danger'], ['Скорость', Gauge, 'speed'], ['Громкость', Volume2, 'volume'], ['Голос', AudioLines, null],
  ['Субтитры', Captions, null], ['Убрать паузы', ScissorsLineDashed, null], ['Кадрировать', Crop, null], ['Отразить', FlipHorizontal2, null], ['Трансформация', Move, null],
  ['Настройка', SlidersHorizontal, 'colour'], ['Фильтры', Blend, null], ['Эффекты', Zap, null], ['Маска', CircleDashed, null], ['Скрыть лица', EyeOff, null], ['Вырезать фон', PersonStanding, null],
  ['Хромакей', Pipette, null], ['Авто-рефрейм', ScanFace, null], ['Стоп-кадр', Snowflake, null], ['Реверс', Rewind, null], ['Извлечь звук', AudioWaveform, null], ['Выбрать несколько', CopyCheck, null],
];
const signed = (v: number) => (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v);
const times = (v: number) => `${String(v / 100).replace('.', ',')}×`;
const percent = (v: number) => `${v}%`;
const COLOUR: ScaleSpec = { min: -100, max: 100, rest: 0, step: 1, hold: 4, pxPerUnit: 2, minor: 5, major: 25 };
interface Param { id: string; label: string; spec: ScaleSpec; format: (v: number) => string; labels: number[] }
const PARAMS: Record<Kind, Param[]> = {
  speed: [{ id: 'speed', label: 'Скорость', spec: { min: 25, max: 400, rest: 100, step: 5, hold: 8, pxPerUnit: 1, minor: 25, major: 100 }, format: times, labels: [25, 100, 200, 300, 400] }],
  volume: [{ id: 'volume', label: 'Громкость', spec: { min: 0, max: 200, rest: 100, step: 1, hold: 5, pxPerUnit: 2, minor: 10, major: 50 }, format: percent, labels: [0, 50, 100, 150, 200] }],
  colour: ['Экспозиция', 'Контраст', 'Насыщенность', 'Света', 'Тени'].map((label, i) => ({ id: `c${i}`, label, spec: COLOUR, format: signed, labels: [-100, -50, 0, 50, 100] })),
};

function Assembled() {
  const [kind, setKind] = useState<Kind | null>(null);
  const [param, setParam] = useState('');
  const [values, setValues] = useState<Record<string, number>>({});
  const [history, setHistory] = useState<{ id: string; from: number }[]>([]);
  const [all, setAll] = useState(false);
  const [said, setSaid] = useState('Нажмите «Скорость» или «Все»');

  const open = (k: Kind) => { setKind(k); setParam(PARAMS[k][0].id); setAll(false); setSaid(PARAMS[k][0].label); };
  const press = (name: string, k: Kind | 'danger' | null) => { if (k && k !== 'danger') open(k); else { setAll(false); setSaid(`«${name}» в галерее только показан`); } };
  const current = kind ? PARAMS[kind].find((p) => p.id === param) ?? PARAMS[kind][0] : null;
  const value = current ? values[current.id] ?? current.spec.rest : 0;
  const set = (id: string, v: number) => setValues((s) => ({ ...s, [id]: v }));
  const undo = () => {
    const last = history.at(-1);
    if (!last) { setSaid('Отменять пока нечего'); return; }
    setHistory(history.slice(0, -1));
    set(last.id, last.from);
    setSaid('Отменено');
  };
  const tools = (k: 'ribbon' | 'grid') => TOOLS.map(([name, Icon, t]) => (
    <Tool key={`${k}-${name}`} icon={<Icon aria-hidden="true" />} label={name} danger={t === 'danger'} on={name === 'Скорость' && (values.speed ?? 100) !== 100} onNote="изменено" onClick={() => press(name, t)} />
  ));

  return (
    <div className="ds-stage" data-testid="assembled" lang="ru">
      <div className="ds-stage-top">
        <IconButton label="Отменить" onClick={undo}><Undo2 aria-hidden="true" /></IconButton>
        <IconButton label="Повторить" disabled><Redo2 aria-hidden="true" /></IconButton>
        <span className="ds-said" role="status">{said}</span>
      </div>
      {kind && current ? (
        <>
          <div className="ds-stage-row">
            <Tabs label="Параметры" items={PARAMS[kind]} value={current.id} onChange={(id) => { setParam(id); setSaid(PARAMS[kind].find((p) => p.id === id)?.label ?? ''); }} />
            <Button onClick={() => { setKind(null); setSaid('Готово'); }}>Готово</Button>
          </div>
          <Scale key={current.id} label={current.label} spec={current.spec} value={value} format={current.format} labels={current.labels}
            stepDown={{ label: 'Меньше', icon: <Minus aria-hidden="true" /> }} stepUp={{ label: 'Больше', icon: <Plus aria-hidden="true" /> }}
            onChange={(v) => set(current.id, v)} onCommit={(from, _to, more) => { if (!more) setHistory((h) => [...h, { id: current.id, from }]); }}
            before={<Button variant="plain" icon={<RotateCcw aria-hidden="true" />} disabled={value === current.spec.rest}
              onClick={() => { setHistory((h) => [...h, { id: current.id, from: value }]); set(current.id, current.spec.rest); }}>Сбросить</Button>}
            after={<Button variant="plain" icon={<Contrast aria-hidden="true" />}>До и после</Button>} />
        </>
      ) : (
        <Ribbon label="Инструменты" start={<Tool icon={<X aria-hidden="true" />} label="Назад" onClick={() => setSaid('Назад: к инструментам проекта')} />}
          end={<Tool icon={<LayoutGrid aria-hidden="true" />} label="Все" onClick={() => setAll(true)} />}>
          {tools('ribbon')}
        </Ribbon>
      )}
      <Sheet open={all} title="Все инструменты" closeLabel="Закрыть" closeIcon={<X aria-hidden="true" />} onClose={() => setAll(false)}>
        <div className="ck-toolgrid">{tools('grid')}</div>
      </Sheet>
    </div>
  );
}

export function DsComponents() {
  const [tab, setTab] = useState('a');
  const [done, setDone] = useState(0.64);
  return (
    <>
      <section>
        <h2>Кнопки</h2>
        <p className="ds-dim">Главная кнопка на экране одна, и она белая. Нажатую и с фокусом клавиатуры показывают два последних ряда.</p>
        <div className="ds-row">
          <Button variant="primary" size="large" icon={<Plus aria-hidden="true" />}>Добавить видео</Button>
          <Button variant="primary" icon={<Upload aria-hidden="true" />}>Экспорт</Button>
          <Button>Готово</Button>
          <Button variant="plain" icon={<RotateCcw aria-hidden="true" />}>Сбросить</Button>
          <Button variant="danger" icon={<Trash2 aria-hidden="true" />}>Удалить проект</Button>
        </div>
        <div className="ds-row">
          <Button variant="primary" disabled>Экспорт</Button><Button disabled>Готово</Button><Button variant="plain" disabled>Сбросить</Button><Button variant="danger" disabled>Удалить проект</Button>
        </div>
        <div className="ds-row">
          <Button variant="primary" data-demo="pressed">Нажата</Button><Button data-demo="pressed">Нажата</Button>
          <Button variant="primary" data-demo="focus">Фокус</Button><Button data-demo="focus">Фокус</Button>
        </div>
        <div className="ds-row">
          <IconButton label="Отменить"><Undo2 aria-hidden="true" /></IconButton>
          <IconButton label="Повторить" disabled><Redo2 aria-hidden="true" /></IconButton>
          <IconButton label="Закрыть" data-demo="pressed"><X aria-hidden="true" /></IconButton>
          <IconButton label="Закрыть" data-demo="focus"><X aria-hidden="true" /></IconButton>
        </div>
      </section>

      <section>
        <h2>Инструмент</h2>
        <p className="ds-dim">Значок всегда с подписью. Инструмент, который уже изменил кусок, отмечен меткой, а не цветом.</p>
        <div className="ds-row">
          <Tool icon={<Scissors aria-hidden="true" />} label="Разрезать" />
          <Tool icon={<Gauge aria-hidden="true" />} label="Скорость" on onNote="изменено" />
          <Tool icon={<Trash2 aria-hidden="true" />} label="Удалить" danger />
          <Tool icon={<Crop aria-hidden="true" />} label="Кадрировать" disabled />
          <Tool icon={<Copy aria-hidden="true" />} label="Нажат" data-demo="pressed" />
          <Tool icon={<Copy aria-hidden="true" />} label="Фокус" data-demo="focus" />
        </div>
      </section>

      <section>
        <h2>Вкладки параметров</h2>
        <Tabs label="Пример вкладок" items={[{ id: 'a', label: 'Экспозиция' }, { id: 'b', label: 'Контраст' }, { id: 'c', label: 'Насыщенность' }, { id: 'd', label: 'Света' }, { id: 'e', label: 'Тени' }]} value={tab} onChange={setTab} />
      </section>

      <section>
        <h2>Прогресс</h2>
        <p className="ds-dim">Работа лежит между двумя метками и видна настолько, насколько сделана.</p>
        <div className="ds-row"><span className="ck-digit" style={{ fontSize: 'var(--type-display)' }}>{Math.round(done * 100)}%</span><Button onClick={() => setDone(done >= 1 ? 0 : Math.min(1, done + 0.12))}>Дальше</Button></div>
        <div className="ds-pad"><Progress label="Экспорт" value={done} /></div>
      </section>

      <section>
        <h2>В сборе: шкала, лента и лист</h2>
        <p className="ds-dim">Низ редактора из настоящих компонентов. Тяните полосу, нажимайте по делению, ведите стрелками с клавиатуры. На исходном значении полоса задерживается, но ни одно значение не пропадает.</p>
        <Assembled />
      </section>
    </>
  );
}
