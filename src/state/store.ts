import { produce } from 'immer';
import { create } from 'zustand';
import { findClip } from '../core/timeline';
import type { Project } from '../core/types';
import { entryFor, logError, takeNoted, type ErrorEntry } from '../lib/errorLog';
import { reloadPending, updatingMessage } from '../lib/update';

export type SheetId =
  | 'speed' | 'volume' | 'adjust' | 'filters' | 'transform' | 'text' | 'transition' | 'canvas' | 'export'
  | 'crop' | 'captions' | 'captionEdit' | 'voiceover' | 'stickers' | 'pauses' | 'mask' | 'sfx' | 'beats' | 'effects' | 'privacy' | 'camera' | 'music' | 'reel' | 'chroma' | 'voice' | 'layers' | 'iosFormat';

/** `detail`: what an error toast offers under "Details" (lib/errorLog.ts); `kept`: opened, so it stays until closed. */
export interface Toast { id: number; text: string; kind: 'info' | 'error'; detail?: ErrorEntry; kept?: boolean }
/** A long on-device job (reverse, cutout model load…) shown as a progress bar with Cancel. */
export interface Busy { label: string; progress: number | null; cancel?: () => void }

const HISTORY_LIMIT = 500; // audit V-134: steps share everything they did not change, so a long session costs little
const COALESCE_MS = 1200;

export interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  histKey: string | null;
  histAt: number;
  selection: string | null;
  /** Multi-select mode (v0.6): ids of the picked clips, or null when the mode is off. */
  multi: string[] | null;
  /** Clip whose incoming transition the transition sheet edits. */
  transitionFor: string | null;
  sheet: SheetId | null;
  /** Task to start once the next project loads (home card, deep link, share target), see ui/tasks.ts. */
  startTask: import('../core/taskIds').TaskId | null;
  /** The sheet that opens should run by itself (the reel). */
  startAuto: boolean;
  time: number;
  playing: boolean;
  /** Timeline zoom, px per second. */
  zoom: number;
  /** Show TikTok/Reels/Shorts interface safe zones over the preview. */
  safeZones: boolean;
  busy: Busy | null;
  toasts: Toast[];
  /**
   * The eyedropper (v1.6): while set, a touch on the preview picks the colour under the finger and hands it to `pick`.
   * `owner` is the colour row that asked, so it can show itself on and switch the eyedropper off when it closes.
   */
  eyedropper: { pick: (color: string) => void; owner: object; /** the project to read colours from, if not the one on screen */ from?: () => Project | null } | null;
  /** Another tab saved this project after this one loaded it (audit V-258): saving here waits for the person's choice. */
  elsewhere: boolean;
  /** This project was deleted in another tab or window, with its media (search S-1-1): nothing here is saved any more. */
  gone: boolean;
  /** Whether the edits on screen are on the disk, said in the header (Chetko Ч4 release 3): `pending` while an edit
   *  waits for its write, `failed` after a write that did not get through and until one does. */
  saving: 'saved' | 'pending' | 'failed';
  /** Counts `open` calls: a project put on screen by `open` is not an edit to save. */
  session: number;

  open(p: Project): void;
  close(): void;
  /**
   * Applies an edit with undo support. Edits sharing `key` within a short window form one undo step
   * (slider drags, gestures). `base` re-applies the edit to a snapshot taken at gesture start.
   */
  commit(fn: (d: Project) => void, key?: string, base?: Project): void;
  /** Updates the project without a history step: for results of background work (processed sound), not user edits. */
  amend(fn: (d: Project) => void): void;
  undo(): void;
  redo(): void;
  select(id: string | null): void;
  setMulti(ids: string[] | null): void;
  toggleMulti(id: string): void;
  openSheet(s: SheetId | null, transitionFor?: string): void;
  /** What closing the open sheet would lose, in words; the first attempt says it, a second one closes. */
  sheetGuard: string | null;
  /** An export is running: it renders the project as it was when it began, so nothing may look as if it changed it. */
  locked: boolean;
  /** Whether what the open sheet holds may be left (closed, or a step back inside it): false the first time a guard is up,
   *  when it says what would be lost; a second attempt within a few seconds means it. */
  leaveSheet(): boolean;
  /** The person closes the sheet (Done, a swipe, Esc): false when it stayed open to say what would be lost. */
  closeSheet(): boolean;
  setTime(t: number): void;
  setPlaying(b: boolean): void;
  setZoom(z: number): void;
  toast(text: string, kind?: Toast['kind'], ms?: number): void;
  dismiss(id: number): void;
  /** Keeps a toast on screen (its details are open). */
  keep(id: number): void;
  /** The history steps made since `before` was the project become one (a drag across the colour spectrum). */
  squash(before: Project): void;
}

let toastId = 0;
/** A second attempt within this long of the warning means it (see leaveSheet). */
const GUARD_MS = 4000;
let warnedAt = -Infinity;

