// The second part of the gallery (`?ds`, docs/17 stage Ч3): choices, fields, the home screen and the editor assembled
// from the components, with state, so each behaviour can be tried with a finger, a keyboard and a screen reader.
import {
  AudioLines, Blend, Captions, CircleAlert, Clapperboard, Copy, Crop, Disc3, Film, Frame, Gauge, Layers, Layers3, Mic, Move, Music, Pause, Pencil, Play, Plus, Redo2, Scissors,
  Smile, Sparkles, Trash2, Type, Undo2, Video, Volume2, Waves, X, type LucideIcon,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { Segments, Tiles } from './ck/choice';
import { Button, IconButton, Ribbon, Tool } from './ck/controls';
import { Confirm, ToastRegion, type ToastItem } from './ck/feedback';
import { Field } from './ck/Field';
import { Empty, ProjectRow } from './ck/home';
import { Sheet } from './ck/Sheet';
import { Clip, Join, Lane, ObjectFrame, Playhead, Ruler, Transport, Wave } from './ck/timeline';
import { PEAKS, Shot } from './dsArt';

const counted = (n: number, max: number) => `${n} из ${max} знаков`;
/** After a layer closes or a row goes, the focus lands here instead of nowhere. */
const focusLater = (find: () => HTMLElement | null | undefined) => requestAnimationFrame(() => find()?.focus({ preventScroll: true }));
const close = { closeLabel: 'Закрыть', closeIcon: <X aria-hidden="true" /> };

const clock = (s: number, tenths = true) => {
  const m = Math.floor(s / 60), r = s - m * 60;
  const whole = Math.floor(r + 1e-6);
  return `${m}:${String(whole).padStart(2, '0')}${tenths ? `,${Math.floor((r - whole) * 10 + 1e-6)}` : ''}`;
};

function useToasts() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const next = useRef(1);
  const say = useCallback((t: Omit<ToastItem, 'id'>) => setItems((list) => [...list.slice(-1), { ...t, id: next.current++ }]), []);
  const dismiss = useCallback((id: number) => setItems((list) => list.filter((i) => i.id !== id)), []);
  return { items, say, dismiss };
}

// ---- the home screen ----
interface Project { id: number; title: string; secs: number; when: string; scene: 'night' | 'mountains' | 'food' }
const SAMPLE: Project[] = [
  { id: 1, title: 'Поход на Алтай', secs: 42, when: 'сегодня', scene: 'mountains' },
  { id: 2, title: 'Рецепт за минуту', secs: 58, when: 'вчера', scene: 'food' },
  { id: 3, title: 'Огни города', secs: 15, when: '3 ноября', scene: 'night' },
];

