import { produce } from 'immer';
import { Check, ChevronLeft, Pause, Play, Redo2, Smartphone, Undo2, Upload } from 'lucide-react';
import { Suspense, lazy, useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { runStartTask } from './tasks';
import { normalizeProject, projectDuration, withUsedAssets } from '../core/timeline';
import type { Project } from '../core/types';
import { player } from '../engine/player';
import { errorMessage, track } from '../lib/telemetry';
import { useEditor } from '../state/store';
import { ProjectConflict, ProjectDeleted, clearJournal, deleteBlob, deleteTake, forgetLoadedMedia, unfinishedTakes, forgetProject, journalProject, loadProject, onDeletedElsewhere, onSavedElsewhere, saveProject } from '../storage/db';
import { startExport } from './exportPrefs';
import { forgetThumbs, probe } from '../engine/media';
import { addFiles, deleteMulti, deleteSelected, duplicateMulti, duplicateSelected, splitAtPlayhead, outdatedSoundClips, prepareStaleSounds, withBusy } from './actions';
import { formatTime } from './format';
import { Preview } from './Preview';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import { PerfOverlay, perfOverlayEnabled } from './PerfOverlay';

const showPerf = perfOverlayEnabled();
import { t } from '../lib/i18n';
// Chetko, stage Ч4 release 3 (docs/17): the frame of the editor on the components of the system. The frame, the
// timeline and the tool sheets come later; `topbar`, `transport`, `time`, `play-btn`, `busy` and `coach` stay as hooks.
import './ck/ck.css';
import './editor.css';
import { Button, IconButton, Progress } from './ck/controls';
import { Empty } from './ck/home';
import { Transport as Row } from './ck/timeline';

// Fetched as the editor mounts, not before it can be used: the editor's first load is the budget that counts (audit V-143).
const Sheets = lazy(() => import('./sheets').then((m) => ({ default: m.Sheets })));

const snapshot = () => Promise.race([player.snapshot(), new Promise<null>((r) => setTimeout(() => r(null), 800))]);

/** After a failed autosave, the next try comes this soon. */
const SAVE_RETRY_MS = 4000;
/** However many edits follow one another, the first of them is on disk within this long. */
const SAVE_MAX_WAIT_MS = 2500;
/**
 * Every edit is in the journal (localStorage, written at once) this soon at most (S-1-2). A tab killed in the moment
 * after an edit — memory taken back, a crash: no pagehide comes — lost that edit, since the journal was written only
 * when the page was hidden. An edit after a quiet moment is journaled as it is made; in a quick run of them the newest
 * waits this long, so a slider dragged across does not serialize the project sixty times a second.
 */
const JOURNAL_MS = 200;
const UNDO_MOVED_KEY = 'kadr.undoMoved.v1';

export async function leaveEditor(): Promise<void> {
  if (useEditor.getState().sheetGuard && !useEditor.getState().closeSheet()) return; // an export or a file not saved yet
  player.pause();
  const p = useEditor.getState().project;
  // Deleted in another tab: there is nothing to save it to, and saving would bring it back without its media (S-1-1).
  if (p && !useEditor.getState().gone) {
    // Never close over unsaved work (v1.4.3: this error used to be swallowed): without the thumbnail, then give up loudly.
    // Changed in another tab: the person chooses first (ConflictNotice), nothing is written over.
    if (useEditor.getState().elsewhere) return;
    const failed = (e: unknown) => {
      if (e instanceof ProjectConflict) useEditor.setState({ elsewhere: true });
      else if (e instanceof ProjectDeleted) useEditor.setState({ gone: true, saving: 'failed' });
      else useEditor.getState().toast(t('Could not save: {error}', { error: errorMessage(e) }), 'error');
      return false;
    };
    const told = (e: unknown) => e instanceof ProjectConflict || e instanceof ProjectDeleted;
    const saved = await saveProject(p, (await snapshot()) ?? undefined).then(() => true, (e) => (told(e) ? failed(e) : saveProject(p).then(() => true, failed)));
    if (!saved) return;
  }
  if (p) forgetProject(p.id);
  useEditor.getState().close();
  location.hash = '';
}

export function Editor({ id }: { id: string }) {
  const project = useEditor((s) => s.project);
  const sheetOpen = useEditor((s) => s.sheet !== null);
  const [missing, setMissing] = useState(false);
  const [dragging, setDragging] = useState(false);
  // Undo and Redo moved under the frame (owner, 2026-11-10): said once, where they were, to who worked here before (Ж1).
  const [undoMovedSeen, setUndoMovedSeen] = useState(() => {
    try {
      if (localStorage.getItem(UNDO_MOVED_KEY) !== null) return true;
      if (localStorage.getItem('kadr.tips') !== null) return false; // has been in the editor: knew the old place
      localStorage.setItem(UNDO_MOVED_KEY, '1'); // the first visit never saw them at the top
      return true;
    } catch { return true; }
  });
  // Shown for one visit to the editor: leaving counts as having seen it, so it never follows the person around.
  useEffect(() => {
    if (undoMovedSeen) return;
    return () => { try { localStorage.setItem(UNDO_MOVED_KEY, '1'); } catch { /* said again next time */ } };
  }, [undoMovedSeen]);
  const undoMovedFound = () => {
    if (undoMovedSeen) return;
    try { localStorage.setItem(UNDO_MOVED_KEY, '1'); } catch { /* said again next time */ }
    setUndoMovedSeen(true);
  };

  // However the editor is left (the system Back too), nothing of this project stays for the next one to write into.
  useEffect(() => () => {
    useEditor.getState().close();
    forgetLoadedMedia();
    forgetThumbs();
  }, []);

  useEffect(() => {
    let alive = true;
    loadProject(id).then((p) => {
      if (!alive) return;
      if (!p) { setMissing(true); return; }
      const q = withUsedAssets(p);
      // Media no clip reaches any more (deleted from the project; undo does not outlive the session) leaves the device.
      for (const old of Object.keys(p.assets)) if (!q.assets[old]) void deleteBlob(old).catch(() => undefined);
      useEditor.getState().open(produce(q, (d) => { normalizeProject(d); }));
      const task = useEditor.getState().startTask;
      if (task) { useEditor.setState({ startTask: null }); runStartTask(task); }
      // Sound processed before v1.2.1 was ~44 ms behind the picture: rebuild it once, so nothing drifts or goes missing.
      const outdated = outdatedSoundClips(useEditor.getState().project!);
      if (outdated.length) {
        track('sound_resync', { clips: outdated.length });
        void withBusy(t('Fine-tuning the sound sync…'), (progress, signal) => prepareStaleSounds(progress, signal));
      }
      // The user's own fonts: register, then redraw text that may have used a fallback meanwhile.
      if (p.fonts) void import('../engine/customFonts').then((m) => m.registerProjectFonts(p)).then(() => { player.text.clear(); player.requestRender(); });
      // A recording a crash interrupted: what reached the disk goes into the project.
      void unfinishedTakes(p.id).then(async (takes) => {
        for (const take of takes) {
          const ext = take.blob.type.includes('mp4') ? 'mp4' : 'webm';
          const file = new File([take.blob], `${t('Camera')} (${t('restored')}).${ext}`, { type: take.blob.type || 'video/webm' });
          // Cut off before its first complete part, a take cannot be read at all: nothing to bring back, nothing to say.
          if (!await probe(file).then(() => true, () => false)) { await deleteTake(p.id, take.id); continue; }
          if (await addFiles([file], 'main')) {
            await deleteTake(p.id, take.id);
            useEditor.getState().toast(t('A camera recording that was cut short is back in the project.'));
          }
        }
      }).catch((e) => console.warn('could not bring back a camera take', e));
      track('project_opened', { clips: p.tracks.reduce((n, t) => n + t.clips.length, 0) });
    }).catch((e) => { useEditor.getState().toast(errorMessage(e), 'error'); setMissing(true); }); // not "Opening…" for ever
    return () => { alive = false; };
  }, [id]);

  // Player ↔ store wiring.
  useEffect(() => {
    player.onTick = (t) => useEditor.setState({ time: t });
    player.onPlayingChange = (playing) => useEditor.setState({ playing, time: player.time });
    player.onError = (e) => useEditor.getState().toast(errorMessage(e), 'error');
    player.setProject(useEditor.getState().project);
    const unsub = useEditor.subscribe((s, prev) => { if (s.project !== prev.project) player.setProject(s.project); });
    return () => { unsub(); player.setProject(null); };
  }, []);

  // Debounced autosave; flush when the page is hidden (mobile browsers may kill background tabs).
  useEffect(() => {
    let timer = 0;
    let pending: Project | null = null;
    let firstEdit = 0;
    // Hiding: the page may be gone before IndexedDB finishes, so the edits are also journaled synchronously (v1.4.3).
    // A save that failed while the page was hidden (WebKit drops IndexedDB in the background) is made again when the
    // page is back, and said only if that fails too; before, the edit waited for the next one (audit V-120).
    let retried = false;
    // A save that failed with the page in view is tried again on its own: the edits stayed on screen while nothing wrote
    // them, and the reload lost them (audit V-185). Said once, and again only when it does get through.
    let failing = false;
    /** The version being written right now: if the page hides meanwhile, it may never get there. */
    let writing: { p: Project } | null = null;
    /** The newest version in the journal; it is dropped once that very version is on the disk. */
    let journaled: { p: Project; seq: number } | null = null;
    let journalTimer = 0;
    let lastJournal = -Infinity;
    const journal = (p: Project) => {
      clearTimeout(journalTimer);
      if (journaled?.p === p) return;
      lastJournal = performance.now();
      journaled = { p, seq: journalProject(p) };
    };
    /** The newest edit into the journal: at once after a quiet moment, else when JOURNAL_MS have passed. */
    const keep = () => {
      clearTimeout(journalTimer);
      const p = pending ?? writing?.p; // the trailing write may come after the save started: that version, then
      if (!p || journaled?.p === p) return;
      const wait = lastJournal + JOURNAL_MS - performance.now();
      if (wait > 0) journalTimer = window.setTimeout(keep, wait);
      else journal(p);
    };
    /** What the header says: only a change of it is set, so a write does not re-render who listens. */
    const saying = (to: 'saved' | 'pending' | 'failed') => { if (useEditor.getState().saving !== to) useEditor.setState({ saving: to }); };
    const flush = (hiding = false) => {
      clearTimeout(timer);
      if (useEditor.getState().elsewhere) return; // changed in another tab: the person chooses first
      if (useEditor.getState().gone) { pending = null; return; } // deleted in another tab: nothing to save it to
      if (!pending) {
        if (hiding && writing) journal(writing.p);
        return;
      }
      const p = pending;
      pending = null;
      if (hiding) journal(p);
      const job = { p };
      writing = job;
      if (!failing) saying('pending'); // the header counts from here: a write, not the wait before it
      saveProject(p).then(
        () => {
          if (writing === job) writing = null;
          retried = false;
          // On the disk now: its journal goes, unless a newer edit is already in it (that one goes with its own save).
          if (journaled?.p === p) { if (journaled.seq) clearJournal(p.id, journaled.seq); journaled = null; }
          // A newer edit journaled while this one was written was based on the revision before: it is written again on
          // this one, or the next opening would take it for a journal made on an older version and drop it.
          else if (journaled) journaled = { p: journaled.p, seq: journalProject(journaled.p) };
          if (failing) { failing = false; useEditor.getState().toast(t('Your changes are saved.')); }
          if (!pending) saying('saved');
        },
        (e) => {
          if (writing === job) writing = null;
          pending ??= p; // a newer edit holds this one too
          if (e instanceof ProjectConflict) { useEditor.setState({ elsewhere: true }); saying('failed'); return; }
          if (e instanceof ProjectDeleted) { useEditor.setState({ gone: true, saving: 'failed' }); pending = null; return; }
          if (document.visibilityState === 'hidden' && !retried) { retried = true; return; }
          retried = false;
          if (!failing) useEditor.getState().toast(t('Could not save: {error}', { error: errorMessage(e) }), 'error');
          failing = true;
          saying('failed');
          clearTimeout(timer);
          timer = window.setTimeout(flush, SAVE_RETRY_MS);
        },
      );
    };
    const onPageHide = () => flush(true);
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.session !== prev.session) { pending = null; journaled = null; clearTimeout(timer); clearTimeout(journalTimer); return; } // opened, not edited
      if (!s.project || !prev.project || s.project === prev.project) return;
      // Edits in a row put the save off, and a crash took all of them: 78 edits over 30 s were never written (audit V-109).
      if (!pending) firstEdit = performance.now();
      pending = s.project;
      keep(); // in the journal before the save: a tab killed now keeps this edit (S-1-2)
      clearTimeout(timer);
      timer = window.setTimeout(flush, Math.min(600, Math.max(0, firstEdit + SAVE_MAX_WAIT_MS - performance.now())));
    });
    const unsubTabs = onSavedElsewhere((pid) => { if (pid === useEditor.getState().project?.id) useEditor.setState({ elsewhere: true }); });
    const unsubGone = onDeletedElsewhere((pid) => { if (pid === useEditor.getState().project?.id) useEditor.setState({ gone: true, saving: 'failed' }); });
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); else if (pending) flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => { unsub(); unsubTabs(); unsubGone(); flush(); clearTimeout(journalTimer); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      const s = useEditor.getState();
      if (e.key === 'Escape') { if (s.closeSheet()) s.select(null); return; } // from a field or a slider in a sheet too
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable) return; // the s in a list must not cut the video (audit V-186)
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if ((key === ' ' || key === 'enter') && el.closest('button, a, [role="button"]')) return; // the control's own key: Space on Undo undoes
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); if (s.multi) duplicateMulti(); else duplicateSelected(); return; }
      if (mod) return;
      if (key === ' ') { e.preventDefault(); player.toggle(); }
      else if (key === 's') splitAtPlayhead();
      else if (key === 'delete' || key === 'backspace') { if (s.multi) deleteMulti(); else deleteSelected(); }
      else if (key === 'arrowleft' || key === 'arrowright') {
        e.preventDefault();
        const step = e.shiftKey ? 1 : 1 / (s.project?.settings.fps ?? 30);
        player.pause();
        player.seek(player.time + (key === 'arrowleft' ? -step : step));
        useEditor.setState({ time: player.time });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (missing) {
    return (
      <div className="center-msg ck-center">
        <div className="ck">
          <Empty title={t('This project is not on this device.')}
            action={<Button variant="primary" size="large" onClick={() => { location.hash = ''; }}>{t('Back to projects')}</Button>}>
            {t('Projects live in the browser they were made in. It may have been deleted, or made in another browser or on another device.')}
          </Empty>
        </div>
      </div>
    );
  }
  if (!project) return <div className="center-msg ck-center"><p>{t('Opening…')}</p></div>;

  return (
    <div
      className={`editor ck-editor ${sheetOpen ? 'sheet-open' : ''}`}
      data-sheet={sheetOpen || undefined}
      onDragOver={(e) => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); setDragging(true); } }}
      onDragLeave={(e) => { if (e.currentTarget === e.target) setDragging(false); }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        const audio = files.filter((f) => f.type.startsWith('audio/'));
        void addFiles(files.filter((f) => !audio.includes(f)), 'main').then(() => addFiles(audio, 'audio'));
      }}
    >
      <TopBar project={project} moved={!undoMovedSeen && !sheetOpen} onMovedSeen={undoMovedFound} />
      <Preview />
      <Transport onUsed={undoMovedFound} />
      <Timeline />
      {showPerf && <PerfOverlay />}
      <Toolbar />
      <Suspense fallback={null}><Sheets /></Suspense>
      <BusyOverlay />
      <ElsewhereNotice />
      <Coach hold={!undoMovedSeen} />
      {dragging && <div className="drop-hint ck-drop">{t('Drop videos, photos or music to add them')}</div>}
    </div>
  );
}

