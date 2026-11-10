// Chetko components of the editor (DESIGN.md §5): the transport under the frame, the timeline and the box around an
// object on the frame. They draw; the editor owns the gestures and the project, and passes in roles, keys and handlers,
// so the trim handles stay sliders for the keyboard and for a screen reader as they are today.
import { memo, useMemo, useRef, type CSSProperties, type HTMLAttributes, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { rulerMarks } from '../../core/ruler';

// ---- the transport ----
interface TransportProps {
  playing: boolean;
  onPlay: () => void;
  playLabel: string;
  pauseLabel: string;
  playIcon: ReactNode;
  pauseIcon: ReactNode;
  /** «0:02,4» and «0:42». */
  time: string;
  total: string;
  /** Undo and redo, where the screen puts them. */
  start?: ReactNode;
  /** Between play and the time: the strip of the whole film while a value is set. */
  middle?: ReactNode;
  /** After the time, at the right edge: a switch of what the frame shows (safe zones). */
  end?: ReactNode;
  /** Nothing to play yet, or the project is locked by a long job. */
  disabled?: boolean;
  /** Extra class names for the row, the play button and the time: hooks that tests and the iPhone scripts rely on. */
  hooks?: { row?: string; play?: string; time?: string };
}
export function Transport({ playing, onPlay, playLabel, pauseLabel, playIcon, pauseIcon, time, total, start, middle, end, disabled, hooks }: TransportProps) {
  const with_ = (base: string, hook?: string) => (hook ? `${base} ${hook}` : base);
  return (
    <div className={hooks?.row ? `ck ck-transport ${hooks.row}` : 'ck-transport'}>
      {start}
      <button type="button" className={with_('ck-play', hooks?.play)} aria-label={playing ? pauseLabel : playLabel} onClick={onPlay} disabled={disabled}><span>{playing ? pauseIcon : playIcon}</span></button>
      <div className="ck-transport-mid">{middle}</div>
      <span className={with_('ck-time', hooks?.time)}><b>{time}</b> / {total}</span>
      {end}
    </div>
  );
}

interface MiniStripProps {
  label: string;
  /** 0 … 1: where the playhead is in the whole film. */
  value: number;
  /** The position as words for a screen reader: «0:02,4 из 0:42». */
  valueText: string;
  onSeek: (fraction: number) => void;
  /** Frames of the film, side by side. */
  children: ReactNode;
}
/** The whole film in one strip: tap or drag to go anywhere; arrows by 1%, Page keys by 10%. */
export function MiniStrip({ label, value, valueText, onSeek, children }: MiniStripProps) {
  const id = useRef<number | null>(null);
  const seek = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    onSeek(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)));
  };
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const d = { ArrowRight: 0.01, ArrowUp: 0.01, ArrowLeft: -0.01, ArrowDown: -0.01, PageUp: 0.1, PageDown: -0.1 }[e.key];
    const to = e.key === 'Home' ? 0 : e.key === 'End' ? 1 : d === undefined ? null : Math.min(1, Math.max(0, value + d));
    if (to === null) return;
    e.preventDefault();
    onSeek(to);
  };
  return (
    <div className="ck-mini" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 100)} aria-valuetext={valueText}
      onPointerDown={(e) => { if (id.current !== null) return; id.current = e.pointerId; e.currentTarget.setPointerCapture(e.pointerId); seek(e); }}
      onPointerMove={(e) => { if (e.pointerId === id.current) seek(e); }}
      onPointerUp={(e) => { if (e.pointerId === id.current) id.current = null; }} onPointerCancel={(e) => { if (e.pointerId === id.current) id.current = null; }}
      onKeyDown={key}>
      <div className="ck-mini-film" aria-hidden="true">{children}</div>
      <i className="ck-mini-head" style={{ left: `${value * 100}%` }} />
    </div>
  );
}

// ---- the timeline ----
interface RulerProps {
  duration: number;
  pxPerSecond: number;
  /** Keep it the same function between renders: the ruler is not drawn again while the film plays. */
  format: (seconds: number) => string;
  /** Seconds in sight, with a margin: only these marks are drawn (a long film has thousands). Rounded by the caller,
   *  so it changes a few times a second at most. */
  visible?: [number, number];
}
/** Numbers at least 64 px apart, short ticks between them where they stay apart (core/ruler.ts). */
export const Ruler = memo(function Ruler({ duration, pxPerSecond, format, visible }: RulerProps) {
  const marks = useMemo(() => rulerMarks(duration, pxPerSecond), [duration, pxPerSecond]);
  const [from, to] = visible ?? [0, duration];
  return (
    <div className="ck-ruler" aria-hidden="true" style={{ width: duration * pxPerSecond }}>
      {marks.filter((m) => m.at >= from && m.at <= to).map((m) => m.major
        ? <span key={m.at} className="ck-ruler-num" style={{ left: m.at * pxPerSecond }}>{format(m.at)}</span>
        : <i key={m.at} className="ck-ruler-tick" style={{ left: m.at * pxPerSecond }} />)}
    </div>
  );
});

