// The export sheet's remembered choices and the Export button: the editor shows the button before the sheets are loaded.
import type { Resolution } from '../engine/exportSizes';
import { useEditor } from '../state/store';

/** The frame rate is not kept: it follows each project's own. */
export interface ExportPrefs {
  quick: boolean; resolution: Resolution; quality: 'standard' | 'high';
  /** Saved under a new name: every earlier export stored the old default, on, and a file then sounded unlike the preview (audit V-247). */
  evenLoudness: boolean;
}
const PREFS_KEY = 'kadr.exportPrefs';
export function exportPrefs(): ExportPrefs {
  const base: ExportPrefs = { quick: true, resolution: 1080, quality: 'high', evenLoudness: false };
  try { return { ...base, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ExportPrefs>) }; } catch { return base; }
}
export function savePrefs(p: ExportPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage off: defaults next time */ }
}

/** The Export button: with quick export on, the sheet starts rendering at once. */
export function startExport(): void {
  useEditor.setState({ startAuto: exportPrefs().quick });
  useEditor.getState().openSheet('export');
}