/** Whether the work is on the disk: «сохранено»; «сохраняю…» only when a write takes over a second, so it never flickers. */
function Saved({ id }: { id: string }) {
  const saving = useEditor((s) => s.saving);
  const [state, setState] = useState<'saved' | 'pending' | 'failed'>('saved');
  const since = useRef(-Infinity); // when «сохраняю…» came up: it stays long enough to be read
  useEffect(() => {
    if (saving === 'failed') { setState('failed'); return; }
    const timer = saving === 'pending'
      ? setTimeout(() => { since.current = performance.now(); setState('pending'); }, 1000)
      : setTimeout(() => setState('saved'), Math.max(0, since.current + 600 - performance.now()));
    return () => clearTimeout(timer);
  }, [saving]);
  return (
    <span id={id} className="ck-editor-saved" data-state={state}>
      {state === 'saved' && <Check aria-hidden />}
      {state === 'failed' ? t('not saved') : state === 'pending' ? t('saving…') : t('saved')}
    </span>
  );
}

function TopBar({ project, moved, onMovedSeen }: { project: Project; moved: boolean; onMovedSeen: () => void }) {
  const s = useEditor.getState();
  const id = useId();
  return (
    <header className="ck ck-editor-top topbar">
      <IconButton label={t('Back to projects')} onClick={() => void leaveEditor()}><ChevronLeft aria-hidden /></IconButton>
      <div className="ck-editor-title">
        <input className="ck-editor-name" value={project.name} maxLength={80} aria-label={t('Project name')} aria-describedby={`${id}-saved`}
          enterKeyHint="done" autoComplete="off" onChange={(e) => s.commit((d) => { d.name = e.target.value; }, 'name')}
          onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }} />
        <Saved id={`${id}-saved`} />
      </div>
      <Button variant="primary" icon={<Upload aria-hidden />} disabled={projectDuration(project) <= 0} onClick={startExport}>{t('Export')}</Button>
      {moved && (
        <div className="ck-editor-moved" role="note">
          <p>{t('“Undo” and “Redo” are now under the frame ↓')}</p>
          <Button onClick={onMovedSeen}>{t('Got it')}</Button>
        </div>
      )}
    </header>
  );
}

