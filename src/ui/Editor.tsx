import { produce } from 'immer';
import { ChevronLeft, Pause, Play, Redo2, Smartphone, Undo2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { normalizeProject, projectDuration } from '../core/timeline';
import type { Project } from '../core/types';
import { player } from '../engine/player';
import { errorMessage, track } from '../lib/telemetry';
import { useEditor } from '../state/store';
import { loadProject, saveProject } from '../storage/db';
import { addFiles, deleteMulti, deleteSelected, duplicateMulti, duplicateSelected, splitAtPlayhead } from './actions';
import { formatTime } from './format';
import { Preview } from './Preview';
import { Sheets } from './sheets';
import { Timeline } from './Timeline';
import { Toolbar } from './Toolbar';
import { t } from '../lib/i18n';

const snapshot = () => Promise.race([player.snapshot(), new Promise<null>((r) => setTimeout(() => r(null), 800))]);

export async function leaveEditor(): Promise<void> {
  player.pause();
  const p = useEditor.getState().project;
  if (p) await saveProject(p, (await snapshot()) ?? undefined).catch(() => undefined);
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
      useEditor.getState().open(produce(p, (d) => { normalizeProject(d); }));
      track('project_opened', { clips: p.tracks.reduce((n, t) => n + t.clips.length, 0) });
    }).catch((e) => useEditor.getState().toast(errorMessage(e), 'error'));
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
    const flush = () => {
      clearTimeout(timer);
      if (!pending) return;
      const p = pending;
      pending = null;
      saveProject(p).catch((e) => useEditor.getState().toast(t('Could not save: {error}', { error: errorMessage(e) }), 'error'));
    };
    const unsub = useEditor.subscribe((s, prev) => {
      if (!s.project || !prev.project || s.project === prev.project) return;
      pending = s.project;
      clearTimeout(timer);
      timer = window.setTimeout(flush, 600);
    });
    const onHide = () => { if (document.visibilityState === 'hidden') flush(); };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', flush);
    return () => { unsub(); flush(); document.removeEventListener('visibilitychange', onHide); window.removeEventListener('pagehide', flush); };
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
      else if (key === 'escape') { s.openSheet(null); s.select(null); }
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
      <Toolbar />
      <Sheets />
      <BusyOverlay />
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
      <button className="btn primary" disabled={projectDuration(project) <= 0} onClick={() => s.openSheet('export')}>
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
