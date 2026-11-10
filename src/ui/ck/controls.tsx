// Chetko components (DESIGN.md): what is pressed. Every one of them is at least 44 px to a finger, names itself to a
// screen reader, shows the keyboard where it is, and takes every value from tokens. Texts come from the caller, so the
// components know no language.
import { useRef, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode, type Ref } from 'react';

type Native = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className' | 'children'>;

interface ButtonProps extends Native {
  /** `primary`: the one main action of a screen (white). `quiet`: an outline. `plain`: words only. `danger`: deleting. */
  variant?: 'primary' | 'quiet' | 'plain' | 'danger';
  /** `large` is for the single action in the thumb zone of a screen. */
  size?: 'regular' | 'large';
  icon?: ReactNode;
  children: ReactNode;
  ref?: Ref<HTMLButtonElement>;
}
export function Button({ variant = 'quiet', size = 'regular', icon, children, type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`ck-btn ck-${variant}${size === 'large' ? ' ck-large' : ''}`} {...rest}>{icon}<span className="ck-btn-label">{children}</span></button>;
}

interface IconButtonProps extends Native {
  /** There is no text on it, so the name is required. */
  label: string;
  /** It deletes: red, as everything that deletes (DESIGN.md §2.3). */
  danger?: boolean;
  children: ReactNode;
}
export function IconButton({ label, danger, children, type = 'button', ...rest }: IconButtonProps) {
  return <button type={type} className={danger ? 'ck-ib ck-danger' : 'ck-ib'} aria-label={label} {...rest}>{children}</button>;
}

interface ToolProps extends Native {
  icon: ReactNode;
  label: string;
  danger?: boolean;
  /** The tool has changed this piece (a mask is on, the speed is not 1×): it is marked, not coloured. A tool is not a
   *  switch, so a screen reader hears this as words (`onNote`: «изменено»), not as "pressed". */
  on?: boolean;
  onNote?: string;
}
/** One tool of the ribbon or of the sheet of all tools: an icon with its name under it, always. */
export function Tool({ icon, label, danger, on, onNote, type = 'button', ...rest }: ToolProps) {
  return (
    <button type={type} className={`ck-tool${danger ? ' ck-danger' : ''}`} data-on={on || undefined} {...rest}>
      {icon}<span>{label}</span>{on && onNote && <span className="ck-sr">, {onNote}</span>}
    </button>
  );
}

interface RibbonProps {
  /** The name of the toolbar: «Инструменты». */
  label: string;
  /** Stays at the left edge while the tools scroll: «Назад». */
  start?: ReactNode;
  /** Stays at the right edge: «Все». */
  end?: ReactNode;
  children: ReactNode;
}
/** The ribbon of tools: the same order as ever, scrolled sideways, with what must stay in reach fixed at its edges. */
export function Ribbon({ label, start, end, children }: RibbonProps) {
  return (
    <nav className="ck-ribbon" aria-label={label}>
      {start && <div className="ck-ribbon-edge">{start}</div>}
      <div className="ck-ribbon-tools">{children}</div>
      {end && <div className="ck-ribbon-edge ck-end">{end}</div>}
    </nav>
  );
}

interface TabsProps { label: string; items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }
/** Parameters of one tool. Arrows move between them, as the keyboard expects of tabs. */
export function Tabs({ label, items, value, onChange }: TabsProps) {
  const list = useRef<HTMLDivElement>(null);
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const at = items.findIndex((i) => i.id === value);
    const next = items[(at + step + items.length) % items.length];
    onChange(next.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-id="${next.id}"]`)?.focus();
  };
  return (
    <div className="ck-tabs" role="tablist" aria-label={label} ref={list} onKeyDown={key}>
      {items.map((i) => (
        <button key={i.id} type="button" role="tab" className="ck-tab" data-id={i.id} aria-selected={i.id === value} tabIndex={i.id === value ? 0 : -1} onClick={() => onChange(i.id)}>{i.label}</button>
      ))}
    </div>
  );
}

interface ProgressProps {
  /** What is being made: «Экспорт». */
  label: string;
  /** 0 … 1. */
  value: number;
  /** What lies between the marks and comes out of the dark as the work goes: frames of the film. Without it, a plain bar. */
  children?: ReactNode;
}
/** Honest progress: the work lies between two marks and shows as far as it is done. */
export function Progress({ label, value, children }: ProgressProps) {
  const done = Math.min(1, Math.max(0, value));
  return (
    <div className="ck-progress ck-held" role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(done * 100)}>
      <div className="ck-progress-film">{children}</div>
      <i className="ck-progress-rest" style={{ transform: `scaleX(${1 - done})` }} />
    </div>
  );
}