const validSelection = (p: Project | null, id: string | null) => (p && id && findClip(p, id) ? id : null);

export const useEditor = create<EditorState>()((set, get) => ({
  project: null,
  past: [],
  future: [],
  histKey: null,
  histAt: 0,
  multi: null,
  selection: null,
  transitionFor: null,
  sheet: null,
  startTask: null,
  startAuto: false,
  time: 0,
  playing: false,
  zoom: 60,
  safeZones: false,
  busy: null,
  toasts: [],
  eyedropper: null,
  elsewhere: false,
  gone: false,
  saving: 'saved',
  session: 0,

  open: (p) => set((s) => ({ project: p, past: [], future: [], histKey: null, selection: null, multi: null, sheet: null, time: 0, playing: false, eyedropper: null, elsewhere: false, gone: false, saving: 'saved', session: s.session + 1 })),
  close: () => set({ project: null, past: [], future: [], selection: null, multi: null, sheet: null, playing: false, eyedropper: null, elsewhere: false, gone: false }),

  commit(fn, key, base) {
    const s = get();
    if (!s.project) return;
    const from = base ?? s.project;
    const next = produce(from, fn);
    if (next === s.project) return;
    const now = Date.now();
    const coalesce = key !== undefined && key === s.histKey && now - s.histAt < COALESCE_MS;
    set({
      project: next,
      past: coalesce ? s.past : [...s.past.slice(-(HISTORY_LIMIT - 1)), s.project],
      future: [],
      histKey: key ?? null,
      histAt: now,
      selection: validSelection(next, s.selection),
    });
  },
  amend(fn) {
    const s = get();
    if (!s.project) return;
    const next = produce(s.project, fn);
    if (next !== s.project) set({ project: next, histKey: null });
  },
  undo() {
    const s = get();
    const prev = s.past.at(-1);
    if (!prev || !s.project || s.locked) return;
    set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], histKey: null, selection: validSelection(prev, s.selection) });
  },
  redo() {
    const s = get();
    const next = s.future[0];
    if (!next || !s.project || s.locked) return;
    set({ project: next, past: [...s.past, s.project], future: s.future.slice(1), histKey: null, selection: validSelection(next, s.selection) });
  },
  select: (id) => set((s) => ({ selection: id, sheet: id === s.selection ? s.sheet : null })),
  setMulti: (ids) => set({ multi: ids, sheet: null }),
  toggleMulti: (id) => set((s) => ({ multi: s.multi?.includes(id) ? s.multi.filter((x) => x !== id) : [...(s.multi ?? []), id] })),
  openSheet: (sheet, transitionFor) => set({ sheet, transitionFor: transitionFor ?? null }),
  sheetGuard: null,
  locked: false,
  leaveSheet: () => {
    const guard = get().sheetGuard;
    if (guard && performance.now() - warnedAt > GUARD_MS) {
      warnedAt = performance.now();
      get().toast(guard);
      return false;
    }
    warnedAt = -Infinity;
    return true;
  },
  closeSheet: () => {
    if (!get().leaveSheet()) return false;
    // A field still in focus saves on blur, and an element taken away never blurs: a corrected line was lost (audit V-217).
    (document.activeElement as HTMLElement | null)?.blur?.();
    set({ sheet: null, transitionFor: null });
    return true;
  },
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => set({ zoom: Math.min(600, Math.max(8, zoom)) }),
  toast(text, kind = 'info', ms) {
    // The page is reloading into a new version (lib/update.ts): what failed on the way is that, not a fault to report.
    if (kind === 'error' && reloadPending()) { text = updatingMessage(); kind = 'info'; }
    // The same message twice is one toast: a failing preview frame used to stack the same error on every render.
    if (get().toasts.some((x) => x.text === text && x.kind === kind)) { if (kind === 'error') takeNoted(); return; }
    const id = ++toastId;
    // The error behind the text (noted by errorMessage) is kept on this device and offered under "Details".
    const cause = kind === 'error' ? takeNoted() : null;
    const detail = cause ? entryFor(cause.e, get().sheet ?? (get().project ? 'editor' : 'home')) : undefined;
    if (detail) void logError(detail);
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind, detail }] }));
    setTimeout(() => { if (!get().toasts.find((x) => x.id === id)?.kept) get().dismiss(id); }, ms ?? (kind === 'error' ? 6000 : 3000));
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  keep: (id) => set((s) => ({ toasts: s.toasts.map((x) => (x.id === id ? { ...x, kept: true } : x)) })),
  squash(before) {
    const s = get();
    const i = s.past.lastIndexOf(before);
    if (i >= 0 && i < s.past.length - 1) set({ past: s.past.slice(0, i + 1), histKey: null });
  },
}));

export const editor = () => useEditor.getState();
