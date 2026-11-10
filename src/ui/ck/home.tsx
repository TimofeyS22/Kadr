// Chetko components for the home screen (DESIGN.md §5): a project as a row, and the screen with nothing on it yet.
// A project shows its first frame whole (a vertical video is not cut into a square), says how long it is and that it is
// saved, and keeps its actions in sight (rule Ж2: people lost projects they could not rename or delete).
import type { ReactNode } from 'react';

interface ProjectProps {
  title: string;
  /** «0:42, сегодня, сохранено». */
  meta: string;
  /** The first frame: an image or a canvas. Decorative: the title names the project. */
  thumb: ReactNode;
  onOpen: () => void;
  /** Icon buttons: a copy, the name, deleting. Each says which project it acts on. */
  actions: ReactNode;
}
export function ProjectRow({ title, meta, thumb, onOpen, actions }: ProjectProps) {
  return (
    <article className="ck-project" aria-label={title}>
      <span className="ck-project-thumb" aria-hidden="true">{thumb}</span>
      {/* No aria-label: the name and the state of the project are the button's own words. */}
      <button type="button" className="ck-project-open" onClick={onOpen}>
        <span className="ck-project-title">{title}</span>
        <span className="ck-project-meta"><span className="ck-sr">, </span>{meta}</span>
      </button>
      <div className="ck-project-acts">{actions}</div>
    </article>
  );
}

interface EmptyProps {
  /** A picture of what will be here: a frame of an example, not a mascot. */
  art?: ReactNode;
  title: string;
  children?: ReactNode;
  /** One way forward. */
  action?: ReactNode;
}
/** An empty screen is an invitation to act: what will appear here, and the one step that makes it appear. */
export function Empty({ art, title, children, action }: EmptyProps) {
  return (
    <div className="ck-empty">
      {art && <div className="ck-empty-art" aria-hidden="true">{art}</div>}
      <h2 className="ck-empty-title">{title}</h2>
      {children && <p className="ck-empty-text">{children}</p>}
      {action}
    </div>
  );
}
