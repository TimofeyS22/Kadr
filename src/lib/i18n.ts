// UI localization. English strings are the keys; missing translations fall back to English.
import { create } from 'zustand';
import { RU } from './locale-ru';
import type { ImportNote } from '../engine/importer';

export type Locale = 'en' | 'ru';
const KEY = 'kadr.locale';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'en' || saved === 'ru') return saved;
  } catch { /* storage blocked */ }
  return navigator.language.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}

export const useLocale = create<{ locale: Locale; setLocale(l: Locale): void }>()((set) => ({
  locale: initialLocale(),
  setLocale(locale) {
    try { localStorage.setItem(KEY, locale); } catch { /* ignore */ }
    document.documentElement.lang = locale;
    set({ locale });
  },
}));

/** Translates an English UI string; `{name}` placeholders are filled from `vars`. */
export function t(s: string, vars?: Record<string, string | number>): string {
  let out = useLocale.getState().locale === 'ru' ? RU[s] ?? s : s;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split(`{${k}}`).join(String(v));
  return out;
}

/** The toast for a file that went in with a remark. */
export function importNoteText(name: string, note: ImportNote): string {
  if (note.kind === 'sound') return t('{name}: its sound does not decode in this browser. The video is added without sound.', { name });
  return t('{name} is cut short: only {kept} s of {total} s are in the file. The clip is as long as what is there.', { name, kept: Math.floor(note.kept), total: Math.round(note.total) });
}
