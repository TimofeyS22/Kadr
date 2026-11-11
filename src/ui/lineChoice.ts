// Which part of a text in several faces the text sheet is set on (docs/18 ADR-П7): the font part chooses it, and the
// size, the look and the font itself follow. Kept per text: another text starts on «Весь текст».
import { create } from 'zustand';
import type { LineChoice } from '../core/lineLook';
import type { TextStyle } from '../core/types';

const useChoice = create<{ clip: string | null; line: LineChoice; set(clip: string, line: LineChoice): void }>()((set) => ({
  clip: null,
  line: 'all',
  set: (clip, line) => set({ clip, line }),
}));

/** The part chosen for `clipId`, valid for its style (a line that is gone falls back to the whole text). */
export function useLineChoice(clipId: string, style: TextStyle): [LineChoice, (line: LineChoice) => void] {
  const { clip, line, set } = useChoice();
  const n = style.lines?.length ?? 0;
  const chosen = clip === clipId && (line === 'all' || line < n) && n > 0 ? line : 'all';
  return [chosen, (l) => set(clipId, l)];
}
