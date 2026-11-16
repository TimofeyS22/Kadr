// The export sheet's remembered choices and the Export button: the editor shows the button before the sheets are loaded.
import { exportDefaults } from '../core/exportDefaults';
import type { Project } from '../core/types';
import type { Resolution } from '../engine/exportSizes';
import { useEditor } from '../state/store';

/** The frame rate is not kept: it follows each project's own, or its videos (see core/exportDefaults). */
export interface ExportPrefs {
  quick: boolean; quality: 'standard' | 'high';
  /**
   * The size picked by hand in the sheet, when it is not the one the video would get anyway; absent until then. It
   * holds the next exports down to it and never up (`exportDefaults` says why). Saved under a new name: every earlier
   * export stored `resolution`, picked or not, mostly the old default of 1080p, which as a wish would keep a 4K video
   * at 1080p for good (audit V-216).
   */
  size?: Resolution;
  /** Saved under a new name: every earlier export stored the old default, on, and a file then sounded unlike the preview (audit V-247). */
  evenLoudness: boolean;
}
const PREFS_KEY = 'kadr.exportPrefs';
export function exportPrefs(): ExportPrefs {
  const base: ExportPrefs = { quick: true, quality: 'high', evenLoudness: false };
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

let atSize = false;
/** Whether the sheet was opened by the header's size: then it shows the sizes first (the art director, UI-2). Read once. */
export function openedAtSize(): boolean { const v = atSize; atSize = false; return v; }

/** The settings first, nothing rendered yet: the size and the rest are changed before an export, not after it started (audit UI-2). */
export function openExportSettings(): void {
  atSize = true;
  useEditor.setState({ startAuto: false });
  useEditor.getState().openSheet('export');
}

const ALL_SIZES: readonly Resolution[] = [720, 1080, 1440, 2160];
/** How a size is named, in the sheet and in the header alike. */
export const SIZE_NAME: Record<Resolution, string> = { 720: '720p', 1080: '1080p', 1440: '2K', 2160: '4K' };
let told: { shape: string; sizes: readonly Resolution[] } | null = null;
const shapeOf = (p: Project) => `${p.settings.width}x${p.settings.height}`;

/** What the export sheet learnt about this device's encoder for a frame shape: the header then names a size it can make. */
export function rememberSizes(p: Project, sizes: readonly Resolution[]): void {
  told = { shape: shapeOf(p), sizes };
}

/**
 * The size a tap on «Экспорт» makes, as the header says it (UI-2): the sheet's own start (`exportDefaults` — up to 1080p,
 * never above the video, held down by a size picked before), with the sizes the device takes once the sheet asked it.
 * Until then all four: asking the encoder on every visit to the editor is a trial encode on some browsers.
 */
export function exportSizeLabel(p: Project): string {
  const sizes = told?.shape === shapeOf(p) ? told.sizes : ALL_SIZES;
  const r = exportDefaults(p, sizes, [], exportPrefs().size).resolution;
  return r === undefined ? '' : SIZE_NAME[r];
}
