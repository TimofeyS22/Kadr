import { ArchiveRestore, Clapperboard, Download, Lock, Pencil, Plus, Smartphone, Sparkles, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { produce } from 'immer';
import { ASPECTS, createProject } from '../core/defaults';
import { TEMPLATES, buildTemplate, type TemplateSpec } from '../core/templates';
import type { AspectId } from '../core/types';
import { errorMessage, track } from '../lib/telemetry';
import { useEditor } from '../state/store';
import { deleteProject, listProjects, loadProject, requestPersistence, saveProject, type ProjectMeta } from '../storage/db';
import { formatTime } from './format';
import { t, useLocale } from '../lib/i18n';
import { useInstall } from './install';
import { TASKS, isTask, openWithTask, projectFromAssets, type TaskId } from './tasks';

/** The task from a deep link (#/start/<task>, the task pages) or "share" (Android share target, #/share). */
function useStartRoute(): TaskId | 'share' | null {
  const read = (): TaskId | 'share' | null => {
    if (location.hash === '#/share') return 'share';
    const task = /^#\/start\/([\w-]+)$/.exec(location.hash)?.[1];
    return isTask(task) ? task : null;
  };
  const [r, setR] = useState(read);
  useEffect(() => {
    const f = () => setR(read());
    window.addEventListener('hashchange', f);
    return () => window.removeEventListener('hashchange', f);
  }, []);
  return r;
}

/** Files shared from another app (parked by public/share-target.js), as File objects; the cache is emptied. */
let taking = false; // React StrictMode runs effects twice in development; the shared files are taken once
/** null: another call is already taking them. */
async function takeSharedFiles(): Promise<File[] | null> {
  if (taking) return null;
  if (!('caches' in window)) return [];
  taking = true;
  const cache = await caches.open('kadr-share');
  const keys = await cache.keys();
  const files: File[] = [];
  for (const k of keys) {
    const res = await cache.match(k);
    if (res) files.push(new File([await res.blob()], decodeURIComponent(res.headers.get('x-file-name') ?? 'shared'), { type: res.headers.get('content-type') ?? '' }));
    await cache.delete(k);
  }
  taking = false;
  return files;
}

const ASPECT_HINT: Record<AspectId, string> = {
  '9:16': 'TikTok · Reels · Shorts', '16:9': 'YouTube', '1:1': 'Square', '4:5': 'Instagram feed', '3:4': 'Portrait',
};

export const browserSupported = (): boolean =>
  'VideoDecoder' in window && 'VideoEncoder' in window && !!document.createElement('canvas').getContext('webgl2');

const open = (id: string) => { location.hash = `#/p/${id}`; };

export function Home() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useEditor((s) => s.toast);
  const soundLost = (name: string, error: string) => toast(t('{name}: its sound does not decode in this browser ({error}). The video is added without sound.', { name, error }), 'info', 10_000);
  const { locale, setLocale } = useLocale();
  const supported = browserSupported();

  const route = useStartRoute();
  const install = useInstall();
  const refresh = () => listProjects().then(setProjects).catch((e) => toast(errorMessage(e), 'error'));
  useEffect(() => { void refresh(); void requestPersistence(); }, []);
  useEffect(() => { if (isTask(route ?? undefined)) track('deeplink_task', { task: route! }); }, [route]);

  /** Media in → a vertical project → the task's tool (shared by the reel card, task links and the share target). */
  async function fromFiles(files: File[], task: TaskId | null, name: string) {
    const { importFiles } = await import('../engine/importer');
    const onError = (n: string, e: unknown) => toast(`${n}: ${errorMessage(e)}`, 'error');
    setBusy(t('Adding {i} of {n}…', { i: 1, n: files.length }));
    try {
      const assets = await importFiles(files, onError, (i, n) => setBusy(t('Adding {i} of {n}…', { i: i + 1, n })), soundLost);
      if (assets.length) await openWithTask(projectFromAssets(name, assets), task);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function startTask(task: TaskId, fromLink = false) {
    const spec = TASKS[task];
    track(fromLink ? 'deeplink_started' : 'task_started', { task });
    if (!spec.accept) { await openWithTask(createProject(t(spec.title), '9:16'), task); return; }
    const { pickFiles } = await import('../engine/importer');
    const files = await pickFiles(spec.accept);
    if (files.length) await fromFiles(files, task, t(spec.title));
  }

  // Android "Share → Kadr": the files are waiting in the cache.
  useEffect(() => {
    if (route !== 'share') return;
    history.replaceState(null, '', location.pathname + location.hash); // drop ?shared=N
    void takeSharedFiles().then((files) => {
      if (!files) return;
      track('share_target_received', { files: files.length, kinds: [...new Set(files.map((f) => f.type.split('/')[0]))].join(',') });
      if (files.length) void fromFiles(files, null, t('Shared video'));
      else { history.replaceState(null, '', location.pathname); toast(t('Nothing to add was shared')); }
    }).catch((e) => toast(errorMessage(e), 'error'));
  }, [route]);

  async function create(aspect: AspectId) {
    const p = createProject(t('Project {n}', { n: (projects?.length ?? 0) + 1 }), aspect);
    await saveProject(p);
    track('project_created', { aspect });
    open(p.id);
  }

  async function sample() {
    setBusy(t('Creating a sample project on your device…'));
    try {
      const { createSampleProject } = await import('../engine/sample');
      const p = await createSampleProject();
      await saveProject(p);
      track('sample_created');
      open(p.id);
    } catch (e) {
      toast(t('Could not create the sample: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function restore() {
    const { pickFiles } = await import('../engine/importer');
    const [file] = await pickFiles('.kadr,.zip,application/zip', false);
    if (!file) return;
    setBusy(t('Restoring the backup…'));
    try {
      const { importBackup } = await import('../engine/backup');
      const { project: p, dropped } = await importBackup(file);
      track('backup_restored');
      if (dropped) toast(t('Some parts of the backup could not be restored: {n}', { n: dropped }));
      open(p.id);
    } catch (e) {
      toast(t('Could not restore: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function backup(m: ProjectMeta) {
    const p = await loadProject(m.id);
    if (!p) return;
    setBusy(t('Packing “{name}”…', { name: m.name }));
    try {
      const [{ exportBackup }, { saveFile }] = await Promise.all([import('../engine/backup'), import('../engine/exporter')]);
      const blob = await exportBackup(p);
      setBusy(null);
      await saveFile(blob, `${m.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'project'}.kadr`);
      track('backup_saved', { mb: Math.round(blob.size / 1e6) });
    } catch (e) {
      toast(t('Could not save the backup: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function fromTemplate(tpl: TemplateSpec) {
    const { pickFiles, importFiles } = await import('../engine/importer');
    const files = await pickFiles(tpl.music === 'none' ? 'video/*,image/*' : 'video/*,image/*,audio/*');
    if (!files.length) return;
    const musicFiles = files.filter((f) => f.type.startsWith('audio/'));
    const visualFiles = files.filter((f) => !musicFiles.includes(f));
    if (visualFiles.length < tpl.visuals[0]) { toast(t('{name} needs at least {n} photos or videos', { name: t(tpl.name), n: tpl.visuals[0] }), 'error'); return; }
    if (tpl.music === 'required' && !musicFiles.length) { toast(t('{name} needs a music file too. Select it together with your photos.', { name: t(tpl.name) }), 'error'); return; }
    setBusy(t('Building “{name}”…', { name: t(tpl.name) }));
    try {
      const onError = (name: string, e: unknown) => toast(`${name}: ${errorMessage(e)}`, 'error');
      const visuals = await importFiles(visualFiles.slice(0, tpl.visuals[1]), onError, undefined, soundLost);
      const [music] = tpl.music === 'none' ? [] : (await importFiles(musicFiles.slice(0, 1), onError)).filter((a) => a.hasAudio);
      if (visuals.length < tpl.visuals[0] || (tpl.music === 'required' && !music)) return;
      const assets = music ? [...visuals, music] : visuals;
      let p = createProject(tpl.name, tpl.aspect);
      p.assets = Object.fromEntries(assets.map((a) => [a.id, a]));
      let beats: number[] | undefined;
      if (tpl.id === 'beat' && music) {
        const { detectBeats } = await import('../engine/analysis');
        const grid = await detectBeats(p, music.id, () => undefined, new AbortController().signal);
        if (grid) { beats = grid.times; p.assets[music.id] = { ...music, beats: grid }; }
        else toast(t('No steady beat found, clips are cut evenly instead'));
      }
      p = produce(p, (d) => buildTemplate(d, tpl.id, visuals, music, beats));
      await saveProject(p);
      track('template_used', { id: tpl.id, visuals: visuals.length, music: !!music });
      open(p.id);
    } catch (e) {
      toast(t('Could not build the template: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function rename(m: ProjectMeta) {
    const name = prompt(t('Project name'), m.name)?.trim();
    if (!name) return;
    const p = await loadProject(m.id);
    if (p) { await saveProject({ ...p, name }); void refresh(); }
  }

  async function remove(m: ProjectMeta) {
    if (!confirm(t('Delete “{name}”? Its media will be removed from this device.', { name: m.name }))) return;
    await deleteProject(m.id);
    void refresh();
  }

  return (
    <main className="home">
      <header className="home-head">
        <div className="logo" aria-hidden><span /></div>
        <h1>Kadr</h1>
        <div className="lang" role="radiogroup" aria-label={t('Language')}>
          {(['en', 'ru'] as const).map((l) => (
            <button key={l} role="radio" aria-checked={locale === l} className={locale === l ? 'on' : ''} onClick={() => setLocale(l)}>{l.toUpperCase()}</button>
          ))}
        </div>
      </header>
      <p className="tagline">{t('Edit videos right in your browser.')} <Lock size={14} /> {t('Nothing is uploaded — your media stays on this device.')}</p>

      {!supported && (
        <div className="banner error">
          {t('This browser can’t edit video yet. Use a current Chrome, Edge or Safari 26+ (iPhone: iOS 26+).')}
        </div>
      )}

      {isTask(route ?? undefined) && !busy && (
        <div className="task-banner">
          <b>{t(TASKS[route as TaskId].title)}</b>
          <button className="btn primary big" disabled={!supported} onClick={() => void startTask(route as TaskId, true)}>
            {TASKS[route as TaskId].accept ? t('Choose a video') : t('Open')}
          </button>
          <button className="btn" onClick={() => { location.hash = ''; }}>{t('Not now')}</button>
        </div>
      )}

      {!busy && !isTask(route ?? undefined) && (
        <button className="reel-card" disabled={!supported} onClick={() => void startTask('reel')}>
          <Clapperboard size={28} aria-hidden />
          <span><b>{t('Reel in 1 tap')}</b><small>{t('Pick a video of you talking: pauses and “um”s go, captions, zooms and music come.')}</small></span>
        </button>
      )}

      {busy ? <div className="banner">{busy}</div> : (
        <div className="home-actions">
          <button className="btn primary big" disabled={!supported} onClick={() => setPicking((v) => !v)}><Plus size={20} /> {t('New project')}</button>
          <button className="btn big" disabled={!supported} onClick={() => void sample()}><Sparkles size={18} /> {t('Try a sample')}</button>
          <button className="btn big" onClick={() => void restore()}><ArchiveRestore size={18} /> {t('Restore backup')}</button>
          {install && <button className="btn big" onClick={() => void install()}><Smartphone size={18} /> {t('Install Kadr')}</button>}
        </div>
      )}
      {install && !busy && <p className="hint">{t('Installed, Kadr shows up in “Share” in your gallery: send a video straight to the editor.')}</p>}

      {picking && !busy && (
        <div className="aspect-grid" role="list">
          {(Object.keys(ASPECTS) as AspectId[]).map((a) => {
            const [w, h] = ASPECTS[a];
            return (
              <button key={a} className="aspect-card" onClick={() => void create(a)} role="listitem">
                <span className="aspect-shape" style={{ aspectRatio: `${w} / ${h}` }} />
                <b>{a}</b>
                <small>{t(ASPECT_HINT[a])}</small>
              </button>
            );
          })}
        </div>
      )}

      <h2 className="section-title">{t('Start from a template')}</h2>
      <div className="template-grid">
        {TEMPLATES.map((tpl) => (
          <button key={tpl.id} className="template-card" disabled={!supported || !!busy} onClick={() => void fromTemplate(tpl)}>
            <span className={`template-art t-${tpl.id}`} style={{ aspectRatio: ASPECTS[tpl.aspect].join(' / ') }} aria-hidden />
            <b>{t(tpl.name)}</b>
            <small>{t(tpl.description)}</small>
          </button>
        ))}
      </div>

      <h2 className="section-title">{t('Your projects')}</h2>
      {projects === null ? <p className="hint">{t('Loading…')}</p> : projects.length === 0 ? (
        <p className="hint">{t('No projects yet. Start a new one or try the sample.')}</p>
      ) : (
        <ul className="project-grid">
          {projects.map((m) => (
            <li key={m.id} className="project-card">
              <button className="project-open" onClick={() => open(m.id)} aria-label={t('Open {name}', { name: m.name })}>
                <span className="project-thumb" style={{ aspectRatio: ASPECTS[m.aspect].join(' / ') }}>
                  {m.thumb && <img src={m.thumb} alt="" />}
                </span>
                <span className="project-name">{m.name}</span>
                <span className="project-meta">{formatTime(m.duration, false)}, {new Date(m.updatedAt).toLocaleDateString()}</span>
              </button>
              <div className="project-actions">
                <button className="icon-btn" onClick={() => void backup(m)} aria-label={t('Save a backup of {name}', { name: m.name })}><Download size={16} /></button>
                <button className="icon-btn" onClick={() => void rename(m)} aria-label={t('Rename {name}', { name: m.name })}><Pencil size={16} /></button>
                <button className="icon-btn" onClick={() => void remove(m)} aria-label={t('Delete {name}', { name: m.name })}><Trash2 size={16} /></button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <footer className="home-foot">{t('Projects and media are stored in this browser.')} Kadr v{__APP_VERSION__}</footer>
    </main>
  );
}