function HomeStage() {
  const [projects, setProjects] = useState(SAMPLE);
  const [asked, setAsked] = useState<Project | null>(null);
  const [naming, setNaming] = useState<Project | null>(null);
  const [name, setName] = useState('');
  const home = useRef<HTMLDivElement>(null);
  const { items, say, dismiss } = useToasts();
  const rename = () => {
    if (!naming) return;
    const title = name.trim();
    if (!title) return;
    setProjects((list) => list.map((p) => (p.id === naming.id ? { ...p, title } : p)));
    setNaming(null);
    say({ text: 'Название сохранено' });
  };
  return (
    <div className="ds-stage ds-home" data-testid="home" lang="ru" ref={home}>
      <header className="ds-home-head"><span className="ck-wm ds-home-wm" role="img" aria-label="Чётко">Ч<span className="ck-yo">е</span>тко</span></header>
      <div className="ds-home-list">
        <p className="ds-dim ds-home-note">Всё на этом телефоне. Работает без интернета.</p>
        {projects.length ? (
          <>
            <h3 className="ds-home-count">Проекты <span className="ds-dim">{projects.length}</span></h3>
            {projects.map((p) => (
              <ProjectRow key={p.id} title={p.title} meta={`${clock(p.secs, false)}, ${p.when}, сохранено`} thumb={<Shot scene={p.scene} />}
                onOpen={() => say({ text: `«${p.title}» открывается в редакторе` })}
                actions={<>
                  <IconButton label={`Копия «${p.title}»`} onClick={() => { setProjects((list) => [...list, { ...p, id: Date.now(), title: `${p.title}, копия`, when: 'сегодня' }]); say({ text: 'Копия сохранена' }); }}><Copy aria-hidden="true" /></IconButton>
                  <IconButton label={`Переименовать «${p.title}»`} onClick={() => { setName(p.title); setNaming(p); }}><Pencil aria-hidden="true" /></IconButton>
                  <IconButton label={`Удалить «${p.title}»`} danger onClick={() => setAsked(p)}><Trash2 aria-hidden="true" /></IconButton>
                </>} />
            ))}
          </>
        ) : (
          <Empty art={<Shot scene="mountains" />} title="Посмотрите, что получается"
            action={<Button onClick={() => { setProjects(SAMPLE); say({ text: 'Пример открыт' }); }}>Открыть пример</Button>}>
            Готовый пример на 12 секунд. Его можно открыть и разобрать по кускам.
          </Empty>
        )}
      </div>
      <div className="ds-home-dock">
        <Button variant="primary" size="large" icon={<Plus aria-hidden="true" />} onClick={() => say({ text: 'Здесь откроется выбор видео из «Фото»' })}>Добавить видео</Button>
      </div>
      <Confirm open={!!asked} title={`Удалить «${asked?.title ?? ''}»?`} text="Видео и правки этого проекта исчезнут с телефона. Вернуть их будет нельзя."
        confirmLabel="Удалить" cancelLabel="Отмена" onCancel={() => setAsked(null)}
        afterClose={() => home.current?.querySelector<HTMLElement>('.ck-project-open') ?? home.current?.querySelector<HTMLElement>('.ds-home-dock button, .ck-empty button')}
        onConfirm={() => { if (asked) { setProjects((list) => list.filter((p) => p.id !== asked.id)); say({ text: `«${asked.title}» удалён` }); } setAsked(null); }} />
      <Sheet open={!!naming} title="Название проекта" closeLabel="Закрыть" closeIcon={<X aria-hidden="true" />} onClose={() => setNaming(null)}>
        <form className="ds-form" onSubmit={(e) => { e.preventDefault(); rename(); }}>
          <Field label="Название" value={name} onChange={setName} maxLength={80} count countLabel={counted} enterKeyHint="done"
            error={name.trim() ? undefined : 'Напишите хотя бы одну букву: по названию проект ищут в списке.'} />
          <Button variant="primary" type="submit" disabled={!name.trim()}>Сохранить</Button>
        </form>
      </Sheet>
      <ToastRegion items={items} onDismiss={dismiss} {...close} />
    </div>
  );
}

// ---- the editor ----
interface Piece { id: string; dur: number; scene?: 'night' | 'mountains' | 'food'; label?: string }
interface Film { main: Piece[]; text: Piece[]; audio: Piece[] }
const PPS = 45; // px per second
const GAP = 4; // px between pieces: --space-1
const FILM: Film = {
  main: [{ id: 'v1', dur: 5, scene: 'mountains' }, { id: 'v2', dur: 3.2, scene: 'food' }, { id: 'v3', dur: 3.8, scene: 'night' }],
  text: [{ id: 't1', dur: 3, label: 'Привет, Алтай' }],
  audio: [{ id: 'a1', dur: 12, label: 'Orchid, lo-fi' }],
};
const laneOf = (f: Film, id: string): keyof Film | null => (f.main.some((p) => p.id === id) ? 'main' : f.text.some((p) => p.id === id) ? 'text' : f.audio.some((p) => p.id === id) ? 'audio' : null);
const total = (f: Film) => f.main.reduce((s, p) => s + p.dur, 0);
/** The piece of the main row under the playhead. */
const pieceAt = (f: Film, t: number) => { let at = 0; for (const p of f.main) { if (t < at + p.dur) return p; at += p.dur; } return f.main.at(-1); };

type ToolDef = [string, LucideIcon, 'delete' | 'split' | 'dup' | null];
const TOOLS: Record<keyof Film | 'project', ToolDef[]> = {
  main: [['Разрезать', Scissors, 'split'], ['Дублировать', Copy, 'dup'], ['Удалить', Trash2, 'delete'], ['Скорость', Gauge, null], ['Громкость', Volume2, null], ['Голос', AudioLines, null], ['Субтитры', Captions, null], ['Кадрировать', Crop, null], ['Фильтры', Blend, null]],
  text: [['Текст', Type, null], ['Трансформация', Move, null], ['Слои', Layers3, null], ['Разрезать', Scissors, 'split'], ['Дублировать', Copy, 'dup'], ['Удалить', Trash2, 'delete']],
  audio: [['Разрезать', Scissors, 'split'], ['Дублировать', Copy, 'dup'], ['Удалить', Trash2, 'delete'], ['Скорость', Gauge, null], ['Громкость', Volume2, null], ['Голос', AudioLines, null], ['Бит', Waves, null]],
  project: [['Рилс в 1 тап', Clapperboard, null], ['Медиа', Film, null], ['Субтитры', Captions, null], ['Текст', Type, null], ['Музыка', Disc3, null], ['Наложение', Layers, null], ['Стикеры', Smile, null], ['Эффекты', Sparkles, null], ['Звук', Music, null], ['Камера', Video, null], ['Запись', Mic, null], ['Холст', Frame, null]],
};