/** Under the frame: Undo and Redo by the thumb (owner, 2026-11-10), play, the time, the safe zones. */
function Transport({ onUsed }: { onUsed: () => void }) {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const locked = useEditor((s) => s.locked);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 0));
  const safeZones = useEditor((s) => s.safeZones);
  const canUndo = useEditor((s) => s.past.length > 0 && !s.locked);
  const canRedo = useEditor((s) => s.future.length > 0 && !s.locked);
  const s = useEditor.getState();
  return (
    <Row hooks={{ row: 'transport', play: 'play-btn', time: 'time' }} playing={playing} onPlay={() => player.toggle()} disabled={locked || duration <= 0}
      playLabel={t('Play')} pauseLabel={t('Pause')} playIcon={<Play aria-hidden />} pauseIcon={<Pause aria-hidden />}
      time={formatTime(time)} total={formatTime(duration)}
      start={<>
        <IconButton label={t('Undo')} disabled={!canUndo} onClick={() => { onUsed(); s.undo(); }}><Undo2 aria-hidden /></IconButton>
        <IconButton label={t('Redo')} disabled={!canRedo} onClick={() => { onUsed(); s.redo(); }}><Redo2 aria-hidden /></IconButton>
      </>}
      end={<IconButton label={t('Show TikTok, Reels and Shorts safe zones')} aria-pressed={safeZones} onClick={() => useEditor.setState({ safeZones: !safeZones })}><Smartphone aria-hidden /></IconButton>} />
  );
}

