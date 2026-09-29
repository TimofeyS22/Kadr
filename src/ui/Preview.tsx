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
const SNAP = 0.015;

interface Gesture {
  id: string | null;
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
  const safeZones = useEditor((s) => s.safeZones);
  const vertical = aspect < 0.7;
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const g = useRef<Gesture | null>(null);

  useEffect(() => {
    player.attach(canvas.current!);
    return () => player.detach();
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
    wrap.current!.setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) {
      const c = canvas.current!, r = c.getBoundingClientRect();
      const k = c.width / r.width;
      const px = (e.clientX - r.left) * k, py = (e.clientY - r.top) * k;
      const sel = useEditor.getState().selection;
      const hits = player.bounds.filter((b) => inside(b, px, py));
      // Visible layers win; an invisible one (e.g. text mid fade-in) is picked only when nothing visible is there.
      const hit = hits.find((b) => b.id === sel) ?? hits.filter((b) => !b.hidden).at(-1) ?? hits.at(-1);
      const clip = hit ? findClip(useEditor.getState().project!, hit.id)?.clip : undefined;
      g.current = { id: hit?.id ?? null, base: null, local: clip ? player.time - clip.start : 0, moved: false, anchor: { x: 0, y: 0, dist: 0, angle: 0 }, start: { x: 0, y: 0, scale: 1, rotation: 0 } };
      if (hit && hit.id !== sel) useEditor.getState().select(hit.id);
      if (player.playing && hit) player.pause();
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
    let nx = gs.start.x + (cx - gs.anchor.x) / r.width;
    let ny = gs.start.y + (cy - gs.anchor.y) / r.height;
    if (Math.abs(nx) < SNAP) nx = 0;
    if (Math.abs(ny) < SNAP) ny = 0;
    let scale = gs.start.scale, rotation = gs.start.rotation;
    if (ps.length >= 2 && gs.anchor.dist > 0) {
      scale = Math.min(10, Math.max(0.05, gs.start.scale * (Math.hypot(ps[1].x - ps[0].x, ps[1].y - ps[0].y) / gs.anchor.dist)));
      rotation = gs.start.rotation + ((Math.atan2(ps[1].y - ps[0].y, ps[1].x - ps[0].x) - gs.anchor.angle) * 180) / Math.PI;
      const snapped = Math.round(rotation / 90) * 90;
      if (Math.abs(rotation - snapped) < 3) rotation = snapped;
    }
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
      let rotation = r0 + ((Math.atan2(ev.clientY - cy, ev.clientX - cx) - a0) * 180) / Math.PI;
      const snapped = Math.round(rotation / 90) * 90;
      if (Math.abs(rotation - snapped) < 3) rotation = snapped;
      useEditor.getState().commit((d) => {
        const g2 = findClip(d, id);
        if (!g2 || g2.clip.kind === 'audio') return;
        setAnim(g2.clip.transform.scale, local, scale);
        setAnim(g2.clip.transform.rotation, local, rotation);
      }, `handle:${id}`, base);
    };
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up); };
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
    if (gs && !gs.moved && !gs.id) useEditor.getState().select(null);
    g.current = null;
  };

  return (
    <div className="preview" ref={wrap} onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onDoubleClick={onDoubleClick}>
      <canvas ref={canvas} className="preview-canvas" />
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
