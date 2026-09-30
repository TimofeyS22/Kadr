import { produce } from 'immer';
import { create } from 'zustand';
import { findClip } from '../core/timeline';
import type { Project } from '../core/types';

export type SheetId =
  | 'speed' | 'volume' | 'adjust' | 'filters' | 'transform' | 'text' | 'transition' | 'canvas' | 'export'
  | 'crop' | 'captions' | 'captionEdit' | 'voiceover' | 'stickers' | 'pauses' | 'mask' | 'sfx' | 'beats';

export interface Toast { id: number; text: string; kind: 'info' | 'error' }
/** A long on-device job (reverse, cutout model load…) shown as a progress bar with Cancel. */
export interface Busy { label: string; progress: number | null; cancel?: () => void }

const HISTORY_LIMIT = 100;
const COALESCE_MS = 1200;

export interface EditorState {
  project: Project | null;
  past: Project[];
  future: Project[];
  histKey: string | null;
  histAt: number;
  selection: string | null;
  /** Clip whose incoming transition the transition sheet edits. */
  transitionFor: string | null;
  sheet: SheetId | null;
  time: number;
  playing: boolean;
  /** Timeline zoom, px per second. */
  zoom: number;
  /** Show TikTok/Reels/Shorts interface safe zones over the preview. */
  safeZones: boolean;
  busy: Busy | null;
  toasts: Toast[];

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
  openSheet(s: SheetId | null, transitionFor?: string): void;
  setTime(t: number): void;
  setPlaying(b: boolean): void;
  setZoom(z: number): void;
  toast(text: string, kind?: Toast['kind']): void;
  dismiss(id: number): void;
}

let toastId = 0;

const validSelection = (p: Project | null, id: string | null) => (p && id && findClip(p, id) ? id : null);

export const useEditor = create<EditorState>()((set, get) => ({
  project: null,
  past: [],
  future: [],
  histKey: null,
  histAt: 0,
  selection: null,
  transitionFor: null,
  sheet: null,
  time: 0,
  playing: false,
  zoom: 60,
  safeZones: false,
  busy: null,
  toasts: [],

  open: (p) => set({ project: p, past: [], future: [], histKey: null, selection: null, sheet: null, time: 0, playing: false }),
  close: () => set({ project: null, past: [], future: [], selection: null, sheet: null, playing: false }),

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
    if (!prev || !s.project) return;
    set({ project: prev, past: s.past.slice(0, -1), future: [s.project, ...s.future], histKey: null, selection: validSelection(prev, s.selection) });
  },
  redo() {
    const s = get();
    const next = s.future[0];
    if (!next || !s.project) return;
    set({ project: next, past: [...s.past, s.project], future: s.future.slice(1), histKey: null, selection: validSelection(next, s.selection) });
  },
  select: (id) => set((s) => ({ selection: id, sheet: id === s.selection ? s.sheet : null })),
  openSheet: (sheet, transitionFor) => set({ sheet, transitionFor: transitionFor ?? null }),
  setTime: (time) => set({ time }),
  setPlaying: (playing) => set({ playing }),
  setZoom: (zoom) => set({ zoom: Math.min(600, Math.max(8, zoom)) }),
  toast(text, kind = 'info') {
    const id = ++toastId;
    set((s) => ({ toasts: [...s.toasts.slice(-2), { id, text, kind }] }));
    setTimeout(() => get().dismiss(id), kind === 'error' ? 6000 : 3000);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

export const editor = () => useEditor.getState();