/**
 * A card the editor waits on, over all of it: a native modal dialog, so the focus is inside, Tab stays there and the
 * editor under the veil is out of reach of a finger, the keyboard and a screen reader (audit of Ч4 release 3). The focus
 * goes to `focus` (the way out) or to the card, and back to where it was when the card goes.
 */
function Veil({ label, alert, focus, onEscape, children }: { label: string; alert?: boolean; focus?: RefObject<HTMLButtonElement | null>; onEscape?: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const escape = useRef(onEscape);
  escape.current = onEscape;
  const first = useRef(focus); // where the focus goes when the card comes; a button that turns up later does not take it
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!d.open) d.showModal();
    (first.current?.current ?? d).focus({ preventScroll: true });
    return () => { if (d.open) d.close(); if (back?.isConnected) back.focus({ preventScroll: true }); };
  }, []);
  return (
    <dialog ref={ref} className="ck ck-editor-veil busy" role={alert ? 'alertdialog' : undefined} aria-labelledby={label} tabIndex={-1}
      onCancel={(e) => { e.preventDefault(); escape.current?.(); }}>
      <div className="ck-editor-card">{children}</div>
    </dialog>
  );
}

function BusyOverlay() {
  const busy = useEditor((s) => s.busy);
  return busy ? <BusyCard /> : null;
}