/** A row of pieces. The main row is taller: its pieces carry frames, and the marks of a held piece stand out of it. */
export function Lane({ main, children }: { main?: boolean; children: ReactNode }) {
  return <div className="ck-lane" data-main={main || undefined}>{children}</div>;
}

interface ClipProps extends HTMLAttributes<HTMLDivElement> {
  kind: 'video' | 'image' | 'audio' | 'text' | 'caption';
  /** px on the timeline. */
  width: number;
  /** What a screen reader says for the piece: «Видео, 5 с». */
  name: string;
  onSelect: () => void;
  /** Selected: held between two marks, which are the trim handles. */
  selected?: boolean;
  /** On a sound or a text: what it is, shown on the piece. A video shows its frames instead. */
  label?: string;
  icon?: ReactNode;
  /** Roles, names, keys and pointer handlers of the trim handles (sliders), from the timeline. They stand beside the button
   *  that selects the piece, not inside it: a screen reader does not see controls inside a button, and a key or a lifted
   *  finger on a handle never reaches the button and never drops the selection. */
  startHandle?: HTMLAttributes<HTMLSpanElement>;
  endHandle?: HTMLAttributes<HTMLSpanElement>;
  /** Frames, a waveform. */
  children?: ReactNode;
}
export function Clip({ kind, width, name, onSelect, selected, label, icon, startHandle, endHandle, children, style, ...rest }: ClipProps) {
  return (
    <div className="ck-clip" role="group" aria-label={name} data-kind={kind} data-selected={selected || undefined} style={{ ...style, width, '--clip-w': `${width}px` } as CSSProperties} {...rest}>
      {/* The whole height of the row selects: 44 px even where the piece is drawn 32 px tall. */}
      <button type="button" className="ck-clip-select" aria-label={name} aria-pressed={!!selected} onClick={onSelect} />
      <div className="ck-clip-body">
        <div className="ck-clip-fill" aria-hidden="true">
          {children}
          {(label || icon) && <span className="ck-clip-label">{icon}{label}</span>}
        </div>
        {selected && <>
          <span className="ck-handle ck-in" {...startHandle} />
          <span className="ck-handle ck-out" {...endHandle} />
        </>}
      </div>
    </div>
  );
}

/** The sound of a piece as bars, from peaks 0 … 1. */
export function Wave({ peaks }: { peaks: number[] }) {
  return (
    <svg className="ck-wave" viewBox={`0 0 ${peaks.length * 3} 20`} preserveAspectRatio="none" aria-hidden="true">
      {peaks.map((p, i) => { const h = Math.max(1, p * 20); return <rect key={i} x={i * 3} y={(20 - h) / 2} width="2" height={h} />; })}
    </svg>
  );
}

/** Where the film is now: a white line with the head of a mark. It stands still; the timeline moves under it. */
export function Playhead() {
  return <i className="ck-playhead" aria-hidden="true" />;
}

interface JoinProps { label: string; icon: ReactNode; onClick: () => void; style?: CSSProperties; on?: boolean }
/** The button between two pieces (a transition): small to the eye, 44 px to the finger. It sits on the upper edge of the
 *  row, its hit area mostly over the ruler, so the pieces stay selectable to their ends. Place it at the seam (`left`). */
export function Join({ label, icon, onClick, style, on }: JoinProps) {
  return <button type="button" className="ck-join" data-on={on || undefined} aria-label={label} style={style} onClick={onClick}><span>{icon}</span></button>;
}

// ---- on the frame ----
interface ObjectFrameProps {
  /** Inside the frame: px, or % of the frame. */
  box: { x: number | string; y: number | string; w: number | string; h: number | string; rotate?: number };
  /** The object is snapped to the middle of the frame across or along. */
  guides?: { x?: boolean; y?: boolean };
  /** The corner that resizes and turns, pointer only: the «Трансформация» sheet does the same with the keyboard. */
  handle?: HTMLAttributes<HTMLSpanElement>;
}
/** The box around a selected text or picture on the frame: white with a dark edge, readable on any video. */
export function ObjectFrame({ box, guides, handle }: ObjectFrameProps) {
  return (
    <div className="ck-frame-layer" aria-hidden="true">
      {guides?.x && <i className="ck-guide ck-v" />}
      {guides?.y && <i className="ck-guide ck-h" />}
      <div className="ck-object" style={{ left: box.x, top: box.y, width: box.w, height: box.h, rotate: `${box.rotate ?? 0}deg` }}>
        <span className="ck-object-handle" {...handle} />
      </div>
    </div>
  );
}
