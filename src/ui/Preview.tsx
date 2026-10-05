// Preview canvas with direct manipulation: tap selects a layer, drag moves it, two fingers scale and rotate.
import { useEffect, useLayoutEffect, useRef, type PointerEvent as RPointerEvent } from 'react';
import { evalAnim, setAnim } from '../core/anim';
import { findClip } from '../core/timeline';
import type { Project } from '../core/types';
import type { LayerBounds } from '../engine/compositor';
import { player } from '../engine/player';
import { useEditor } from '../state/store';
import { t } from '../lib/i18n';

const PREVIEW_MAX_PX = 1280;
const SNAP_PX = 8; // screen pixels within which a layer snaps to a guide
const SNAP_DEG = 4; // degrees within which a rotation snaps to a multiple of 45°

/** Snaps an angle to the nearest multiple of 45° when it is within SNAP_DEG of it. */
export function snapAngle(deg: number): { deg: number; snapped: boolean } {
  const target = Math.round(deg / 45) * 45;
  return Math.abs(deg - target) <= SNAP_DEG ? { deg: target, snapped: true } : { deg, snapped: false };
}

/**
 * Snaps a layer's center coordinate (canvas-normalized, 0 = middle) so that its center meets the canvas middle
 * or its edge meets a canvas edge. `half` is half the layer's on-screen extent on this axis, normalized.
 * Returns the snapped value and where to draw the guide (-0.5 … 0.5), or null when nothing is near.
 */
function snapAxis(v: number, half: number, tol: number): { v: number; guide: number | null } {
  let best: { v: number; guide: number | null } = { v, guide: null }, dist = tol;
  for (const [target, guide] of [[0, 0], [-0.5 + half, -0.5], [0.5 - half, 0.5]] as const) {
    const d = Math.abs(v - target);
    if (d <= dist) { dist = d; best = { v: target, guide }; }
  }
  return best;
}

interface Gesture {
  id: string | null;
  /** The selected layer is being moved from a touch outside it: a tap (no movement) means "done", deselect. */
  sticky: boolean;
  base: Project | null;
  local: number;
  moved: boolean;
  anchor: { x: number; y: number; dist: number; angle: number };
  start: { x: number; y: number; scale: number; rotation: number };
}

function inside(b: LayerBounds, px: number, py: number): boolean {
  const dx = px - b.cx, dy = py - b.cy;
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot);
  const lx = dx * c - dy * s, ly = dx * s + dy * c;
  return Math.abs(lx) <= b.w / 2 && Math.abs(ly) <= b.h / 2;
}

