import { produce } from 'immer';
import { ChevronLeft, Pause, Play, Redo2, Smartphone, Undo2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { runStartTask } from './tasks';
import { normalizeProject, projectDuration, withUsedAssets } from '../core/timeline';
import type { Project } from '../core/types';
import { player } from '../engine/player';
import { errorMessage, track } from '../lib/telemetry';
import { useEditor } from '../state/store';
import { ProjectConflict, clearJournal, deleteBlob, forgetProject, journalProject, loadProject, onSavedElsewhere, saveProject } from '../storage/db';
import { startExport } from './ExportSheet';
import { addFiles, deleteMulti, deleteSelected, duplicateMulti, duplicateSelected, splitAtPlayhead, outdatedSoundClips, prepareStaleSounds, withBusy } from './actions';
import { formatTime } from './format';
import { Preview } from './Preview';
import { Sheets } from './sheets';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import { PerfOverlay, perfOverlayEnabled } from './PerfOverlay';

const showPerf = perfOverlayEnabled();
import { t } from '../lib/i18n';

const snapshot = () => Promise.race([player.snapshot(), new Promise<null>((r) => setTimeout(() => r(null), 800))]);

/** After a failed autosave, the next try comes this soon. */
const SAVE_RETRY_MS = 4000;
/** However many edits follow one another, the first of them is on disk within this long. */
const SAVE_MAX_WAIT_MS = 2500;

export async function leaveEditor(): Promise<void> {
  if (useEditor.getState().sheetGuard && !useEditor.getState().closeSheet()) return; // an export or a file not saved yet
  player.pause();
  const p = useEditor.getState().project;
  if (p) {
    // Never close over unsaved work (v1.4.3: this error used to be swallowed): without the thumbnail, then give up loudly.
    // Changed in another tab: the person chooses first (ConflictNotice), nothing is written over.
    if (useEditor.getState().elsewhere) return;
    const failed = (e: unknown) => {
      if (e instanceof ProjectConflict) useEditor.setState({ elsewhere: true });
      else useEditor.getState().toast(t('Could not save: {error}', { error: errorMessage(e) }), 'error');
      return false;
    };
    const saved = await saveProject(p, (await snapshot()) ?? undefined).then(() => true, (e) => (e instanceof ProjectConflict ? failed(e) : saveProject(p).then(() => true, failed)));
    if (!saved) return;
    forgetProject(p.id);
  }
  useEditor.getState().close();
  location.hash = '';
}

export function Editor({ id }: { id: string }) {
  const project = useEditor((s) => s.project);
  const sheetOpen = useEditor((s) => s.sheet !== null);
  const [missing, setMissing] = useState(false);
  const [dragging, setDragging] = useState(false);

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
    let writing: { p: Project; seq: number } | null = null;
    const flush = (hiding = false) => {
      clearTimeout(timer);
      if (useEditor.getState().elsewhere) return; // changed in another tab: the person chooses first
      if (!pending) {
        if (hiding && writing) writing.seq = journalProject(writing.p);
        return;
      }
      const p = pending;
      pending = null;
      const job = { p, seq: hiding ? journalProject(p) : 0 };
      writing = job;
      saveProject(p).then(
        () => {
          if (writing === job) writing = null;
          retried = false;
          if (job.seq) clearJournal(p.id, job.seq);
          if (failing) { failing = false; useEditor.getState().toast(t('Your changes are saved.')); }
        },
        (e) => {
          if (writing === job) writing = null;
          pending ??= p; // a newer edit holds this one too
          if (e instanceof ProjectConflict) { useEditor.setState({ elsewhere: true }); return; }
          if (document.visibilityState === 'hidden' && !retried) { retried = true; return; }
          retried = false;
          if (!failing) useEditor.getState().toast(t('Could not save: {error}', { error: errorMessage(e) }), 'error');
          failing = true;
          clearTimeout(timer);
          timer = window.setTimeout(flush, SAVE_RETRY_MS);
        },
      );
    };
    const onPageHide = () => flush(true);
    const unsub = useEditor.subscribe((s, prev) => {
      if (s.session !== prev.session) { pending = null; clearTimeout(timer); return; } // opened, not edited
      if (!s.project || !prev.project || s.project === prev.project) return;
      // Edits in a row put the save off, and a crash took all of them: 78 edits over 30 s were never written (audit V-109).
      if (!pending) firstEdit = performance.now();
      pending = s.project;
      clearTimeout(timer);
      timer = window.setTimeout(flush, Math.min(600, Math.max(0, firstEdit + SAVE_MAX_WAIT_MS - performance.now())));
    });
    const unsubTabs = onSavedElsewhere((pid) => { if (pid === useEditor.getState().project?.id) useEditor.setState({ elsewhere: true }); });
    const onHide = () => { if (document.visibilityState === 'hidden') flush(true); else if (pending) flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onPageHide);
    return () => { unsub(); unsubTabs(); flush(); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', onPageHide); };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable) return;
      const s = useEditor.getState();
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) s.redo(); else s.undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); s.redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); if (s.multi) duplicateMulti(); else duplicateSelected(); return; }
      if (mod) return;
      if (key === ' ') { e.preventDefault(); player.toggle(); }
      else if (key === 's') splitAtPlayhead();
      else if (key === 'delete' || key === 'backspace') { if (s.multi) deleteMulti(); else deleteSelected(); }
      else if (key === 'escape') { if (s.closeSheet()) s.select(null); }
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
      <div className="center-msg">
        <p>{t('This project is not on this device.')}</p>
        <button className="btn primary" onClick={() => { location.hash = ''; }}>{t('Back to projects')}</button>
      </div>
    );
  }
  if (!project) return <div className="center-msg"><p>{t('Opening…')}</p></div>;

  return (
    <div
      className={`editor ${sheetOpen ? 'sheet-open' : ''}`}
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
      <TopBar project={project} />
      <Preview />
      <Transport />
      <Timeline />
      {showPerf && <PerfOverlay />}
      <Toolbar />
      <Sheets />
      <BusyOverlay />
      <ElsewhereNotice />
      <Coach />
      {dragging && <div className="drop-hint">{t('Drop videos, photos or music to add them')}</div>}
    </div>
  );
}