function BusyCard() {
  const busy = useEditor((s) => s.busy);
  const id = useId();
  const cancel = useRef<HTMLButtonElement>(null);
  const hasCancel = !!busy?.cancel;
  if (!busy) return null;
  return (
    <Veil label={id} focus={hasCancel ? cancel : undefined} onEscape={busy.cancel}>
      {/* What is being done, said again when it changes («Добавляю 2 из 3…»). */}
      <p id={id} aria-live="polite">{busy.label}</p>
      {/* How far, in a number when it is known (principle 6); the bar says it to a screen reader, the number is for the eye. */}
      {busy.progress === null ? <div className="ck-editor-wait ck-held" aria-hidden><i /></div> : (
        <div className="ck-editor-progress">
          <Progress label={t('Progress')} value={busy.progress} />
          <span className="ck-editor-pct" aria-hidden>{Math.round(busy.progress * 100)}%</span>
        </div>
      )}
      {busy.cancel && <Button ref={cancel} onClick={busy.cancel}>{t('Cancel')}</Button>}
    </Veil>
  );
}

/**
 * The project was saved in another tab after this one opened it (audit V-258). Before, the last tab to save won and
 * the other tab's edits were gone with no word. Saving here waits until the person picks a version.
 */
function ElsewhereNotice() {
  const on = useEditor((s) => s.elsewhere);
  const gone = useEditor((s) => s.gone);
  return gone ? <GoneCard /> : on ? <ElsewhereCard /> : null;
}

