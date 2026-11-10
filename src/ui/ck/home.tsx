// Chetko components for the home screen (DESIGN.md §5): a project as a row, and the screen with nothing on it yet.
// A project shows its first frame whole (a vertical video is not cut into a square), says how long it is and that it is
// saved, and keeps its actions in sight (rule Ж2: people lost projects they could not rename or delete).
import { useId, type CSSProperties, type ReactNode } from 'react';

interface ProjectProps {
  title: string;
  /** «0:42, сегодня, сохранено». */
  meta: string;
  /** The first frame: an image or a canvas. Decorative: the title names the project. */
  thumb: ReactNode;
  onOpen: () => void;
  /** Icon buttons: a copy, the name, deleting. Each says which project it acts on. */
  actions: ReactNode;
  /** The name of the open button, when the screen has one: «Открыть «Поход на Алтай»». Without it the title and the state
   *  are the button's own words; with it the state (length, date, saved) is read as its description. */
  openLabel?: string;
  /** Width / height of the project's frame: the picture keeps its format, fitted whole into a 96 × 128 box, and the
   *  names of all rows stand in one line beside the box. */
  aspect?: number;
  /** Extra class names for the row and its open button: hooks that tests and the iPhone scripts already rely on. */
  hooks?: { row?: string; open?: string };
}
export function ProjectRow({ title, meta, thumb, onOpen, actions, hooks, openLabel, aspect = 9 / 16 }: ProjectProps) {
  const id = useId();
  const box = [96, 128] as const;
  const [w, h] = aspect >= box[0] / box[1] ? [box[0], box[0] / aspect] : [box[1] * aspect, box[1]];
  const size = { '--thumb-w': `${Math.round(w)}px`, '--thumb-h': `${Math.round(h)}px` } as CSSProperties;
  return (
    <article className={hooks?.row ? `ck-project ${hooks.row}` : 'ck-project'} aria-label={title} style={size}>
      <span className="ck-project-thumb" aria-hidden="true">{thumb}</span>
      <button type="button" className={hooks?.open ? `ck-project-open ${hooks.open}` : 'ck-project-open'} onClick={onOpen}
        aria-label={openLabel} aria-describedby={openLabel ? `${id}-meta` : undefined}>
        <span className="ck-project-title">{title}</span>
        <span className="ck-project-meta" id={`${id}-meta`}><span className="ck-sr">, </span>{meta}</span>
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
