// Center-playhead timeline (mobile editor convention): scrolling the timeline scrubs the video.
// Touch: tap selects, long-press drags, handles trim, pinch zooms. Mouse: drag moves, ctrl+wheel zooms.
import { AudioLines, Blend, Captions, Check, Plus, Type, VolumeX } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import {
  clipBeatTimes, clipEnd, findClip, mainTrack, moveClip, moveClipsBy, projectDuration, reorderMain, soundAssetId, trimClip,
} from '../core/timeline';
import type { Asset, Clip, Project, Track, TrackKind, TransitionType } from '../core/types';
import { TRANSITION_LABELS } from './transitionNames';
import { PEAKS_PER_SEC, thumbnails, waveform, type Thumb } from '../engine/media';
import { player } from '../engine/player';
import { useEditor } from '../state/store';
import { addMedia } from './actions';
import { formatTime } from './format';
import { t } from '../lib/i18n';
// Chetko, stage Ч4 release 4 (docs/17): the look and the touch sizes of the system; the gestures stay as they were.
import './ck/ck.css';
import './timeline.css';
import { Join, Playhead, Ruler as Scale } from './ck/timeline';

/** A row is its pieces' height to a finger: 44 px (audit UI-9: 34 before), the main row 56. A piece is drawn 6 px in from
 *  top and bottom, where the marks of a held piece stand out (`--mark-overhang`). */
const ROW_H: Record<TrackKind, number> = { main: 56, overlay: 44, audio: 44 };
const INSET = 6;
const LONG_PRESS_MS = 300;

/** A tap picks the clip in multi-select mode, otherwise selects it. */
function tapClip(id: string): void {
  const s = useEditor.getState();
  if (s.multi) s.toggleMulti(id);
  else s.select(id);
}

/** The playhead for the keyboard and screen readers. Its own component: the time changes every frame, the timeline must not redraw with it. */
function Position({ duration, fps }: { duration: number; fps: number }) {
  const time = useEditor((s) => s.time);
  return (
    <input
      className="tl-position ck-tl-position" type="range" aria-label={t('Position in the video')} min={0} max={duration} step={1 / fps} value={time}
      aria-valuetext={formatTime(time, false)}
      onChange={(e) => { player.pause(); player.seek(Number(e.target.value)); useEditor.setState({ time: player.time }); }}
    />
  );
}

/** What a screen reader says for a clip. */
function clipLabel(c: Clip, p: Project): string {
  const name = c.kind === 'text' ? c.text : c.kind === 'caption' ? t('Captions') : p.assets[c.kind === 'audio' ? soundAssetId(c) : c.assetId]?.name ?? '';
  return t('{name}, {s} s', { name, s: c.duration.toFixed(1) });
}

/** A trim handle for the keyboard and for screen readers: the arrows move it by a frame, with Shift by a second. */
function trimHandle(c: Clip, edge: 'start' | 'end', p: Project) {
  const at = edge === 'start' ? c.start : clipEnd(c);
  return {
    role: 'slider', tabIndex: 0, 'aria-orientation': 'horizontal' as const,
    'aria-valuemin': 0, 'aria-valuemax': Math.round(projectDuration(p) * 100) / 100, 'aria-valuenow': Math.round(at * 100) / 100,
    'aria-valuetext': formatTime(at, false),
    onKeyDown: (e: KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      e.stopPropagation(); // the editor's arrows move the playhead
      const step = e.shiftKey ? 1 : 1 / p.settings.fps;
      useEditor.getState().commit((d) => trimClip(d, c.id, edge, at + (e.key === 'ArrowLeft' ? -step : step)));
    },
  };
}
const SNAP_PX = 10;
/** Auto-scroll while dragging: a finger this close to a timeline edge scrolls it, faster towards the edge. */
const EDGE_PX = 56;
const EDGE_SPEED = 15; // px per frame at the very edge (≈ 900 px/s)

/** `s0` is the timeline's scrollLeft when the drag began: offsets add the auto-scroll, so the clip stays under the finger. */
type Drag =
  | { mode: 'trim'; id: string; edge: 'start' | 'end'; x0: number; s0: number; t0: number; base: Project }
  | { mode: 'move'; id: string; x0: number; y0: number; s0: number; dx: number; dy: number; main: boolean; base: Project };

interface Press { id: string; x: number; y: number; pointerId: number; touch: boolean; main: boolean; timer: number }