function TopBar({ project }: { project: Project }) {
  const canUndo = useEditor((s) => s.past.length > 0);
  const canRedo = useEditor((s) => s.future.length > 0);
  const s = useEditor.getState();
  return (
    <header className="topbar">
      <button className="icon-btn" onClick={() => void leaveEditor()} aria-label={t('Back to projects')}><ChevronLeft size={24} /></button>
      <input className="title-input" value={project.name} maxLength={80} aria-label={t('Project name')}
        onChange={(e) => s.commit((d) => { d.name = e.target.value; }, 'name')} />
      <button className="icon-btn" disabled={!canUndo} onClick={s.undo} aria-label={t('Undo')}><Undo2 size={20} /></button>
      <button className="icon-btn" disabled={!canRedo} onClick={s.redo} aria-label={t('Redo')}><Redo2 size={20} /></button>
      <button className="btn primary" disabled={projectDuration(project) <= 0} onClick={startExport}>
        <Upload size={16} /> {t('Export')}
      </button>
    </header>
  );
}

function Transport() {
  const time = useEditor((s) => s.time);
  const playing = useEditor((s) => s.playing);
  const duration = useEditor((s) => (s.project ? projectDuration(s.project) : 0));
  const safeZones = useEditor((s) => s.safeZones);
  return (
    <div className="transport">
      <span className="time"><b>{formatTime(time)}</b> / {formatTime(duration)}</span>
      <button className="play-btn" onClick={() => player.toggle()} aria-label={playing ? t('Pause') : t('Play')} disabled={duration <= 0}>
        {playing ? <Pause size={22} fill="currentColor" /> : <Play size={22} fill="currentColor" />}
      </button>
      <button className={`icon-btn zones-btn ${safeZones ? 'on' : ''}`} aria-pressed={safeZones} aria-label={t('Show TikTok, Reels and Shorts safe zones')}
        onClick={() => useEditor.setState({ safeZones: !safeZones })}>
        <Smartphone size={18} />
      </button>
    </div>
  );
}

function BusyOverlay() {
  const busy = useEditor((s) => s.busy);
  if (!busy) return null;
  return (
    <div className="busy" role="status" aria-live="polite">
      <div className="busy-card">
        <p>{busy.label}</p>
        <div className="progress"><div style={{ width: busy.progress === null ? '15%' : `${Math.round(busy.progress * 100)}%` }} className={busy.progress === null ? 'indeterminate' : ''} /></div>
        {busy.cancel && <button className="btn" onClick={busy.cancel}>{t('Cancel')}</button>}
      </div>
    </div>
  );
}

/**
 * The project was saved in another tab after this one opened it (audit V-258). Before, the last tab to save won and
 * the other tab's edits were gone with no word. Saving here waits until the person picks a version.
 */
function ElsewhereNotice() {
  const on = useEditor((s) => s.elsewhere);
  const [working, setWorking] = useState(false);
  if (!on) return null;
  const run = (fn: () => Promise<void>) => {
    setWorking(true);
    void fn().catch((e) => useEditor.getState().toast(errorMessage(e), 'error')).finally(() => setWorking(false));
  };
  const fresh = () => run(async () => {
    const s = useEditor.getState();
    const p = s.project && await loadProject(s.project.id);
    if (!p) return;
    s.open(produce(p, (d) => { normalizeProject(d); }));
    track('tab_conflict', { choice: 'theirs' });
  });
  const mine = () => run(async () => {
    const p = useEditor.getState().project;
    if (!p) return;
    await saveProject(p, undefined, true);
    useEditor.setState({ elsewhere: false });
    track('tab_conflict', { choice: 'mine' });
  });
  return (
    <div className="busy" role="alertdialog" aria-modal="true" aria-labelledby="elsewhere-title">
      <div className="busy-card">
        <h2 id="elsewhere-title" className="notice-title">{t('This project was changed in another tab')}</h2>
        <p>{t('Saving here is paused, so one tab does not erase the edits of the other. Pick the version to keep working on.')}</p>
        <button className="btn primary" disabled={working} onClick={fresh}>{t('Open the newer version')}</button>
        <button className="btn" disabled={working} onClick={mine}>{t('Keep this version')}</button>
      </div>
    </div>
  );
}

const TIPS = [
  'Scroll the timeline to move through your video. The white line is the current moment.',
  'Tap a clip to see its tools. Long-press and drag to move it.',
  'Pinch the timeline to zoom. In the preview, drag text and overlays, pinch to resize and rotate.',
];

/** First-run tips, one at a time, remembered per device. */
function Coach() {
  const [seen, setSeen] = useState(() => { try { return Number(localStorage.getItem('kadr.tips') ?? 0); } catch { return TIPS.length; } });
  const hasClips = useEditor((s) => !!s.project?.tracks.some((tr) => tr.clips.length));
  const sheet = useEditor((s) => s.sheet);
  if (seen >= TIPS.length || !hasClips || sheet) return null;
  const next = () => { const n = seen + 1; setSeen(n); try { localStorage.setItem('kadr.tips', String(n)); } catch { /* ignore */ } };
  return (
    <div className="coach" role="note">
      <span>{t(TIPS[seen])}</span>
      <button className="btn" onClick={next}>{seen + 1 < TIPS.length ? t('Next') : t('Got it')}</button>
    </div>
  );
}