function EditorStage({ plain }: { plain?: boolean }) {
  const [film, setFilm] = useState<Film>(FILM);
  const [past, setPast] = useState<Film[]>([]);
  const [future, setFuture] = useState<Film[]>([]);
  const [sel, setSel] = useState<string | null>(null);
  const [time, setTime] = useState(2.4);
  const [playing, setPlaying] = useState(false);
  const [joins, setJoins] = useState<Set<number>>(new Set());
  const scroller = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const pieceButton = (id: string) => () => stage.current?.querySelector<HTMLElement>(`[data-piece="${id}"] .ck-clip-select`);
  const trim = useRef<{ id: number; edge: 'in' | 'out'; x: number; from: number; base: Film } | null>(null);
  const { items, say, dismiss } = useToasts();
  const dur = total(film);

  const change = (next: Film, base = film) => { setPast((p) => [...p.slice(-30), base]); setFuture([]); setFilm(next); };
  const undo = () => { const last = past.at(-1); if (!last) { say({ text: 'Отменять пока нечего' }); return; } setPast(past.slice(0, -1)); setFuture((f) => [film, ...f]); setFilm(last); };
  const redo = () => { const [first, ...rest] = future; if (!first) return; setFuture(rest); setPast((p) => [...p, film]); setFilm(first); };

  // Time follows the timeline under the playhead, and the timeline follows the time while it plays.
  useEffect(() => { const el = scroller.current; if (el && Math.abs(el.scrollLeft - time * PPS) > 1) el.scrollLeft = time * PPS; }, [time]);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now(), raf = 0;
    const tick = (now: number) => {
      setTime((t) => { const n = Math.min(dur, t + (now - last) / 1000); if (n >= dur) setPlaying(false); return n; });
      last = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, dur]);

  const lane = sel ? laneOf(film, sel) : null;
  const act = (what: ToolDef[2], name: string) => {
    if (!sel || !lane) { say({ text: `«${name}» в галерее только показан` }); return; }
    const pieces = film[lane];
    const at = pieces.findIndex((p) => p.id === sel);
    if (what === 'delete') {
      const base = film, gone = sel, near = pieces[at + 1] ?? pieces[at - 1];
      change({ ...film, [lane]: pieces.filter((p) => p.id !== sel) });
      setSel(null);
      // The ribbon's «Удалить» is gone with the selection: the focus goes to the piece that took its place.
      focusLater(near ? pieceButton(near.id) : () => stage.current?.querySelector<HTMLElement>('.ck-ribbon .ck-tool'));
      say({ text: 'Кусок удалён', action: { label: 'Отменить', run: () => { setFilm(base); setPast((p) => p.slice(0, -1)); focusLater(pieceButton(gone)); } } });
    } else if (what === 'dup') {
      change({ ...film, [lane]: [...pieces.slice(0, at + 1), { ...pieces[at], id: `${sel}d${Date.now()}` }, ...pieces.slice(at + 1)] });
    } else if (what === 'split') {
      const start = lane === 'main' ? pieces.slice(0, at).reduce((s, p) => s + p.dur, 0) : 0;
      const cut = time - start;
      if (cut < 0.3 || cut > pieces[at].dur - 0.3) { say({ text: 'Не разрезано: белая линия не на этом куске. Подведите её к месту разреза.', tone: 'error', icon: <CircleAlert aria-hidden="true" /> }); return; }
      const a = { ...pieces[at], id: `${sel}a`, dur: Math.round(cut * 10) / 10 }, b = { ...pieces[at], id: `${sel}b`, dur: Math.round((pieces[at].dur - cut) * 10) / 10 };
      change({ ...film, [lane]: [...pieces.slice(0, at), a, b, ...pieces.slice(at + 1)] });
      setSel(b.id);
    } else say({ text: `«${name}» в галерее только показан` });
  };

  const setDur = (base: Film, id: string, d: number) => {
    const l = laneOf(base, id)!;
    return { ...base, [l]: base[l].map((p) => (p.id === id ? { ...p, dur: Math.max(0.5, Math.round(d * 10) / 10) } : p)) };
  };
  const handle = (p: Piece, edge: 'in' | 'out', start: number) => ({
    role: 'slider', tabIndex: 0, 'aria-orientation': 'horizontal' as const, 'aria-label': edge === 'in' ? 'Обрезать начало' : 'Обрезать конец',
    'aria-valuemin': 0, 'aria-valuemax': Math.round(dur * 10) / 10, 'aria-valuenow': Math.round((edge === 'in' ? start : start + p.dur) * 10) / 10,
    'aria-valuetext': clock(edge === 'in' ? start : start + p.dur),
    onKeyDown: (e: KeyboardEvent<HTMLSpanElement>) => {
      if (e.key === ' ') e.preventDefault(); // a slider has no use for Space: the page must not scroll from under the finger
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault(); e.stopPropagation();
      const step = (e.shiftKey ? 1 : 0.1) * (e.key === 'ArrowRight' ? 1 : -1);
      change(setDur(film, p.id, p.dur + (edge === 'out' ? step : -step)));
    },
    onPointerDown: (e: PointerEvent<HTMLSpanElement>) => { e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); trim.current = { id: e.pointerId, edge, x: e.clientX, from: p.dur, base: film }; },
    onPointerMove: (e: PointerEvent<HTMLSpanElement>) => {
      const t = trim.current;
      if (!t || t.id !== e.pointerId) return;
      const dx = (e.clientX - t.x) / PPS;
      setFilm(setDur(t.base, p.id, t.from + (t.edge === 'out' ? dx : -dx)));
    },
    onPointerUp: (e: PointerEvent<HTMLSpanElement>) => { const t = trim.current; if (!t || t.id !== e.pointerId) return; trim.current = null; setPast((h) => [...h.slice(-30), t.base]); setFuture([]); },
    onPointerCancel: (e: PointerEvent<HTMLSpanElement>) => { const t = trim.current; if (!t || t.id !== e.pointerId) return; trim.current = null; setFilm(t.base); },
  });
  const clips = (key: keyof Film) => {
    let start = 0;
    return film[key].map((p) => {
      const s = key === 'main' ? start : 0;
      start += p.dur;
      const selected = p.id === sel;
      return (
        <Clip key={p.id} data-piece={p.id} kind={key === 'main' ? 'video' : key === 'text' ? 'text' : 'audio'} width={Math.max(8, p.dur * PPS - GAP)} selected={selected}
          name={`${p.label ?? 'Видео'}, ${String(p.dur).replace('.', ',')} с`} onSelect={() => setSel(selected ? null : p.id)}
          label={key === 'main' ? undefined : p.label} icon={key === 'text' ? <Type aria-hidden="true" /> : key === 'audio' ? <Music aria-hidden="true" /> : undefined}
          startHandle={handle(p, 'in', s)} endHandle={handle(p, 'out', s)}>
          {key === 'main' && Array.from({ length: Math.max(1, Math.ceil(p.dur * PPS / 40)) }, (_, i) => <span key={i} className="ds-frame"><Shot scene={p.scene} /></span>)}
          {key === 'audio' && <Wave peaks={PEAKS} />}
        </Clip>
      );
    });
  };
  let edge = 0;
  const bounds = film.main.slice(0, -1).map((p) => (edge += p.dur));
  const textOn = lane === 'text';

  return (
    <div className="ds-stage ds-editor" data-testid="editor" data-tracks={plain ? 'plain' : 'colour'} lang="ru" ref={stage}>
      <div className="ds-preview">
        <div className="ds-shot">
          <Shot scene={pieceAt(film, time)?.scene ?? 'night'} />
          {film.text.length > 0 && time < film.text[0].dur && <span className="ds-caption">{film.text[0].label}</span>}
          {textOn && <ObjectFrame box={{ x: '10%', y: '38%', w: '80%', h: '10%' }} guides={{ x: true }} />}
        </div>
      </div>
      <Transport playing={playing} onPlay={() => { if (!playing && time >= dur - 0.05) setTime(0); setPlaying(!playing); }} playLabel="Воспроизвести" pauseLabel="Пауза"
        playIcon={<Play aria-hidden="true" />} pauseIcon={<Pause aria-hidden="true" />} time={clock(time)} total={clock(dur, false)}
        start={<><IconButton label="Отменить" onClick={undo}><Undo2 aria-hidden="true" /></IconButton><IconButton label="Повторить" disabled={!future.length} onClick={redo}><Redo2 aria-hidden="true" /></IconButton></>} />
      <div className="ds-tl-wrap">
        <div className="ds-tl" ref={scroller} onScroll={(e) => { if (!playing) setTime(Math.min(dur, e.currentTarget.scrollLeft / PPS)); }}>
          <div className="ds-tl-in">
            <Ruler duration={dur} pxPerSecond={PPS} format={rulerClock} visible={[Math.floor(time) - 6, Math.ceil(time) + 6]} />
            <Lane main>
              {clips('main')}
              {lane !== 'main' && bounds.map((b, i) => (
                <Join key={i} label={joins.has(i) ? 'Переход: плавный' : 'Добавить переход'} on={joins.has(i)} icon={<Blend aria-hidden="true" />} style={{ left: b * PPS - GAP / 2 }}
                  onClick={() => { setJoins((s) => { const n = new Set(s); if (n.has(i)) n.delete(i); else n.add(i); return n; }); say({ text: joins.has(i) ? 'Переход убран' : 'Переход: плавный' }); }} />
              ))}
            </Lane>
            <Lane>{clips('text')}</Lane>
            <Lane>{clips('audio')}</Lane>
          </div>
        </div>
        <Playhead />
      </div>
      <Ribbon label="Инструменты" start={sel ? <Tool icon={<X aria-hidden="true" />} label="Назад" onClick={() => setSel(null)} /> : undefined}>
        {TOOLS[lane ?? 'project'].map(([name, Icon, what]) => <Tool key={name} icon={<Icon aria-hidden="true" />} label={name} danger={what === 'delete'} onClick={() => act(what, name)} />)}
      </Ribbon>
      <ToastRegion items={items} onDismiss={dismiss} {...close} />
    </div>
  );
}
const rulerClock = (s: number) => clock(s, false);