export function Preview() {
  const aspect = useEditor((s) => (s.project ? s.project.settings.width / s.project.settings.height : 9 / 16));
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const zones = useRef<HTMLDivElement>(null);
  const guideV = useRef<HTMLDivElement>(null);
  const guideH = useRef<HTMLDivElement>(null);
  const angleTag = useRef<HTMLDivElement>(null);
  const angleSnap = useRef(false);
  const snapped = useRef('');
  const safeZones = useEditor((s) => s.safeZones);
  const vertical = aspect < 0.7;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<Gesture | null>(null);

  useEffect(() => {
    player.attach(canvas.current!);
    return () => player.detach();
  }, []);

  // iOS pans the page under a finger (most visibly while the keyboard is up) despite touch-action: none, so moves
  // on the preview are cancelled natively; pointer events still arrive. Taps and double taps are unaffected.
  useEffect(() => {
    const w = wrap.current!;
    const stop = (e: TouchEvent) => { if (e.cancelable) e.preventDefault(); };
    w.addEventListener('touchmove', stop, { passive: false });
    return () => w.removeEventListener('touchmove', stop);
  }, []);

  useLayoutEffect(() => {
    const w = wrap.current!, c = canvas.current!;
    const fit = () => {
      const r = w.getBoundingClientRect();
      if (!r.width || !r.height) return;
      let cw = r.width - 16, ch = cw / aspect;
      if (ch > r.height - 16) { ch = r.height - 16; cw = ch * aspect; }
      c.style.width = `${cw}px`;
      c.style.height = `${ch}px`;
      if (zones.current) { zones.current.style.width = `${cw}px`; zones.current.style.height = `${ch}px`; }
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const k = Math.min(1, PREVIEW_MAX_PX / (Math.max(cw, ch) * dpr));
      c.width = Math.max(2, Math.round(cw * dpr * k));
      c.height = Math.max(2, Math.round(ch * dpr * k));
      player.requestRender();
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(w);
    return () => ro.disconnect();
  }, [aspect, safeZones]);

  // Selection outline follows the rendered layer.
  useEffect(() => {
    const update = () => {
      const b = box.current, c = canvas.current;
      if (!b || !c) return;
      const sel = useEditor.getState().selection;
      const lb = sel ? player.bounds.find((x) => x.id === sel) : undefined;
      if (!lb) { b.style.display = 'none'; return; }
      const k = c.clientWidth / c.width;
      b.style.display = 'block';
      b.style.width = `${lb.w * k}px`;
      b.style.height = `${lb.h * k}px`;
      b.style.transform = `translate(${c.offsetLeft + (lb.cx - lb.w / 2) * k}px, ${c.offsetTop + (lb.cy - lb.h / 2) * k}px) rotate(${lb.rot}rad)`;
    };
    const offFrame = player.onFrame(update);
    const offSel = useEditor.subscribe((s, p) => { if (s.selection !== p.selection) update(); });
    return () => { offFrame(); offSel(); };
  }, []);

  const begin = () => {
    const s = useEditor.getState();
    const ps = [...pointers.current.values()];
    const gs = g.current;
    if (!gs?.id || !s.project) return;
    const f = findClip(s.project, gs.id);
    if (!f || f.clip.kind === 'audio') return;
    const tf = f.clip.transform, local = gs.local;
    gs.base = s.project;
    gs.start = { x: evalAnim(tf.x, local), y: evalAnim(tf.y, local), scale: evalAnim(tf.scale, local), rotation: evalAnim(tf.rotation, local) };
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length, cy = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    gs.anchor = ps.length >= 2
      ? { x: cx, y: cy, dist: Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y), angle: Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) }
      : { x: cx, y: cy, dist: 0, angle: 0 };
  };

  const onDown = (e: RPointerEvent) => {
    // Typing in a sheet leaves the keyboard up; touching the preview puts it away, so the layer can be moved.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.matches('input, textarea')) active.blur();
    wrap.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const c = canvas.current!, r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
      const { selection: sel, project } = useEditor.getState();
      const hits = player.bounds.filter((b) => inside(b, px, py));
      // Who the finger moves (CapCut-like, but forgiving):
      //  1. the selected layer when the touch is on it;
      //  2. another floating layer (text, sticker, overlay) under the finger takes over;
      //  3. otherwise the selected layer still moves, from anywhere in the frame (no hunting for thin letters);
      //  4. with nothing selected, whatever is under the finger (the main video included).
      // Visible layers win; an invisible one (e.g. text mid fade-in) only when nothing visible is there.
      const isMain = (id: string) => !!project && findClip(project, id)?.track.kind === 'main';
      const pick = (bs: LayerBounds[]) => bs.filter((b) => !b.hidden).at(-1) ?? bs.at(-1);
      const selected = sel && player.bounds.some((b) => b.id === sel) ? sel : null;
      let id: string | null, sticky = false;
      if (selected && hits.some((b) => b.id === selected)) id = selected;
      else if (pick(hits.filter((b) => !isMain(b.id)))) id = pick(hits.filter((b) => !isMain(b.id)))!.id;
      else if (selected) { id = selected; sticky = true; }
      else id = pick(hits)?.id ?? null;
      const clip = id && project ? findClip(project, id)?.clip : undefined;
      g.current = { id, sticky, base: null, local: clip ? player.time - clip.start : 0, moved: false, anchor: { x: 0, y: 0, dist: 0, angle: 0 }, start: { x: 0, y: 0, scale: 1, rotation: 0 } };
      if (id && id !== sel) useEditor.getState().select(id);
      if (player.playing && id) player.pause();
    }
    begin();
  };

  const onMove = (e: RPointerEvent) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const gs = g.current;
    if (!gs?.id || !gs.base) return;
    const ps = [...pointers.current.values()];
    const r = canvas.current!.getBoundingClientRect();
    const cx = ps.reduce((a, p) => a + p.x, 0) / ps.length, cy = ps.reduce((a, p) => a + p.y, 0) / ps.length;
    if (!gs.moved && Math.hypot(cx - gs.anchor.x, cy - gs.anchor.y) < 3 && ps.length < 2) return;
    gs.moved = true;
    let scale = gs.start.scale, rotation = gs.start.rotation;
    if (ps.length >= 2 && gs.anchor.dist > 0) {
      scale = Math.min(10, Math.max(0.05, gs.start.scale * (Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y) / gs.anchor.dist)));
      rotation = showAngle(gs.start.rotation + ((Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) - gs.anchor.angle) * 180) / Math.PI);
    }
    // Axis-aligned extent of the (possibly rotated) layer, scaled to the size it will have after this move.
    const lb = player.bounds.find((b) => b.id === gs.id);
    const cur = findClip(useEditor.getState().project!, gs.id)?.clip;
    const k = cur && cur.kind !== 'audio' ? scale / Math.max(1e-6, evalAnim(cur.transform.scale, gs.local)) : 1;
    const c = canvas.current!;
    const rr = (rotation * Math.PI) / 180;
    const halfX = lb ? ((Math.abs(lb.w * Math.cos(rr)) + Math.abs(lb.h * Math.sin(rr))) * k) / (2 * c.width) : 0;
    const halfY = lb ? ((Math.abs(lb.w * Math.sin(rr)) + Math.abs(lb.h * Math.cos(rr))) * k) / (2 * c.height) : 0;
    const sx = snapAxis(gs.start.x + (cx - gs.anchor.x) / r.width, halfX, SNAP_PX / r.width);
    const sy = snapAxis(gs.start.y + (cy - gs.anchor.y) / r.height, halfY, SNAP_PX / r.height);
    const nx = sx.v, ny = sy.v;
    showGuides(sx.guide, sy.guide);
    const { id, local } = gs;
    useEditor.getState().commit((d) => {
      const f = findClip(d, id);
      if (!f || f.clip.kind === 'audio') return;
      const tf = f.clip.transform;
      setAnim(tf.x, local, nx);
      setAnim(tf.y, local, ny);
      if (ps.length >= 2) { setAnim(tf.scale, local, scale); setAnim(tf.rotation, local, rotation); }
    }, `gesture:${id}`, gs.base);
  };

  // Center and edge guides while a layer is dragged; a short vibration marks the moment it snaps (Android).
  const showGuides = (x: number | null, y: number | null) => {
    const c = canvas.current, v = guideV.current, h = guideH.current;
    if (!c || !v || !h) return;
    const key = `${x}|${y}`;
    if (key !== snapped.current && (x !== null || y !== null)) navigator.vibrate?.(8);
    snapped.current = key;
    v.style.display = x === null ? 'none' : 'block';
    h.style.display = y === null ? 'none' : 'block';
    if (x !== null) { v.style.height = `${c.clientHeight}px`; v.style.transform = `translate(${c.offsetLeft + Math.min(c.clientWidth - 1, (0.5 + x) * c.clientWidth)}px, ${c.offsetTop}px)`; }
    if (y !== null) { h.style.width = `${c.clientWidth}px`; h.style.transform = `translate(${c.offsetLeft}px, ${c.offsetTop + Math.min(c.clientHeight - 1, (0.5 + y) * c.clientHeight)}px)`; }
  };

  // While rotating: snaps to 0°, 45°, 90°… and shows the angle above the layer; a short vibration marks a snap.
  const showAngle = <T extends number | null>(deg: T): T => {
    const tag = angleTag.current;
    if (deg === null) { if (tag) tag.style.display = 'none'; angleSnap.current = false; return deg; }
    const r = snapAngle(deg);
    if (r.snapped && !angleSnap.current) navigator.vibrate?.(8);
    angleSnap.current = r.snapped;
    if (tag) {
      const norm = ((Math.round(r.deg) % 360) + 540) % 360 - 180; // -180 … 179
      tag.textContent = `${norm}°`;
      tag.style.display = 'block';
      tag.classList.toggle('snapped', r.snapped);
    }
    return r.deg as T;
  };

  // Corner handle: drag to scale and rotate the selected layer around its center (mouse or one finger).
  const onHandleDown = (e: RPointerEvent) => {
    e.stopPropagation();
    const s = useEditor.getState();
    const id = s.selection;
    const lb = id ? player.bounds.find((b) => b.id === id) : undefined;
    const f = id && s.project ? findClip(s.project, id) : null;
    if (!id || !lb || !f || f.clip.kind === 'audio' || !s.project) return;
    player.pause();
    const c = canvas.current!, r = c.getBoundingClientRect(), k = r.width / c.width;
    const cx = r.left + lb.cx * k, cy = r.top + lb.cy * k;
    const local = player.time - f.clip.start, tf = f.clip.transform, base = s.project;
    const s0 = evalAnim(tf.scale, local), r0 = evalAnim(tf.rotation, local);
    const d0 = Math.max(4, Math.hypot(e.clientX - cx, e.clientY - cy)), a0 = Math.atan2(e.clientY - cy, e.clientX - cx);
    (e.target as Element).setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => {
      const scale = Math.min(10, Math.max(0.05, (s0 * Math.hypot(ev.clientX - cx, ev.clientY - cy)) / d0));
      const rotation = showAngle(r0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI);
      useEditor.getState().commit((d) => {
        const g2 = findClip(d, id);
        if (!g2 || g2.clip.kind === 'audio') return;
        setAnim(g2.clip.transform.scale, local, scale);
        setAnim(g2.clip.transform.rotation, local, rotation);
      }, `handle:${id}`, base);
    };
    const up = () => { showAngle(null); window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  };

  // Double tap on text or captions opens their editor.
  const onDoubleClick = () => {
    const s = useEditor.getState();
    const kind = s.project && s.selection ? findClip(s.project, s.selection)?.clip.kind : undefined;
    if (kind === 'text') s.openSheet('text');
    else if (kind === 'caption') s.openSheet('captionEdit');
  };

  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const gs = g.current;
    if (pointers.current.size > 0) { begin(); return; } // continue with the remaining finger without a jump
    // A tap on empty space (or on the video while another layer is selected) finishes editing.
    if (gs && !gs.moved && (!gs.id || gs.sticky)) useEditor.getState().select(null);
    g.current = null;
    showGuides(null, null);
    showAngle(null);
  };

  return (
    <div className="preview" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDoubleClick}>
      <canvas ref={canvas} className="preview-canvas" />
      <div ref={guideV} className="guide v" aria-hidden />
      <div ref={guideH} className="guide h" aria-hidden />
      <div ref={angleTag} className="angle-tag" aria-live="polite" />
      <div ref={box} className="sel-box">
        <div className="sel-handle" onPointerDown={onHandleDown} role="button" aria-label={t('Drag to resize and rotate')} />
      </div>
      {safeZones && (
        <div ref={zones} className={`safe-zones ${vertical ? 'vertical' : 'title-safe'}`} aria-hidden>
          {vertical ? <><i className="z-top" /><i className="z-right" /><i className="z-bottom" /></> : <i className="z-title" />}
        </div>
      )}
    </div>
  );
}
