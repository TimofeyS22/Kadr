// Chetko components (DESIGN.md §5): telling a person what happened, and asking before what cannot be undone.
// Toasts live in two regions that are always on the page (a live region that appears together with its text is not
// read out): polite for news, assertive for a failure. A toast stays while a finger or the focus is on it (WCAG 2.2.1);
// a failure stays until it is closed.
// The question before deleting is a native modal dialog: the browser keeps the focus inside and the rest inert.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Button } from './controls';
import { giveBack, opener, watchPressed } from './focus';

export interface ToastItem {
  id: number;
  text: string;
  /** `error`: something did not work — read out at once. */
  tone?: 'info' | 'error';
  icon?: ReactNode;
  /** One action, like «Отменить» after a piece was deleted. */
  action?: { label: string; run: () => void };
}

const SHOW_MS = 4000;
const SHOW_WITH_ACTION_MS = 7000; // time to read, decide and reach the button

interface CloseProps { closeLabel: string; closeIcon: ReactNode }

function Toast({ item, onDismiss, closeLabel, closeIcon }: { item: ToastItem; onDismiss: (id: number) => void } & CloseProps) {
  const [held, setHeld] = useState(false);
  // The parent may pass a new function on every render (a playing editor renders 60 times a second): the timer must not restart.
  const dismiss = useRef(onDismiss);
  dismiss.current = onDismiss;
  const error = item.tone === 'error';
  const hasAction = !!item.action;
  useEffect(() => {
    if (held || error) return;
    const timer = window.setTimeout(() => dismiss.current(item.id), hasAction ? SHOW_WITH_ACTION_MS : SHOW_MS);
    return () => window.clearTimeout(timer);
  }, [held, error, hasAction, item.id]);
  return (
    <div className="ck-toast" data-tone={item.tone ?? 'info'} onPointerEnter={() => setHeld(true)} onPointerLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)} onBlur={(e) => { if (!e.currentTarget.contains(e.relatedTarget)) setHeld(false); }}>
      {item.icon}
      <span className="ck-toast-text">{item.text}</span>
      {item.action && <button type="button" className="ck-toast-action" onClick={() => { item.action?.run(); onDismiss(item.id); }}>{item.action.label}</button>}
      {error && <button type="button" className="ck-toast-close" aria-label={closeLabel} onClick={() => onDismiss(item.id)}>{closeIcon}</button>}
    </div>
  );
}

/** Where toasts appear: the bottom of its host, above what must stay in reach (`--toast-lift` on the host). */
export function ToastRegion({ items, onDismiss, ...close }: { items: ToastItem[]; onDismiss: (id: number) => void } & CloseProps) {
  return (
    <div className="ck-toasts">
      <div role="status" aria-live="polite">{items.filter((i) => i.tone !== 'error').map((i) => <Toast key={i.id} item={i} onDismiss={onDismiss} {...close} />)}</div>
      <div role="alert">{items.filter((i) => i.tone === 'error').map((i) => <Toast key={i.id} item={i} onDismiss={onDismiss} {...close} />)}</div>
    </div>
  );
}

interface ConfirmProps {
  open: boolean;
  /** The question with the name of what goes: «Удалить «Поход на Алтай»?» */
  title: string;
  /** What exactly will be lost and that it cannot be brought back. */
  text: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Where the focus goes when what opened the question is gone (the deleted row): the next row, the main button. */
  afterClose?: () => HTMLElement | null | undefined;
}
/** Asked only before what cannot be undone (docs/17 §4, principle 7). The safe answer has the focus. */
export function Confirm({ open, title, text, confirmLabel, cancelLabel, onConfirm, onCancel, afterClose }: ConfirmProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLButtonElement>(null);
  const back = useRef<Element | null>(null);
  const after = useRef(afterClose);
  after.current = afterClose;
  const id = useId();
  useEffect(watchPressed, []);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) { back.current = opener(); d.showModal(); safe.current?.focus(); }
    // The browser gives the focus back by itself only where the opener had it, and never to a row that was just deleted.
    if (!open && d.open) { d.close(); giveBack(back.current, () => after.current?.()); back.current = null; }
  }, [open]);
  return (
    <dialog ref={ref} className="ck-confirm" aria-labelledby={`${id}-t`} aria-describedby={`${id}-d`}
      onCancel={(e) => { e.preventDefault(); onCancel(); }} onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="ck-confirm-in">
        <h2 id={`${id}-t`}>{title}</h2>
        <p id={`${id}-d`}>{text}</p>
        <div className="ck-confirm-acts">
          <Button ref={safe} onClick={onCancel}>{cancelLabel}</Button>
          <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
        </div>
      </div>
    </dialog>
  );
}
