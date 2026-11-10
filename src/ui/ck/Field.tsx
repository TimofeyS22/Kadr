// A text field (DESIGN.md §5): a name above it, a hint or an error under it, both read out with the field. 16 px text,
// so Safari never zooms into it. An error is told by a thicker frame and by words, not by colour alone, and red stays
// for deleting (DESIGN.md §2.3).
import { useId, type ChangeEvent } from 'react';

interface Props {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  /** Says what is wrong and how to fix it; the field is then marked invalid. */
  error?: string;
  placeholder?: string;
  maxLength?: number;
  /** Show «12 / 80» under the field: for a name with a limit. */
  count?: boolean;
  /** The limit in words, for a screen reader: (n, max) => «12 из 80 знаков». Said again when the limit is reached,
   *  because the field then takes no more letters. */
  countLabel?: (n: number, max: number) => string;
  multiline?: boolean;
  rows?: number;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'search';
  enterKeyHint?: 'done' | 'next' | 'search' | 'enter';
  autoComplete?: string;
  disabled?: boolean;
}

export function Field({ label, value, onChange, hint, error, placeholder, maxLength, count, countLabel, multiline, rows = 3, inputMode, enterKeyHint, autoComplete = 'off', disabled }: Props) {
  const id = useId();
  const note = error ?? hint;
  const counted = !!(count && maxLength);
  const said = counted && countLabel ? countLabel(value.length, maxLength ?? 0) : '';
  const described = [note ? `${id}-note` : '', said ? `${id}-count` : ''].filter(Boolean).join(' ');
  const common = {
    id, value, placeholder, maxLength, disabled, inputMode, enterKeyHint, autoComplete, className: 'ck-input',
    'aria-invalid': error ? true : undefined, 'aria-describedby': described || undefined,
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
  };
  return (
    <div className="ck-field" data-invalid={error ? true : undefined}>
      <label className="ck-field-label" htmlFor={id}>{label}</label>
      {multiline ? <textarea rows={rows} {...common} /> : <input type="text" {...common} />}
      {(note || counted) && (
        <div className="ck-field-foot">
          {note && <span id={`${id}-note`} className="ck-field-note">{note}</span>}
          {counted && <span className="ck-field-count"><span aria-hidden="true">{value.length} / {maxLength}</span>{said && <span id={`${id}-count`} className="ck-sr">{said}</span>}</span>}
        </div>
      )}
      {said && <span className="ck-sr" aria-live="polite">{value.length >= (maxLength ?? Infinity) ? said : ''}</span>}
    </div>
  );
}
