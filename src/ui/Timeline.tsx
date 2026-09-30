// Center-playhead timeline (mobile editor convention): scrolling the timeline scrubs the video.
// Touch: tap selects, long-press drags, handles trim, pinch zooms. Mouse: drag moves, ctrl+wheel zooms.
import { Blend, Plus, VolumeX } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import {
  clipEnd, findClip, mainTrack, moveClip, moveClipsBy, projectDuration, reorderMain, soundAssetId, trimClip,
} from '../core/timeline';
import type { Asset, Clip, Project, Track, TrackKind } from '../core/types';
import { PEAKS_PER_SEC, thumbnails, waveform, type Thumb } from '../engine/media';
import { player } from '../engine/player';
import { useEditor } from '../state/store';
import { addMedia } from './actions';
import { clipBeatTimes } from './MoreSheets';
import { formatTime } from './format';
import { t } from '../lib/i18n';

const ROW_H: Record<TrackKind, number> = { main: 56, overlay: 34, audio: 34 };
const LONG_PRESS_MS = 300;

/** A tap picks the clip in multi-select mode, otherwise selects it. */
function tapClip(id: string): void {
  const s = useEditor.getState();
  if (s.multi) s.toggleMulti(id);
  else s.select(id);
}
const SNAP_PX = 10;

type Drag =
  | { mode: 'trim'; id: string; edge: 'start' | 'end'; x0: number; t0: number; base: Project }
  | { mode: 'move'; id: string; x0: number; y0: number; dx: number; dy: number; main: boolean; base: Project };

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
    player.seek(t);
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
    const onMove = (e: PointerEvent) => {
      const d = dragRef.current;
      if (d?.mode === 'trim') {
        const t = snap(d.t0 + (e.clientX - d.x0) / live.current.zoom, d.id, d.base);
        useEditor.getState().commit((dr) => trimClip(dr, d.id, d.edge, t), `trim:${d.id}`, d.base);
        return;
      }
      if (d?.mode === 'move') { setDrag({ ...d, dx: e.clientX - d.x0, dy: e.clientY - d.y0 }); return; }
      const p = press.current;
      if (!p || p.pointerId !== e.pointerId) return;
      const moved = Math.hypot(e.clientX - p.x, e.clientY - p.y);
      if (!p.touch && moved > 4) {
        clearTimeout(p.timer);
        press.current = null;
        setDrag({ mode: 'move', id: p.id, x0: p.x, y0: p.y, dx: 0, dy: 0, main: p.main, base: useEditor.getState().project! });
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
        if (d.mode === 'move' && e.type === 'pointerup') finishMove(d, e);
        return;
      }
      if (p && e.type === 'pointerup' && p.pointerId === e.pointerId) tapClip(p.id);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  const onClipDown = (e: RPointerEvent, c: Clip, track: Track) => {
    if (e.button !== 0) return;
    if (player.playing) player.pause();
    const p: Press = { id: c.id, x: e.clientX, y: e.clientY, pointerId: e.pointerId, touch: e.pointerType !== 'mouse', main: track.kind === 'main', timer: 0 };
    if (p.touch) {
      p.timer = window.setTimeout(() => {
        if (press.current !== p) return;
        press.current = null;
        navigator.vibrate?.(8);
        if (!useEditor.getState().multi) useEditor.getState().select(c.id);
        setDrag({ mode: 'move', id: c.id, x0: p.x, y0: p.y, dx: 0, dy: 0, main: p.main, base: useEditor.getState().project! });
      }, LONG_PRESS_MS);
    }
    press.current = p;
  };

  const onTrimDown = (e: RPointerEvent, c: Clip, edge: 'start' | 'end') => {
    e.stopPropagation();
    if (player.playing) player.pause();
    setDrag({ mode: 'trim', id: c.id, edge, x0: e.clientX, t0: edge === 'start' ? c.start : clipEnd(c), base: useEditor.getState().project! });
  };

  const x = (t: number) => pad + t * zoom;
  const overlays = project.tracks.filter((t) => t.kind === 'overlay').reverse();
  const main = mainTrack(project);
  const audios = project.tracks.filter((t) => t.kind === 'audio');

  const row = (track: Track) => (
    <div key={track.id} className={`tl-row ${track.kind}`} style={{ height: ROW_H[track.kind] }} data-track={track.id} data-kind={track.kind}>
      {track.clips.map((c) => {
        const moving = drag?.mode === 'move' && drag.id === c.id;
        return (
          <div
            key={c.id}
            className={`clip clip-${c.kind} ${c.id === selection && !multi ? 'sel' : ''} ${multi?.includes(c.id) ? 'picked' : ''} ${moving ? 'dragging' : ''}`}
            style={{ left: x(c.start), width: Math.max(2, c.duration * zoom), transform: moving ? `translate(${drag.dx}px, ${drag.dy}px)` : undefined }}
            onPointerDown={(e) => onClipDown(e, c, track)}
            data-clip={c.id}
          >
            <ClipFace clip={c} asset={'assetId' in c ? project.assets[c.kind === 'audio' ? soundAssetId(c) : c.assetId] : undefined} zoom={zoom} height={ROW_H[track.kind] - 6} />
            {c.kind === 'audio' && clipBeatTimes(project, c).map((b, i) => <i key={i} className="beat" style={{ left: (b - c.start) * zoom }} />)}
            {c.id === selection && !moving && (
              <>
                <div className="handle l" onPointerDown={(e) => onTrimDown(e, c, 'start')} aria-label={t('Trim start')} />
                <div className="handle r" onPointerDown={(e) => onTrimDown(e, c, 'end')} aria-label={t('Trim end')} />
              </>
            )}
          </div>
        );
      })}
      {track.kind === 'main' && track.clips.slice(1).map((c) => (
        <button key={`tr-${c.id}`} className={`tr-btn ${'transitionIn' in c && c.transitionIn ? 'on' : ''}`}
          style={{ left: x(c.start + ('transitionIn' in c && c.transitionIn ? c.transitionIn.duration / 2 : 0)) }}
          onClick={() => useEditor.getState().openSheet('transition', c.id)} aria-label={t('Transition')}>
          <Blend size={14} />
        </button>
      ))}
      {track.kind === 'main' && (
        <button className={`add-btn ${track.clips.length ? '' : 'wide'}`} style={{ left: track.clips.length ? x(clipEnd(track.clips.at(-1)!)) + 8 : pad + 8 }}
          onClick={() => void addMedia('main')} aria-label={t('Add media')}>
          <Plus size={20} />{!track.clips.length && <span>{t('Add video or photo')}</span>}
        </button>
      )}
    </div>
  );

  return (
    <div className="timeline">
      <div
        className="tl-scroll" ref={scroller} onScroll={onScroll}
        onClick={(e) => { if (!(e.target as HTMLElement).closest('.clip, button')) useEditor.getState().select(null); }}
      >
        <div className="tl-content" style={{ width: duration * zoom + vw }}>
          <Ruler duration={duration} zoom={zoom} pad={pad} />
          {overlays.map(row)}
          {row(main)}
          {audios.map(row)}
        </div>
      </div>
      <div className="playhead" aria-hidden />
    </div>
  );
}