export function Timeline() {
  const project = useEditor((s) => s.project)!;
  const zoom = useEditor((s) => s.zoom);
  const selection = useEditor((s) => s.selection);
  const multi = useEditor((s) => s.multi);
  const scroller = useRef<HTMLDivElement>(null);
  const [vw, setVw] = useState(0);
  const [drag, setDragState] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const press = useRef<Press | null>(null);
  const ignoreScroll = useRef(Number.NaN);
  const duration = projectDuration(project);
  const pad = vw / 2;
  const live = useRef({ zoom, pad });
  live.current = { zoom, pad };

  const setDrag = (d: Drag | null) => { dragRef.current = d; setDragState(d); };

  useLayoutEffect(() => {
    const el = scroller.current!;
    const ro = new ResizeObserver(() => setVw(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Time → scroll position (playback, seeks from elsewhere, zoom changes).
  useLayoutEffect(() => {
    const el = scroller.current!;
    const apply = (t: number) => {
      const x = t * zoom;
      if (Math.abs(el.scrollLeft - x) > 0.5) { ignoreScroll.current = x; el.scrollLeft = x; }
    };
    apply(useEditor.getState().time);
    return useEditor.subscribe((s, prev) => { if (s.time !== prev.time) apply(s.time); });
  }, [zoom, vw, duration]);

  // Scroll position → time (user scrubbing).
  const onScroll = () => {
    const el = scroller.current!;
    // Hidden behind an open sheet (display: none) the browser resets scrollLeft to 0; that is not a scrub.
    // Used to throw the playhead back to 0:00 after every export. Showing the timeline again re-applies the time.
    if (!el.clientWidth) return;
    if (Math.abs(el.scrollLeft - ignoreScroll.current) < 1.5) return;
    ignoreScroll.current = Number.NaN;
    const t = Math.min(duration, Math.max(0, el.scrollLeft / zoom));
    if (player.playing) player.pause();
    if (dragRef.current?.mode !== 'trim') player.seek(t); // while trimming, the preview shows the trimmed edge
    useEditor.setState({ time: t });
  };

  // Pinch / ctrl+wheel zoom, and blocking native scroll while dragging clips.
  useEffect(() => {
    const el = scroller.current!;
    let d0 = 0, z0 = 0;
    const dist = (e: TouchEvent) => Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
    const start = (e: TouchEvent) => { if (e.touches.length === 2) { d0 = dist(e); z0 = useEditor.getState().zoom; } };
    const move = (e: TouchEvent) => {
      if (dragRef.current) { e.preventDefault(); return; }
      if (e.touches.length === 2 && d0) { e.preventDefault(); useEditor.getState().setZoom((z0 * dist(e)) / d0); }
    };
    const end = (e: TouchEvent) => { if (e.touches.length < 2) d0 = 0; };
    const wheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useEditor.getState();
      s.setZoom(s.zoom * Math.exp(-e.deltaY * 0.01));
    };
    el.addEventListener('touchstart', start, { passive: true });
    el.addEventListener('touchmove', move, { passive: false });
    el.addEventListener('touchend', end, { passive: true });
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('touchstart', start);
      el.removeEventListener('touchmove', move);
      el.removeEventListener('touchend', end);
      el.removeEventListener('wheel', wheel);
    };
  }, []);

  // Drag handling on window, so it keeps working outside the clip element.
  useEffect(() => {
    const timeAt = (clientX: number) => {
      const el = scroller.current!;
      return (clientX - el.getBoundingClientRect().left + el.scrollLeft - live.current.pad) / live.current.zoom;
    };
    const snap = (t: number, id: string, p: Project) => {
      const pts = [0, useEditor.getState().time];
      for (const tr of p.tracks) for (const c of tr.clips) {
        if (c.id !== id) pts.push(c.start, clipEnd(c));
        if (c.kind === 'audio') pts.push(...clipBeatTimes(p, c));
      }
      let best = t, bestD = SNAP_PX / live.current.zoom;
      for (const x of pts) if (Math.abs(x - t) < bestD) { best = x; bestD = Math.abs(x - t); }
      return best;
    };
    const finishMove = (d: Extract<Drag, { mode: 'move' }>, e: PointerEvent) => {
      const s = useEditor.getState();
      const f = findClip(d.base, d.id);
      if (!f) return;
      if (Math.hypot(d.dx, d.dy) < 3) { tapClip(d.id); return; }
      if (d.main) {
        const t = timeAt(e.clientX);
        const others = mainTrack(d.base).clips.filter((c) => c.id !== d.id);
        const idx = others.findIndex((c) => c.start + c.duration / 2 > t);
        s.commit((dr) => reorderMain(dr, d.id, idx < 0 ? others.length : idx));
      } else {
        const start = Math.max(0, snap(f.clip.start + d.dx / live.current.zoom, d.id, d.base));
        const row = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-track]');
        const trackId = row?.dataset.kind === f.track.kind ? row.dataset.track : f.track.id;
        // In multi-select, dragging one picked clip moves all picked free clips by the same amount.
        if (s.multi?.includes(d.id)) s.commit((dr) => moveClipsBy(dr, s.multi!, start - f.clip.start));
        else s.commit((dr) => moveClip(dr, d.id, start, trackId));
      }
    };
    const last = { x: 0, y: 0 };
    let raf = 0;
    /** Applies the active drag for a finger at (x, y), including how far the timeline auto-scrolled since it began. */
    const update = (x: number, y: number) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = x - d.x0 + (scroller.current!.scrollLeft - d.s0);
      if (d.mode === 'trim') {
        const t = snap(d.t0 + dx / live.current.zoom, d.id, d.base);
        const s = useEditor.getState();
        s.commit((dr) => trimClip(dr, d.id, d.edge, t), `trim:${d.id}`, d.base);
        // CapCut-style: the preview shows the frame at the edge being trimmed, not the one under the playhead.
        const f = findClip(useEditor.getState().project!, d.id);
        if (f) player.seek(d.edge === 'start' ? f.clip.start + 1e-3 : Math.max(f.clip.start, clipEnd(f.clip) - 1 / 30));
      } else {
        setDrag({ ...d, dx, dy: y - d.y0 });
      }
    };
    /** Near an edge the timeline scrolls by itself (only during a drag), and the dragged item follows. */
    const autoScroll = () => {
      raf = 0;
      const d = dragRef.current;
      if (!d) return;
      const el = scroller.current!, r = el.getBoundingClientRect();
      // Not before the finger has actually moved: a drag that starts near an edge must not run away on its own.
      const v = Math.abs(last.x - d.x0) < 12 ? 0 : last.x < r.left + EDGE_PX ? -(r.left + EDGE_PX - last.x) / EDGE_PX : last.x > r.right - EDGE_PX ? (last.x - (r.right - EDGE_PX)) / EDGE_PX : 0;
      if (v) {
        const before = el.scrollLeft;
        el.scrollLeft += Math.max(-1, Math.min(1, v)) * EDGE_SPEED;
        if (el.scrollLeft !== before) update(last.x, last.y);
      }
      raf = requestAnimationFrame(autoScroll);
    };
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d) {
        last.x = e.clientX;
        last.y = e.clientY;
        update(e.clientX, e.clientY);
        if (!raf) raf = requestAnimationFrame(autoScroll);
        return;
      }
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (!p.touch && moved > 4) {
        clearTimeout(p.timer);
        press.current = null;
        setDrag({ mode: 'move', id: p.id, x0: p.x, y0: p.y, s0: scroller.current!.scrollLeft, dx: 0, dy: 0, main: p.main, base: useEditor.getState().project! });
      } else if (p.touch && moved > 8) {
        clearTimeout(p.timer); // it is a scroll, not a press
        press.current = null;
      }
    };
    const onUp = (e: PointerEvent) => {
      const p = press.current, d = dragRef.current;
      if (p) clearTimeout(p.timer);
      press.current = null;
      if (d) {
        setDrag(null);
        cancelAnimationFrame(raf);
        raf = 0;
        if (d.mode === 'move' && e.type === 'pointerup') finishMove(d, e);
        if (d.mode === 'trim') settleTrim(d);
        return;
      }
      if (p && e.type === 'pointerup' && p.pointerId === e.pointerId) tapClip(p.id);
    };
    /**
     * After a trim the playhead stands on the cut (v1.6, the owner: "the playhead does not come back to the cut; it moves
     * by as much as was trimmed, 5 s, 10 s"): on the clip's new start or end, where the preview was while trimming. Before,
     * it kept its place in time (or, trimming the start of a main clip, its picture), and the cut ended up seconds away.
     * A touch on a handle that trimmed nothing leaves the playhead alone.
     */
    const settleTrim = (d: Extract<Drag, { mode: 'trim' }>) => {
      const s = useEditor.getState();
      const before = findClip(d.base, d.id)?.clip, now = s.project && findClip(s.project, d.id)?.clip;
      if (!before || !now || (now.start === before.start && now.duration === before.duration)) { player.seek(s.time); return; }
      const at = Math.min(projectDuration(s.project!), Math.max(0, d.edge === 'start' ? now.start : clipEnd(now)));
      player.seek(at);
      useEditor.setState({ time: at });
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onClipDown = (e: RPointerEvent, c: Clip, track: Track) => {
    if (e.button !== 0) return;
    // A second finger is a pinch, not a press: the first must not turn into a drag under it (audit V-106).
    if (press.current && press.current.pointerId !== e.pointerId) {
      clearTimeout(press.current.timer);
      press.current = null;
      return;
    }
    if (player.playing) player.pause();
    const p: Press = { id: c.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== 'mouse', main: track.kind === 'main', timer: 0 };
    if (p.touch) {
      p.timer = window.setTimeout(() => {
        if (press.current !== p) return;
        press.current = null;
        navigator.vibrate?.(8);
        if (!useEditor.getState().multi) useEditor.getState().select(c.id);
        setDrag({ mode: 'move', id: c.id, x0: p.x, y0: p.y, s0: scroller.current!.scrollLeft, dx: 0, dy: 0, main: p.main, base: useEditor.getState().project! });
      }, LONG_PRESS_MS);
    }
    press.current = p;
  };

  const onTrimDown = (e: RPointerEvent, c: Clip, edge: 'start' | 'end') => {
    e.stopPropagation();
    if (player.playing) player.pause();
    setDrag({ mode: 'trim', id: c.id, edge, x0: e.clientX, s0: scroller.current!.scrollLeft, t0: edge === 'start' ? c.start : clipEnd(c), base: useEditor.getState().project! });
  };

  const x = (t: number) => pad + t * zoom;
  // Trimming the start of a main-track clip: the magnetic track already closed the gap in the model, so the clip and
  // everything after it are drawn shifted back by the trimmed amount until release. The left edge follows the finger
  // and the right edge stays put (it used to be the other way round, which read as "trimming the left trims the right").
  let shiftFrom = -1, shiftPx = 0;
  if (drag?.mode === 'trim' && drag.edge === 'start') {
    const before = findClip(drag.base, drag.id), now = findClip(project, drag.id);
    if (before && now && now.track.kind === 'main') { shiftFrom = now.index; shiftPx = (before.clip.duration - now.clip.duration) * zoom; }
  }
  const shifted = (track: Track, i: number) => (track.kind === 'main' && shiftFrom >= 0 && i >= shiftFrom ? shiftPx : 0);
  const overlays = project.tracks.filter((t) => t.kind === 'overlay').reverse();
  const main = mainTrack(project);
  const audios = project.tracks.filter((t) => t.kind === 'audio');

  const row = (track: Track) => (
    <div key={track.id} className={`tl-row ${track.kind} ck-tl-row`} style={{ height: ROW_H[track.kind] }} data-track={track.id} data-kind={track.kind}>
      {track.clips.map((c, i) => {
        const moving = drag?.mode === 'move' && drag.id === c.id;
        // Held: one piece, with its trim handles. Among several (multi), every piece is a switch, picked or not, with no handles.
        const held = c.id === selection && !multi;
        const shift = shifted(track, i);
        return (
          <div
            key={c.id}
            className={`clip clip-${c.kind} ck-tl-clip ${c.id === selection && !multi ? 'sel' : ''} ${multi?.includes(c.id) ? 'picked' : ''} ${moving ? 'dragging' : ''}`}
            data-kind={c.kind} data-selected={(c.id === selection && !multi) || undefined} data-picked={multi?.includes(c.id) || undefined} data-dragging={moving || undefined}
            style={{ left: x(c.start) + shift, width: Math.max(2, c.duration * zoom), transform: moving ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined, '--clip-w': `${Math.max(2, c.duration * zoom)}px` } as CSSProperties}
            onPointerDown={(e) => onClipDown(e, c, track)}
            data-clip={c.id}
            // A chosen clip holds its two trim handles, and a button cannot hold other controls.
            role={held ? 'group' : 'button'}
            tabIndex={0}
            aria-label={clipLabel(c, project)}
            // Among several, a picked piece says so (its check is drawn for the eye only).
            aria-pressed={held ? undefined : !!multi?.includes(c.id)}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); tapClip(c.id); } }}
          >
            <div className="ck-tl-body">
              <div className="ck-tl-fill">
                <ClipFace clip={c} asset={'assetId' in c ? project.assets[c.kind === 'audio' ? soundAssetId(c) : c.assetId] : undefined} zoom={zoom} height={ROW_H[track.kind] - 2 * INSET} />
                {c.kind === 'audio' && clipBeatTimes(project, c).map((b, i) => <i key={i} className="beat ck-tl-beat" style={{ left: (b - c.start) * zoom }} />)}
                {multi?.includes(c.id) && <span className="ck-tl-picked" aria-hidden><Check /></span>}
              </div>
              {/* The two marks of the held piece are its trim handles: 8 px to the eye, 44 px to a finger, half outside. */}
              {held && !moving && (
                <>
                  <div className="handle l ck-handle ck-in" onPointerDown={(e) => onTrimDown(e, c, 'start')} {...trimHandle(c, 'start', project)} aria-label={t('Trim start')} />
                  <div className="handle r ck-handle ck-out" onPointerDown={(e) => onTrimDown(e, c, 'end')} {...trimHandle(c, 'end', project)} aria-label={t('Trim end')} />
                </>
              )}
            </div>
          </div>
        );
      })}
      {/* Cut buttons sit on clip edges; while a clip is selected its edges belong to the trim handles. */}
      {track.kind === 'main' && track.clips.slice(1).map((c, i) => (selection === c.id || selection === track.clips[i].id) ? null : (
        <Join key={`tr-${c.id}`} label={joinName(i + 1, 'transitionIn' in c ? c.transitionIn?.type : undefined)} icon={<Blend aria-hidden />} on={'transitionIn' in c && !!c.transitionIn}
          style={{ left: x(c.start + ('transitionIn' in c && c.transitionIn ? c.transitionIn.duration / 2 : 0)) + shifted(track, i + 1) }}
          onClick={() => useEditor.getState().openSheet('transition', c.id)} />
      ))}
      {track.kind === 'main' && (
        <button type="button" className="add-btn ck-tl-add" data-wide={track.clips.length ? undefined : true} style={{ left: track.clips.length ? x(clipEnd(track.clips.at(-1)!)) + 8 : pad + 8 }}
          onClick={() => void addMedia('main')} aria-label={track.clips.length ? t('Add media') : undefined /* with words on it, the words are its name */}>
          <Plus aria-hidden />{!track.clips.length && <span>{t('Add video or photo')}</span>}
        </button>
      )}
    </div>
  );

  return (
    <div className="timeline ck-tl">
      <Position duration={duration} fps={project.settings.fps} />
      <div
        className="tl-scroll ck-tl-scroll" ref={scroller} onScroll={onScroll}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('.clip, button')) useEditor.getState().select(null); }}
      >
        {/* While dragging, extra room past the end lets a clip be carried (and auto-scrolled) beyond the last one. */}
        {/* While dragging, as wide as before: a project getting shorter under the finger must not make the browser clamp the scroll (the drag would read that as auto-scroll). */}
        <div className="tl-content ck-tl-content" style={{ width: (drag ? Math.max(duration, projectDuration(drag.base)) : duration) * zoom + vw + (drag ? vw / 2 : 0) }}>
          <Ruler duration={duration} zoom={zoom} pad={pad} span={vw / Math.max(1, zoom)} />
          {overlays.map(row)}
          {row(main)}
          {audios.map(row)}
        </div>
      </div>
      <Playhead hook="playhead" />
    </div>
  );
}

