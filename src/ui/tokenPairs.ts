// Chetko tokens that meet on screen, and the contrast each pair must keep (WCAG 2.2 AA): 4.5 for text, 3 for marks, ticks
// and large digits. One list for the unit test (tokens.test.ts, its own colour maths) and for the gallery (`?ds`, the
// browser's maths): when they disagree, the test is wrong.
export interface TokenPair { fg: string; bg: string; min: number; what: string }

export const TOKEN_PAIRS: TokenPair[] = [
  { fg: '--text-primary', bg: '--surface-panel', min: 4.5, what: 'Текст на панели' },
  { fg: '--text-primary', bg: '--surface-raised', min: 4.5, what: 'Текст на листе' },
  { fg: '--text-primary', bg: '--surface-field', min: 4.5, what: 'Текст на поле кадра и в поле ввода' },
  { fg: '--text-secondary', bg: '--surface-panel', min: 4.5, what: 'Второй план на панели' },
  { fg: '--text-secondary', bg: '--surface-raised', min: 4.5, what: 'Второй план на листе' },
  { fg: '--text-on-action', bg: '--action-primary', min: 4.5, what: 'Подпись главной кнопки' },
  { fg: '--action-danger', bg: '--surface-panel', min: 4.5, what: '«Удалить» на панели' },
  { fg: '--action-danger', bg: '--surface-raised', min: 4.5, what: '«Удалить» на листе' },
  { fg: '--signal', bg: '--surface-panel', min: 4.5, what: 'Цифра значения и метка «стало»' },
  { fg: '--text-on-signal', bg: '--signal', min: 4.5, what: 'Текст на сигнальном' },
  { fg: '--mark-was', bg: '--surface-field', min: 3, what: 'Метка у кадра и на куске' },
  { fg: '--mark-was', bg: '--surface-panel', min: 3, what: 'Метка «было» на шкале' },
  { fg: '--text-primary', bg: '--track-text', min: 4.5, what: 'Подпись на куске текста' },
  { fg: '--text-primary', bg: '--track-audio', min: 4.5, what: 'Подпись на куске звука' },
  { fg: '--text-primary', bg: '--track-caption', min: 4.5, what: 'Подпись на куске субтитров' },
  { fg: '--mark-was', bg: '--track-audio', min: 3, what: 'Метки выбранного куска на дорожке' },
  { fg: '--tick-major', bg: '--surface-panel', min: 3, what: 'Крупные деления шкалы' },
  { fg: '--tick-minor', bg: '--surface-panel', min: 3, what: 'Мелкие деления шкалы' },
];

/** Scales that may not grow: a new step is a decision, not a convenience (docs/17 §5). */
export const TOKEN_LIMITS = { '--type-': 7, '--radius-': 4, '--space-': 8, '--dur-': 8, '--z-': 8 } as const;