function Ruler({ duration, zoom, pad }: { duration: number; zoom: number; pad: number }) {
  const step = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * zoom >= 64) ?? 600;
  const n = Math.floor(duration / step) + 1;
  return (
    <div className="ruler">
      {Array.from({ length: n }, (_, i) => (
        <span key={i} style={{ left: pad + i * step * zoom }}>{formatTime(i * step, false)}</span>
      ))}
    </div>
  );
}

const ClipFace = memo(function ClipFace({ clip, asset, zoom, height }: { clip: Clip; asset?: Asset; zoom: number; height: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const width = clip.duration * zoom;
  const srcIn = 'in' in clip ? clip.in : 0;
  const speed = 'speed' in clip ? clip.speed : 1;
  const volume = 'volume' in clip ? clip.volume : 1;

  useEffect(() => {
    const cv = ref.current;
    if (!cv || !asset || clip.kind === 'text' || clip.kind === 'caption') return;
    let cancelled = false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.min(4096, Math.round(width * dpr)));
    const h = Math.round(height * dpr);
    const job = clip.kind === 'audio'
      ? waveform(asset.id).then((peaks) => { if (!cancelled) drawWave(cv, w, h, peaks, srcIn, clip.duration * speed, volume); })
      : thumbnails(asset.id, asset.duration).then((thumbs) => { if (!cancelled) drawFilm(cv, w, h, thumbs, srcIn, clip.duration * speed); });
    job.catch(() => undefined);
    return () => { cancelled = true; };
  }, [clip.kind, asset, width, height, srcIn, speed, volume, clip.duration]);

  const label = clip.kind === 'text' ? clip.text
    : clip.kind === 'caption' ? clip.words.slice(0, 12).map((w) => w.text).join(' ')
    : clip.kind === 'audio' ? asset?.name ?? 'Audio' : null;
  return (
    <>
      {clip.kind !== 'text' && clip.kind !== 'caption' && <canvas ref={ref} className="clip-canvas" />}
      {label && <span className="clip-label">{label}</span>}
      <span className="clip-badges">
        {speed !== 1 && <b>{speed}×</b>}
        {'muted' in clip && clip.muted && <VolumeX size={12} />}
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
  ctx.fillStyle = 'rgba(160, 255, 200, 0.75)';
  for (let px = 0; px < w; px++) {
    const b0 = Math.floor((srcIn + (px / w) * srcDur) * PEAKS_PER_SEC);
    const b1 = Math.max(b0 + 1, Math.floor((srcIn + ((px + 1) / w) * srcDur) * PEAKS_PER_SEC));
    let m = 0;
    for (let b = b0; b < b1 && b < peaks.length; b++) m = Math.max(m, peaks[b]);
    const bh = Math.max(1, Math.min(1, m * volume) * h * 0.9);
    ctx.fillRect(px, (h - bh) / 2, 1, bh);
  }
}
