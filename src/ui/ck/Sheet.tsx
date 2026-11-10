// The sheet (DESIGN.md): a layer that rises from the bottom for a choice, never for a value (values live on the Scale).
// It is a dialog to a screen reader, takes the focus and gives it back, closes on Escape, on a tap outside and on a
// swipe of its header down, like the sheets of the system (docs/09 Q2). It lives inside its host, which is `position:
// relative` or fixed to the screen.
import { useEffect, useRef, type PointerEvent, type ReactNode } from 'react';
import { giveBack, opener, watchPressed } from './focus';

interface Props {
  open: boolean;
  title: string;
  /** The name of the button that closes it: «Закрыть». */
  closeLabel: string;
  closeIcon: ReactNode;
  onClose: () => void;
  children: ReactNode;
}

const SLOP = 6;

export function Sheet({ open, title, closeLabel, closeIcon, onClose, children }: Props) {
  const panel = useRef<HTMLElement>(null);
  const back = useRef<Element | null>(null);
  const drag = useRef<{ y0: number; y: number; t: number; v: number; on: boolean } | null>(null);

  useEffect(watchPressed, []);

  // While the sheet is open, everything beside it in its host is out of reach: of a finger (the scrim), of Tab and of a
  // screen reader (inert). That is what `aria-modal` promises.
  useEffect(() => {
    const layer = panel.current?.parentElement;
    const host = layer?.parentElement;
    if (!open || !layer || !host) return;
    const others = [...host.children].filter((c): c is HTMLElement => c !== layer && c instanceof HTMLElement && !c.inert);
    for (const o of others) o.inert = true;
    return () => { for (const o of others) o.inert = false; };
  }, [open]);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    if (open) {
      back.current = opener();
      el.focus({ preventScroll: true });
    } else if (el.contains(document.activeElement) || document.activeElement === document.body) {
      // Back to what opened it; if that is gone (a tool was chosen and the ribbon gave way to a Scale), to what came instead.
      const host = el.parentElement?.parentElement;
      if (back.current) giveBack(back.current, () => host?.querySelector<HTMLElement>('[role="slider"]') ?? host?.querySelector<HTMLElement>('button:not(:disabled)'));
      back.current = null;
    }
  }, [open]);

  const slide = (dy: number) => { if (panel.current) panel.current.style.translate = dy ? `0 ${dy}px` : ''; };
  const down = (e: PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('button')) return;
    drag.current = { y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0, on: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const move = (e: PointerEvent<HTMLElement>) => {
    const d = drag.current;
    if (!d) return;
    const dy = e.clientY - d.y0;
    if (!d.on && dy < SLOP) return;
    if (!d.on) { d.on = true; panel.current?.setAttribute('data-dragging', 'true'); }
    if (e.timeStamp > d.t) d.v = (e.clientY - d.y) / (e.timeStamp - d.t);
    d.y = e.clientY; d.t = e.timeStamp;
    slide(Math.max(0, dy));
  };
  const up = () => {
    const d = drag.current;
    drag.current = null;
    const el = panel.current;
    if (!d?.on || !el) return;
    el.removeAttribute('data-dragging');
    slide(0);
    // Past 30% of its height, or a flick (> 0.5 px/ms), closes it; otherwise it springs back.
    if (d.y - d.y0 > 0.3 * el.offsetHeight || d.v > 0.5) onClose();
  };

  return (
    <div className="ck-sheet-layer" data-open={open} inert={!open} aria-hidden={!open}>
      <div className="ck-scrim" onClick={onClose} />
      <section ref={panel} className="ck-sheet" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); onClose(); } }}>
        <header className="ck-sheet-head" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
          <h2>{title}</h2>
          <button type="button" className="ck-ib" aria-label={closeLabel} onClick={onClose}>{closeIcon}</button>
        </header>
        <div className="ck-sheet-body">{children}</div>
      </section>
    </div>
  );
}