const rulerClock = (s: number) => formatTime(s, false);
/** «Переход 1–2: Растворение»: which seam, and what is on it. */
const joinName = (seam: number, type: TransitionType | undefined) =>
  t('Transition {a}–{b}', { a: seam, b: seam + 1 }) + (type ? `: ${t(TRANSITION_LABELS[type])}` : '');
/** How many seconds of film one redraw of the ruler covers around the playhead: it is drawn anew a few times a minute
 *  while the film plays, not on every frame, and never for the thousands of marks of a long film. */
const RULER_CHUNK = 4;

/** The ruler of the system (core/ruler.ts: numbers 64 px apart, short ticks between), the part that is in sight. */
function Ruler({ duration, zoom, pad, span }: { duration: number; zoom: number; pad: number; span: number }) {
  const chunk = useEditor((s) => Math.floor(s.time / RULER_CHUNK));
  const around = span + RULER_CHUNK;
  return (
    <div style={{ paddingLeft: pad }}>
      <Scale duration={duration} pxPerSecond={zoom} format={rulerClock} visible={[chunk * RULER_CHUNK - around, chunk * RULER_CHUNK + around]} />
    </div>
  );
}

/** How long a clip's width must stay put before its strip is drawn anew. */
const REDRAW_MS = 120;

const ClipFace = memo(function ClipFace({ clip, asset, zoom, height }: { clip: Clip; asset?: Asset; zoom: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = clip.duration * zoom;
  const srcIn = 'in' in clip ? clip.in : 0;
  const speed = 'speed' in clip ? clip.speed : 1;
  const volume = 'volume' in clip ? clip.volume : 1;

  const drawn = useRef(false);
  useEffect(() => {
    const cv = ref.current;
    if (!cv || !asset || clip.kind === 'text' || clip.kind === 'caption') return;
    let cancelled = false;
    const draw = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const w = Math.max(1, Math.min(4096, Math.round(width * dpr)));
      const h = Math.round(height * dpr);
      const job = clip.kind === 'audio'
        ? waveform(asset.id).then((peaks) => { if (!cancelled) drawWave(cv, w, h, peaks, srcIn, clip.duration * speed, volume); })
        : thumbnails(asset.id, asset.duration).then((thumbs) => { if (!cancelled) drawFilm(cv, w, h, thumbs, srcIn, clip.duration * speed); });
      job.catch(() => undefined);
    };
    // A pinch changes the width on every move: what is drawn stretches with it, and every clip redraws once it rests
    // (audit V-101: all the film strips were drawn again on each frame of the gesture).
    if (!drawn.current) { drawn.current = true; draw(); return () => { cancelled = true; }; }
    const timer = setTimeout(draw, REDRAW_MS);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [clip.kind, asset, width, height, srcIn, speed, volume, clip.duration]);

  const label = clip.kind === 'text' ? clip.text
    : clip.kind === 'caption' ? clip.words.slice(0, 12).map((w) => w.text).join(' ')
    : clip.kind === 'audio' ? asset?.name ?? 'Audio' : null;
  // What kind of piece, by a sign before its words: text and captions are not told by a shade alone (WCAG 1.4.1).
  const Sign = clip.kind === 'text' ? Type : clip.kind === 'caption' ? Captions : clip.kind === 'audio' ? AudioLines : null;
  return (
    <>
      {clip.kind !== 'text' && clip.kind !== 'caption' && <canvas ref={ref} className="clip-canvas ck-tl-canvas" aria-hidden />}
      {label && <span className="clip-label ck-tl-label">{Sign && <Sign aria-hidden />}{label}</span>}
      <span className="clip-badges ck-tl-badges">
        {speed !== 1 && <b>{speed}×</b>}
        {'guide' in clip && clip.guide && <b>{t('Guide')}</b>}
        {'muted' in clip && clip.muted && <b><VolumeX aria-hidden /></b>}
      </span>
    </>
  );
});

function drawFilm(cv: HTMLCanvasElement, w: number, h: number, thumbs: Thumb[], srcIn: number, srcDur: number): void {
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  if (!thumbs.length) return;
  const tw = Math.max(8, (h * thumbs[0].bmp.width) / thumbs[0].bmp.height);
  for (let i = 0; i * tw < w; i++) {
    const t = srcIn + (((i + 0.5) * tw) / w) * srcDur;
    let best = thumbs[0];
    for (const th of thumbs) if (Math.abs(th.t - t) < Math.abs(best.t - t)) best = th;
    ctx.drawImage(best.bmp, i * tw, 0, tw, h);
  }
}

function drawWave(cv: HTMLCanvasElement, w: number, h: number, peaks: Float32Array, srcIn: number, srcDur: number, volume: number): void {
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d')!;
  ctx.fillStyle = getComputedStyle(cv).color; // the tone of the ticks (timeline.css), not a colour of its own
  for (let px = 0; px < w; px++) {
    const b0 = Math.floor((srcIn + (px / w) * srcDur) * PEAKS_PER_SEC);
    const b1 = Math.max(b0 + 1, Math.floor((srcIn + ((px + 1) / w) * srcDur) * PEAKS_PER_SEC));
    let m = 0;
    for (let b = b0; b < b1 && b < peaks.length; b++) m = Math.max(m, peaks[b]);
    const bh = Math.max(1, Math.min(1, m * volume) * h * 0.9);
    ctx.fillRect(px, (h - bh) / 2, 1, bh);
  }
}