export function DsParts() {
  const [tracks, setTracks] = useState('colour');
  const [format, setFormat] = useState('9:16');
  const [look, setLook] = useState('none');
  const [title, setTitle] = useState('Поход на Алтай');
  const [words, setWords] = useState('');
  const LOOKS = [['none', 'Нет', ''], ['warm', 'Тёплый', 'sepia(.35) saturate(1.3)'], ['cold', 'Холодный', 'hue-rotate(-18deg) saturate(.8)'], ['film', 'Плёнка', 'contrast(1.15) saturate(.7)'], ['noir', 'Нуар', 'grayscale(1) contrast(1.3)'], ['dream', 'Мечта', 'brightness(1.15) saturate(.6)']];
  return (
    <>
      <section>
        <h2>Выбор одного</h2>
        <p className="ds-dim">Слова — сегментами, виды — плитками на кадре человека. Выбранное обведено белым или лежит между двумя метками. Стрелки переносят выбор.</p>
        <Segments label="Формат кадра" items={['9:16', '16:9', '1:1', '4:5', '3:4'].map((id) => ({ id, label: id }))} value={format} onChange={setFormat} />
        <Tiles label="Фильтр" value={look} onChange={setLook} items={LOOKS.map(([id, label, css]) => ({ id, label, art: <Shot scene="mountains" look={css || undefined} /> }))} />
      </section>

      <section>
        <h2>Поле ввода</h2>
        <p className="ds-dim">Текст 16 px: Safari не приближает страницу. Ошибка видна по рамке и словам, красный остаётся за удалением.</p>
        <Field label="Название проекта" value={title} onChange={setTitle} maxLength={80} count countLabel={counted} />
        <Field label="Текст на кадре" value={words} onChange={setWords} multiline rows={2} placeholder="Например, «Смотри до конца»" hint="Перенос строки — так же, как в сообщении." />
        <Field label="Название, пустое" value="" onChange={() => undefined} error="Напишите хотя бы одну букву: по названию проект ищут в списке." />
      </section>

      <section>
        <h2>Главная в сборе</h2>
        <p className="ds-dim">Проекты первыми и все, действия на виду. Удаление спрашивает один раз и честно говорит, что вернуть нельзя. Удалите все — появится пустой экран.</p>
        <HomeStage />
      </section>

      <section>
        <h2>Редактор в сборе</h2>
        <p className="ds-dim">Листайте таймлайн, нажмите кусок: его держат две метки, их можно тянуть или вести стрелками. Разрежьте по белой линии, удалите и отмените из уведомления.</p>
        <Segments label="Дорожки" items={[{ id: 'colour', label: 'Приглушённый цвет' }, { id: 'plain', label: 'Без цвета' }]} value={tracks} onChange={setTracks} />
        <EditorStage plain={tracks === 'plain'} />
      </section>
    </>
  );
}
