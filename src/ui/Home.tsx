import { ArchiveRestore, ChevronRight, Clapperboard, Download, Lock, Pencil, Plus, Smartphone, Sparkles, Trash2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { produce } from 'immer';
import { ASPECTS, createProject } from '../core/defaults';
import { TEMPLATES, buildTemplate, type TemplateSpec } from '../core/templates';
import type { AspectId } from '../core/types';
import { IN_APP, IOS, standalone } from '../lib/device';
import { errorMessage, track } from '../lib/telemetry';
import { within } from '../lib/limits';
import { pickFiles } from '../lib/pickFiles';
import { holdUpdates, othersWorking, updatesHeld, useHoldUpdates } from '../lib/update';
import { useEditor } from '../state/store';
import { collectOrphans, deleteProject, listProjects, loadProject, requestPersistence, saveProject, type ProjectMeta } from '../storage/db';
import { formatTime } from './format';
import { importNoteText, t, useLocale } from '../lib/i18n';
import type { ImportNote } from '../engine/importer';
import { InAppNotice, useInAppNotice } from './InAppNotice';
import { useInstall } from './install';
import { TASKS, isTask, openWithTask, projectFromAssets, type TaskId } from './tasks';
// Chetko, stage Ч4 release 2 (docs/17): the home screen is built from the components of the system.
import './ck/ck.css';
import './home.css';
import { Segments } from './ck/choice';
import { Button, IconButton } from './ck/controls';
import { Confirm } from './ck/feedback';
import { Field } from './ck/Field';
import { Empty, ProjectRow } from './ck/home';
import { Sheet } from './ck/Sheet';

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

/**
 * Files shared from another app (parked by public/share-target.js), as File objects. `clear` empties the cache once
 * they are in a project: a page that reloads or is killed before that finds them again.
 */
let taking = false; // React StrictMode runs effects twice in development; the shared files are taken once
/** null: another call is already taking them. */
async function takeSharedFiles(): Promise<{ files: File[]; clear(): Promise<void> } | null> {
  if (taking) return null;
  if (!('caches' in window)) return { files: [], clear: async () => undefined };
  taking = true;
  const cache = await caches.open('kadr-share');
  const keys = await cache.keys();
  const files: File[] = [];
  for (const k of keys) {
    const res = await cache.match(k);
    if (res) files.push(new File([await res.blob()], decodeURIComponent(res.headers.get('x-file-name') ?? 'shared'), { type: res.headers.get('content-type') ?? '' }));
  }
  taking = false;
  return { files, clear: async () => { await Promise.all(keys.map((k) => cache.delete(k))); } };
}

/** A tap's whole job (the picker, the import, opening the project) holds updates: a reload in the picker loses the files. */
let swept = false;

async function held<T>(job: () => Promise<T>): Promise<T> {
  const release = holdUpdates(); // before the job's first await, so the picker still opens inside the tap
  try { return await job(); } finally { release(); }
}

const ASPECT_HINT: Record<AspectId, string> = {
  '9:16': 'TikTok · Reels · Shorts', '16:9': 'YouTube', '1:1': 'Square', '4:5': 'Instagram feed', '3:4': 'Portrait',
};

export const browserSupported = (): boolean =>
  'VideoDecoder' in window && 'VideoEncoder' in window && !!document.createElement('canvas').getContext('webgl2');

const open = (id: string) => { location.hash = `#/p/${id}`; };
/** Width / height of a project's frame (a list from before aspects were kept counts as vertical). */
const frame = (a: AspectId | undefined) => { const [w, h] = (a && ASPECTS[a]) || ASPECTS['9:16']; return w / h; };
const KEEP_TIP_KEY = 'kadr.keepTip';
/** The buttons moved to the bottom (release 2 of Ч4): said once, where they were, to someone who knew them there (rule Ж1). */
const MOVED_KEY = 'kadr.homeMoved.v1';
/**
 * How long the list and a new project wait for the browser's storage before the person hears why nothing happens
 * (D-15). It can stop answering: a Kadr page frozen in Safari's cache with a write open held it (D-14, fixed). The
 * list still comes in if the storage answers later.
 */
const STORAGE_WAIT_MS = 10_000;
const seenKey = (key: string) => { try { return localStorage.getItem(key) !== null; } catch { return true; } };
const setKey = (key: string) => { try { localStorage.setItem(key, '1'); } catch { /* said again next time */ } };

export function Home() {
  const [projects, setProjects] = useState<ProjectMeta[] | null>(null);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [naming, setNaming] = useState<ProjectMeta | null>(null);
  const [name, setName] = useState('');
  const [asked, setAsked] = useState<ProjectMeta | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [movedSeen, setMovedSeen] = useState(() => seenKey(MOVED_KEY));
  const root = useRef<HTMLElement>(null);
  const dock = useRef<HTMLElement>(null);
  useHoldUpdates(!!busy);
  const toast = useEditor((s) => s.toast);
  const noted = (name: string, note: ImportNote) => toast(importNoteText(name, note), 'info', 10_000);
  const { locale, setLocale } = useLocale();
  const supported = browserSupported();

  // Safari's 7-day rule (docs/12 §1.3 item 4): a site not on the Home Screen loses its data after a week away. The app
  // on the Home Screen has its own storage, so what was made in Safari does not appear there (audit V-164): the advice
  // comes before the first project, when nothing is left behind, and with projects it says how many stay in Safari and
  // that a backup moves one. Dismissed with no projects ('0'), it is said once more, in full, when there is one to lose.
  const [keepTipSeen, setKeepTipSeen] = useState(() => { try { return localStorage.getItem(KEEP_TIP_KEY); } catch { return '1'; } });
  // Not in an app's built-in browser: it has no "Add to Home Screen", and the notice there says to leave it (audit V-203).
  const inAppNotice = useInAppNotice();
  const kept = projects?.length ?? 0;
  const keepTip = IOS && !IN_APP && !standalone() && !busy && projects !== null && (kept ? keepTipSeen !== '1' : keepTipSeen === null);
  const dismissKeepTip = () => {
    const seen = kept ? '1' : '0';
    try { localStorage.setItem(KEEP_TIP_KEY, seen); } catch { /* shown again next time */ }
    setKeepTipSeen(seen);
    track('keep_tip_dismissed', { projects: kept });
  };

  // Once a page load, when nothing here or in another tab is working: media left behind by what never finished.
  useEffect(() => {
    if (swept) return;
    swept = true;
    const timer = setTimeout(() => {
      void othersWorking().then(async (busyElsewhere) => {
        if (busyElsewhere || updatesHeld()) return;
        const n = await collectOrphans();
        if (n) track('orphans_collected', { n });
      }).catch((e) => console.warn('could not tidy the stored media', e));
    }, 4000);
    return () => clearTimeout(timer);
  }, []);

  const route = useStartRoute();
  const offered = useInstall();
  const install = IN_APP ? null : offered; // a built-in browser installs nothing, whatever it announces (audit V-203)
  const refresh = () => listProjects().then(setProjects).catch((e) => toast(errorMessage(e), 'error'));
  useEffect(() => { void refresh(); void requestPersistence(); }, []);
  useEffect(() => {
    if (projects !== null) return;
    const timer = setTimeout(() => toast(t('Your projects are not loading: the browser’s storage does not answer. Close other Kadr tabs and reload the page.'), 'error'), STORAGE_WAIT_MS);
    return () => clearTimeout(timer);
  }, [projects]);
  useEffect(() => { if (isTask(route ?? undefined)) track('deeplink_task', { task: route! }); }, [route]);

  /** Media in → a vertical project → the task's tool (shared by the reel card, task links and the share target). */
  async function fromFiles(files: File[], task: TaskId | null, name: string) {
    const { importFiles } = await import('../engine/importer');
    const onError = (n: string, e: unknown) => toast(`${n}: ${errorMessage(e)}`, 'error');
    setBusy(t('Adding {i} of {n}…', { i: 1, n: files.length }));
    try {
      const assets = await importFiles(files, onError, (i, n) => setBusy(t('Adding {i} of {n}…', { i: i + 1, n })), noted);
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
    const accept = spec.accept;
    await held(async () => {
      const files = await pickFiles(accept);
      if (files.length) await fromFiles(files, task, t(spec.title));
    });
  }

  // Android "Share → Kadr": the files are waiting in the cache.
  useEffect(() => {
    if (route !== 'share') return;
    history.replaceState(null, '', location.pathname + location.hash); // drop ?shared=N
    void held(async () => { // #/share counts as work too (main.tsx): no new version until the files are in a project
      const shared = await takeSharedFiles();
      if (!shared) return;
      const { files, clear } = shared;
      track('share_target_received', { files: files.length, kinds: [...new Set(files.map((f) => f.type.split('/')[0]))].join(',') });
      if (files.length) await fromFiles(files, null, t('Shared video'));
      else { history.replaceState(null, '', location.pathname); toast(t('Nothing to add was shared')); }
      await clear();
    }).catch((e) => toast(errorMessage(e), 'error'));
  }, [route]);

  async function create(aspect: AspectId) {
    const p = createProject(t('Project {n}', { n: (projects?.length ?? 0) + 1 }), aspect);
    try {
      await within(saveProject(p), STORAGE_WAIT_MS, () => { throw new Error(t('the browser’s storage does not answer')); });
    } catch (e) {
      toast(t('Could not create the project: {error}', { error: errorMessage(e) }), 'error');
      return;
    }
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
      const [{ exportBackup }, { saveFile }] = await Promise.all([import('../engine/backup'), import('../engine/save')]);
      const { blob, missing } = await exportBackup(p);
      setBusy(null);
      if (missing) toast(t('{n} media files of this project are missing from this device, so they are not in the backup.', { n: missing }), 'error', 10_000);
      await saveFile(blob, `${m.name.replace(/[^\p{L}\p{N}\-_ ]/gu, '').trim() || 'project'}.kadr`);
      track('backup_saved', { mb: Math.round(blob.size / 1e6) });
    } catch (e) {
      toast(t('Could not save the backup: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function fromTemplate(tpl: TemplateSpec) {
    const files = await pickFiles(tpl.music === 'none' ? 'video/*,image/*' : 'video/*,image/*,audio/*');
    const { importFiles } = await import('../engine/importer');
    if (!files.length) return;
    const musicFiles = files.filter((f) => f.type.startsWith('audio/'));
    const visualFiles = files.filter((f) => !musicFiles.includes(f));
    if (visualFiles.length < tpl.visuals[0]) { toast(t('{name} needs at least {n} photos or videos', { name: t(tpl.name), n: tpl.visuals[0] }), 'error'); return; }
    if (tpl.music === 'required' && !musicFiles.length) { toast(t('{name} needs a music file too. Select it together with your photos.', { name: t(tpl.name) }), 'error'); return; }
    setBusy(t('Building “{name}”…', { name: t(tpl.name) }));
    try {
      const onError = (name: string, e: unknown) => toast(`${name}: ${errorMessage(e)}`, 'error');
      const visuals = await importFiles(visualFiles.slice(0, tpl.visuals[1]), onError, undefined, noted);
      const [music] = tpl.music === 'none' ? [] : (await importFiles(musicFiles.slice(0, 1), onError)).filter((a) => a.hasAudio);
      if (visuals.length < tpl.visuals[0] || (tpl.music === 'required' && !music)) return;
      const assets = music ? [...visuals, music] : visuals;
      let p = createProject(t(tpl.name), tpl.aspect);
      p.assets = Object.fromEntries(assets.map((a) => [a.id, a]));
      let beats: number[] | undefined;
      if (tpl.id === 'beat' && music) {
        const { detectBeats } = await import('../engine/analysis');
        const grid = await detectBeats(p, music.id, () => undefined, new AbortController().signal);
        if (grid) { beats = grid.times; p.assets[music.id] = { ...music, beats: grid }; }
        else toast(t('No steady beat found, clips are cut evenly instead'));
      }
      p = produce(p, (d) => buildTemplate(d, tpl.id, visuals, music, beats, t));
      await saveProject(p);
      track('template_used', { id: tpl.id, visuals: visuals.length, music: !!music });
      open(p.id);
    } catch (e) {
      toast(t('Could not build the template: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function rename(m: ProjectMeta, to: string) {
    const fresh = to.trim();
    if (!fresh) return;
    setNaming(null);
    const p = await loadProject(m.id);
    if (p) { await saveProject({ ...p, name: fresh }); void refresh(); }
  }

  async function remove(m: ProjectMeta) {
    setDeleting(true); // the question waits: a second tap must not delete twice, nor «Отмена» pretend to stop it
    try {
      await deleteProject(m.id);
      toast(t('“{name}” is deleted', { name: m.name }));
    } catch (e) { toast(t('Could not delete the project: {error}', { error: errorMessage(e) }), 'error'); }
    // The question closes after the row is gone, so the focus goes to what is left (Confirm's afterClose), not to nothing.
    await refresh();
    setDeleting(false);
    setAsked(null);
  }

  // Someone who knew the buttons at the top is told once where they went; a first visit never saw them there.
  useEffect(() => { if (projects !== null && !projects.length && !movedSeen) { setKey(MOVED_KEY); setMovedSeen(true); } }, [projects, movedSeen]);
  const dismissMoved = () => { setKey(MOVED_KEY); setMovedSeen(true); };
  const movedNote = !movedSeen && !!projects?.length && !busy;

  // The dock lies over the bottom of the page: the page ends above it, and what gets the focus scrolls clear of it.
  useEffect(() => {
    const el = dock.current;
    if (!el) return;
    const page = document.documentElement;
    const ro = new ResizeObserver(() => page.style.setProperty('--home-dock', `${el.offsetHeight}px`));
    ro.observe(el);
    return () => { ro.disconnect(); page.style.removeProperty('--home-dock'); };
  }, []);

  // Renaming is typing: the name is in the field and selected, ready to be written over.
  useEffect(() => {
    if (!naming) return;
    const input = root.current?.querySelector<HTMLInputElement>('.ck-home-form input');
    input?.focus({ preventScroll: true });
    input?.select();
  }, [naming]);

  // Someone coming back sees their work first; the first visit starts with what can be made (audit V-187).
  const yours = (
    <section className="ck-home-section" aria-labelledby="home-yours">
      <h2 id="home-yours" className="ck-home-title">{t('Your projects')}{!!projects?.length && <span className="ck-home-count">{projects.length}</span>}</h2>
      {projects === null ? <p className="ck-home-dim">{t('Loading…')}</p> : projects.length === 0 ? (
        <Empty title={t('No projects yet')}>
          {t('Start a new one or try the sample.')}
          {/* The person who followed the advice and finds this list empty (audit V-164). */}
          {IOS && standalone() && <> {t('Projects made in Safari stay in Safari. To bring one here, open Kadr in Safari, save a backup of the project (↓), then tap “Restore backup” here.')}</>}
        </Empty>
      ) : (
        <ul className="ck-home-list">
          {projects.map((m) => (
            <li key={m.id}>
              <ProjectRow title={m.name} meta={`${formatTime(m.duration, false)}, ${new Date(m.updatedAt).toLocaleDateString()}, ${t('saved')}`}
                thumb={m.thumb ? <img src={m.thumb} alt="" /> : <span />} aspect={frame(m.aspect)} onOpen={() => open(m.id)} openLabel={t('Open {name}', { name: m.name })} hooks={{ row: 'project-card', open: 'project-open' }}
                actions={<>
                  <IconButton label={t('Save a backup of {name}', { name: m.name })} onClick={() => void backup(m)}><Download aria-hidden /></IconButton>
                  <IconButton label={t('Rename {name}', { name: m.name })} onClick={() => { setName(m.name); setNaming(m); }}><Pencil aria-hidden /></IconButton>
                  <IconButton label={t('Delete {name}', { name: m.name })} danger onClick={() => setAsked(m)}><Trash2 aria-hidden /></IconButton>
                </>} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );

  const aspects = (Object.keys(ASPECTS) as AspectId[]).map((a) => {
    const [w, h] = ASPECTS[a];
    return (
      <button key={a} type="button" className="ck-home-aspect aspect-card" onClick={() => { setPicking(false); void create(a); }}>
        <span className="ck-home-aspect-shape" style={{ aspectRatio: `${w} / ${h}` }} aria-hidden />
        <b>{a}</b>
        <small>{t(ASPECT_HINT[a])}</small>
      </button>
    );
  });

  return (
    <main className="ck ck-home" ref={root}>
      <div className="ck-home-in">
        <header className="ck-home-head">
          <span className="ck-home-logo" aria-hidden />
          <h1 className="ck-home-name">Kadr</h1>
          <div className="ck-home-lang">
            <Segments label={t('Language')} items={[{ id: 'en', label: 'EN' }, { id: 'ru', label: 'RU' }]} value={locale} onChange={(l) => setLocale(l as typeof locale)} />
          </div>
        </header>
        <p className="ck-home-note"><Lock aria-hidden />{t('Edit videos right in your browser.')} {t('Nothing is uploaded — your media stays on this device.')}</p>
        {install && !busy && (
          <div className="ck-home-install">
            <p className="ck-home-dim">{t('Installed, Kadr shows up in “Share” in your gallery: send a video straight to the editor.')}</p>
            <Button icon={<Smartphone aria-hidden />} onClick={() => void install()}>{t('Install Kadr')}</Button>
          </div>
        )}

        {inAppNotice.shown && <InAppNotice onDismiss={inAppNotice.dismiss} />}

        {!supported && (
          <div className="banner error">
            {t('This browser can’t edit video yet. Use a current Chrome, Edge or Safari 26+ (iPhone: iOS 26+).')}
          </div>
        )}

        {isTask(route ?? undefined) && !busy && (
          <section className="ck-home-card ck-home-task task-banner" aria-label={t(TASKS[route as TaskId].title)}>
            <b>{t(TASKS[route as TaskId].title)}</b>
            <div className="ck-home-task-acts">
              <Button variant="primary" disabled={!supported} onClick={() => void startTask(route as TaskId, true)}>
                {TASKS[route as TaskId].accept ? t('Choose a video') : t('Open')}
              </Button>
              <Button onClick={() => { location.hash = ''; }}>{t('Not now')}</Button>
            </div>
          </section>
        )}

        {!busy && !isTask(route ?? undefined) && (
          <button type="button" className="ck-home-card ck-home-reel" disabled={!supported} onClick={() => void startTask('reel')}>
            <Clapperboard aria-hidden />
            <span><b>{t('Reel in 1 tap')}</b><small>{t('Pick a video of you talking: pauses and “um”s go, captions, zooms and music come.')}</small></span>
            <ChevronRight className="ck-home-go" aria-hidden />
          </button>
        )}

        {movedNote && (
          <div className="ck-home-moved" role="note">
            <p>{t('The “New project”, “Try a sample” and “Restore backup” buttons are now at the bottom ↓')}</p>
            <Button variant="plain" onClick={dismissMoved}>{t('Got it')}</Button>
          </div>
        )}

        {/* The first step, in reach of the thumb (rule Ж3): one white button and what else starts a project. It comes
            here in reading order, after the reel, and lies at the bottom of the screen (on a low screen, here). */}
        <section className="ck-home-dock" ref={dock} aria-label={t('Start a project')}>
          {busy ? <p className="ck-home-busy" role="status">{busy}</p> : (
            <>
              <Button variant="primary" size="large" disabled={!supported} icon={<Plus aria-hidden />} onClick={() => { dismissMoved(); setPicking(true); }}>{t('New project')}</Button>
              <div className="ck-home-alt">
                <Button disabled={!supported} icon={<Sparkles aria-hidden />} onClick={() => void sample()}>{t('Try a sample')}</Button>
                <Button icon={<ArchiveRestore aria-hidden />} onClick={() => void held(restore)}>{t('Restore backup')}</Button>
              </div>
            </>
          )}
        </section>

        {!!projects?.length && yours}

        <section className="ck-home-section" aria-labelledby="home-templates">
          <h2 id="home-templates" className="ck-home-title">{t('Start from a template')}</h2>
          <div className="ck-home-templates">
            {TEMPLATES.map((tpl) => (
              <button key={tpl.id} type="button" className="ck-home-template template-card" disabled={!supported || !!busy} onClick={() => void held(() => fromTemplate(tpl))}>
                <span className={`ck-home-art ck-art-${tpl.id}`} style={{ aspectRatio: ASPECTS[tpl.aspect].join(' / ') }} aria-hidden />
                <b>{t(tpl.name)}</b>
                <small>{t(tpl.description)}</small>
              </button>
            ))}
          </div>
        </section>

        {keepTip && (
          <div className="ck-home-card ck-home-tip" role="note">
            <p>{t('iPhone erases a website’s data after 7 days without a visit. Add Kadr to the Home Screen and make your projects there: Share → Add to Home Screen.')}</p>
            {kept > 0 && <p>{t('Projects made in Safari stay in Safari, and you have {n} here. To move one, save its backup here (↓), then tap “Restore backup” in the Home Screen app.', { n: kept })}</p>}
            <Button onClick={dismissKeepTip}>{t('Got it')}</Button>
          </div>
        )}

        {!projects?.length && yours}

        <footer className="ck-home-foot home-foot">{/* home-foot: the iPhone script and the smoke test read the version here */}
          {t('Projects and media are stored in this browser.')} Kadr v{__APP_VERSION__}
          {' · '}<a href={`${locale}/privacy/`}>{t('Privacy')}</a>{' · '}<a href={`${locale}/licenses/`}>{t('Licenses')}</a>
        </footer>
      </div>

      <Sheet open={picking && !busy} title={t('Frame format')} closeLabel={t('Close')} closeIcon={<X aria-hidden />} onClose={() => setPicking(false)}>
        <div className="ck-home-aspects">{aspects}</div>
      </Sheet>
      <Sheet open={!!naming} title={t('Rename')} closeLabel={t('Close')} closeIcon={<X aria-hidden />} onClose={() => setNaming(null)}>
        <form className="ck-home-form" onSubmit={(e) => { e.preventDefault(); if (naming) void rename(naming, name); }}>
          <Field label={t('Project name')} value={name} onChange={setName} maxLength={80} count countLabel={(n, max) => t('{n} of {max} characters', { n, max })} enterKeyHint="done"
            error={name.trim() ? undefined : t('Write at least one letter: the name is how you find a project in the list.')} />
          <Button variant="primary" type="submit" disabled={!name.trim()}>{t('Save')}</Button>
        </form>
      </Sheet>
      <Confirm open={!!asked} title={t('Delete “{name}”?', { name: asked?.name ?? '' })}
        text={t('Its video and edits will be removed from this device. They cannot be brought back.')}
        confirmLabel={t('Delete')} cancelLabel={t('Cancel')} busy={deleting ? t('Deleting…') : undefined} onCancel={() => setAsked(null)} onConfirm={() => { if (asked) void remove(asked); }}
        afterClose={() => root.current?.querySelector<HTMLElement>('.ck-project-open') ?? root.current?.querySelector<HTMLElement>('.ck-home-dock .ck-primary')} />
    </main>
  );
}
