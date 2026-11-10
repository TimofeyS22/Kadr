// Chetko components (DESIGN.md §5): a choice of one among a few. Segments for words (a format, a quality), tiles for
// looks (a filter, a style) drawn on the person's own frame. Both are radio groups: arrows move the choice and the focus
// together, Home and End go to the ends. The chosen tile lies between two marks, like a held piece.
import { useRef, type KeyboardEvent, type ReactNode } from 'react';

interface Option { id: string; label: string }

/** Arrows, Home and End for a radio group; the focus follows the choice. */
function useRadioKeys(items: Option[], value: string, onChange: (id: string) => void) {
  const root = useRef<HTMLDivElement>(null);
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const at = items.findIndex((i) => i.id === value);
    const last = items.length - 1;
    const next = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? (at + 1) % items.length
      : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? (at < 0 ? last : (at - 1 + items.length) % items.length)
        : e.key === 'Home' ? 0 : e.key === 'End' ? last : -1;
    if (next < 0 || !items[next]) return;
    e.preventDefault();
    onChange(items[next].id);
    root.current?.querySelector<HTMLElement>(`[data-id="${CSS.escape(items[next].id)}"]`)?.focus();
  };
  // Only the chosen option is a tab stop; with nothing chosen, the first one is.
  const tabIndex = (id: string) => (id === value || (!items.some((i) => i.id === value) && id === items[0]?.id) ? 0 : -1);
  return { root, onKeyDown, tabIndex };
}

interface SegmentsProps { label: string; items: Option[]; value: string; onChange: (id: string) => void; disabled?: boolean }
export function Segments({ label, items, value, onChange, disabled }: SegmentsProps) {
  const { root, onKeyDown, tabIndex } = useRadioKeys(items, value, onChange);
  return (
    <div className="ck-choice" role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} ref={root} onKeyDown={disabled ? undefined : onKeyDown}>
      {items.map((i) => (
        <button key={i.id} type="button" role="radio" className="ck-choice-item" data-id={i.id} aria-checked={i.id === value} tabIndex={tabIndex(i.id)}
          disabled={disabled} onClick={() => onChange(i.id)}>{i.label}</button>
      ))}
    </div>
  );
}

interface TileOption extends Option { /** The look drawn on the person's frame: a canvas, an image. Hidden from a screen reader: the name says it. */ art: ReactNode }
interface TilesProps { label: string; items: TileOption[]; value: string; onChange: (id: string) => void }
export function Tiles({ label, items, value, onChange }: TilesProps) {
  const { root, onKeyDown, tabIndex } = useRadioKeys(items, value, onChange);
  return (
    <div className="ck-tiles" role="radiogroup" aria-label={label} ref={root} onKeyDown={onKeyDown}>
      {items.map((i) => (
        <button key={i.id} type="button" role="radio" className="ck-tile" data-id={i.id} aria-checked={i.id === value} tabIndex={tabIndex(i.id)} onClick={() => onChange(i.id)}>
          <span className={i.id === value ? 'ck-tile-art ck-held' : 'ck-tile-art'} aria-hidden="true"><span className="ck-tile-pic">{i.art}</span></span>
          <span className="ck-tile-name">{i.label}</span>
        </button>
      ))}
    </div>
  );
}