/**
 * The project was deleted in another tab or window (search S-1-1). Before, this tab went on saying "saved", its next edit
 * wrote the project back without its media, and the export failed: the delete the person confirmed was undone.
 */
function GoneCard() {
  const back = useRef<HTMLButtonElement>(null);
  return (
    <Veil label="gone-title" alert focus={back}>
      <h2 id="gone-title">{t('This project was deleted')}</h2>
      <p>{t('It was deleted in another tab or window, together with its media. Edits made here can no longer be saved.')}</p>
      <Button ref={back} variant="primary" onClick={() => void leaveEditor()}>{t('Back to projects')}</Button>
    </Veil>
  );
}

function ElsewhereCard() {
  const [working, setWorking] = useState(false);
  const newer = useRef<HTMLButtonElement>(null);
  const run = (fn: () => Promise<void>) => {
    setWorking(true);
    void fn().catch((e) => useEditor.getState().toast(errorMessage(e), 'error')).finally(() => setWorking(false));
  };
  const fresh = () => run(async () => {
    const s = useEditor.getState();
    const p = s.project && await loadProject(s.project.id);
    if (!p) { useEditor.setState({ elsewhere: false, gone: true, saving: 'failed' }); return; } // deleted since
    s.open(produce(p, (d) => { normalizeProject(d); }));
    track('tab_conflict', { choice: 'theirs' });
  });
  const mine = () => run(async () => {
    const p = useEditor.getState().project;
    if (!p) return;
    try { await saveProject(p, undefined, true); }
    catch (e) { if (e instanceof ProjectDeleted) { useEditor.setState({ elsewhere: false, gone: true, saving: 'failed' }); return; } throw e; }
    useEditor.setState({ elsewhere: false, saving: 'saved' }); // this version is on the disk now
    track('tab_conflict', { choice: 'mine' });
  });
  return (
    <Veil label="elsewhere-title" alert focus={newer}>
      <h2 id="elsewhere-title">{t('This project was changed in another tab')}</h2>
      <p>{t('Saving here is paused, so one tab does not erase the edits of the other. Pick the version to keep working on.')}</p>
      <Button ref={newer} variant="primary" disabled={working} onClick={fresh}>{t('Open the newer version')}</Button>
      <Button disabled={working} onClick={mine}>{t('Keep this version')}</Button>
    </Veil>
  );
}

const TIPS = [
  'Scroll the timeline to move through your video. The white line is the current moment.',
  'Tap a clip to see its tools. Long-press and drag to move it.',
  'Pinch the timeline to zoom. In the preview, drag text and overlays, pinch to resize and rotate.',
];

/** First-run tips, one at a time, remembered per device; not while the note about the move is up (one thing at a time). */
function Coach({ hold }: { hold: boolean }) {
  const [seen, setSeen] = useState(() => { try { return Number(localStorage.getItem('kadr.tips') ?? 0); } catch { return TIPS.length; } });
  const hasClips = useEditor((s) => !!s.project?.tracks.some((tr) => tr.clips.length));
  const sheet = useEditor((s) => s.sheet);
  if (seen >= TIPS.length || !hasClips || sheet || hold) return null;
  const next = () => { const n = seen + 1; setSeen(n); try { localStorage.setItem('kadr.tips', String(n)); } catch { /* ignore */ } };
  return (
    <div className="coach" role="note">
      <div className="ck ck-editor-tip">
        <span>{t(TIPS[seen])}</span>
        <Button onClick={next}>{seen + 1 < TIPS.length ? t('Next') : t('Got it')}</Button>
      </div>
    </div>
  );
}
