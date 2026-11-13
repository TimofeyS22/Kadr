import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, CircleAlert, Share } from 'lucide-react';
import { estimateMb, exportCost, exportDefaults, exportNotes, exportSource, isFast } from '../core/exportDefaults';
import { projectDuration } from '../core/timeline';
import { roundLeft, timeLeft } from '../core/exportProgress';
import type { ExportResult, Film } from '../engine/exporter';
import { GIF_FPS, MAX_GIF_S, gifSize, outputSize, supportedResolutions, type Resolution } from '../engine/exportSizes';
import { downloadFile, saveFile } from '../engine/save';
import { exportPrefs, savePrefs } from './exportPrefs';
import { releaseSpeechModel } from '../engine/captions';
import { player } from '../engine/player';
import { within } from '../lib/limits';
import { errorMessage, track } from '../lib/telemetry';
import { keepAwake } from '../lib/wakeLock';
import { editor, useEditor } from '../state/store';
import { IOS, prepareStaleSounds, staleSoundClips } from './actions';
import { Chips, Sheet, Toggle, num, secs } from './controls';
import { Button, Progress } from './ck/controls';
import { t } from '../lib/i18n';
import { useHoldUpdates } from '../lib/update';
import { useSheetGuard } from './controls';
import { clearDiskFiles } from '../engine/opfs';
import { keepError, type ErrorEntry } from '../lib/errorLog';
import { ErrorDetails } from './ErrorDetails';
import { IN_APP } from '../lib/device';
import { InAppNotice } from './InAppNotice';

type Format = 'video' | 'photo' | 'gif' | 'audio';
const FORMATS: Record<Format, string> = { video: 'Video', photo: 'Photo', gif: 'GIF', audio: 'Audio' };

/** What is being made, for the line under the progress and the facts of the file. */
interface Made { format: Format; w: number; h: number; fps?: number; mb?: number }
/** Pictures in the film an export shows while it is made (engine/exporter Film). */
const FILM = 8;

/** `left`: seconds still to go at the pace so far (core/exportProgress), once that can be said. */
type Phase = { kind: 'setup' } | { kind: 'running'; progress: number; label?: string; left?: number } | { kind: 'done'; result: ExportResult; quick?: boolean } | { kind: 'error'; message: string; detail: ErrorEntry };

/**
 * Quick export (v1.3, owner's feedback "saving should not take a dance"): on by default, the Export button renders
 * right away with the last settings and saves when done, like CapCut. Android and desktop download the file by
 * themselves; iPhone saves to Photos only through the share sheet, which needs a fresh tap, so it gets one Save button.
 */
/** The encoder gets this long to say which sizes it can do (docs/12 stage 2); then these are offered. */
const RESOLUTIONS_MS = 8000;
/** What the encoder said: the sizes it takes, and those of them it takes at 60 fps (null: not asked, or no answer). */
interface Encodable { sizes: Resolution[]; sizes60: Resolution[] | null }
const NO_ANSWER: Encodable = { sizes: [720, 1080], sizes60: null };
const LABEL: Record<Resolution, string> = { 720: '720p', 1080: '1080p', 1440: '2K', 2160: '4K' };
const PRESETS = [
  { id: 'social', label: t('TikTok, Reels, Shorts'), resolution: 1080, fps: 30, quality: 'high' },
  { id: 'best', label: t('Best quality'), resolution: 2160, fps: 30, quality: 'high' },
  { id: 'small', label: t('Small file'), resolution: 720, fps: 30, quality: 'standard' },
] as const;

/** What the browser says is free for this site, in MB; null when it does not say in 2 s. */
function freeSpace(): Promise<number | null> {
  const ask = navigator.storage?.estimate?.() ?? Promise.resolve(undefined);
  return within(ask, 2000, () => undefined).then((e) => (e?.quota ? (e.quota - (e.usage ?? 0)) / 1e6 : null), () => null);
}

/** A size in MB or GB, as people read it. */
const formatSize = (mb: number): string => (mb >= 1000 ? t('{n} GB', { n: (mb / 1000).toFixed(1) }) : t('{n} MB', { n: Math.max(1, Math.round(mb)) }));

export function ExportSheet() {
  const project = useEditor((s) => s.project)!;
  const [encodable, setEncodable] = useState<Encodable | null>(null);
  const supported = encodable?.sizes ?? null;
  const [prefs] = useState(exportPrefs);
  // Both are placeholders until the encoder answers: the start is then worked out from the videos (core/exportDefaults).
  const [resolution, setResolution] = useState<Resolution>(prefs.size ?? 1080);
  const [fps, setFps] = useState(project.settings.fps);
  // Picked by hand in this sheet: the encoder's answer does not undo it, and only a size picked by hand is remembered.
  const picked = useRef({ size: false, fps: false });
  const pickSize = (r: Resolution) => { picked.current.size = true; setResolution(r); };
  const pickFps = (f: number) => { picked.current.fps = true; setFps(f); };
  /** The size the videos get when no size was ever picked. */
  const own = useRef<Resolution | undefined>(undefined);
  const source = useMemo(() => exportSource(project), [project]);
  const cost = exportCost(source, resolution, fps, encodable?.sizes60 ?? null);
  const [quality, setQuality] = useState<'standard' | 'high'>(prefs.quality);
  // Consumed once: the Export button asked for a quick export (see startExport). It opens straight on the progress.
  // Not in an app's built-in browser: the person first reads that the file cannot be saved there (audit V-203).
  const [auto] = useState(() => { const a = useEditor.getState().startAuto; if (a) useEditor.setState({ startAuto: false }); return a && !IN_APP; });
  const [phase, setPhase] = useState<Phase>(() => (auto ? { kind: 'running', progress: 0 } : { kind: 'setup' }));
  useEffect(() => {
    if (phase.kind !== 'running') return;
    useEditor.setState({ locked: true });
    player.locked = true;
    return () => { useEditor.setState({ locked: false }); player.locked = false; };
  }, [phase.kind]);
  const [saved, setSaved] = useState(false);
  const save = (r: ExportResult) => void saveFile(r.blob, r.fileName).then((ok) => { if (ok) setSaved(true); });
  useHoldUpdates(phase.kind === 'running' || phase.kind === 'done'); // a reload would lose the export or the file
  useSheetGuard(phase.kind === 'running' ? t('The export is still running. Tap again to stop it.')
    : phase.kind === 'done' && !saved && !(phase.quick && !IOS) ? t('The video is not saved yet. Tap again to discard it.') : null);
  const [format, setFormat] = useState<Format>('video');
  const [loudness, setLoudness] = useState(prefs.evenLoudness);
  const [quick, setQuick] = useState(prefs.quick);
  const abort = useRef<AbortController | null>(null);
  const done = useRef(false);
  done.current = phase.kind === 'done';
  const [made, setMade] = useState<Made | null>(null);
  // The film: the export paints its own frames into these as it goes, and they stay when it is done.
  const slots = useRef<(HTMLCanvasElement | null)[]>([]);
  const film = useMemo<Film>(() => ({ frames: FILM, take: (picture, k) => paint(slots.current[k], picture) }), []);

  useEffect(() => {
    // The encoder is asked about each size; a browser that never answers gets the sizes every phone encodes.
    let alive = true;
    // 60 fps is asked about only where a video has it: on some browsers every question is a trial encode.
    const ask = Promise.all([supportedResolutions(project.settings), isFast(exportSource(project)) ? supportedResolutions(project.settings, 60) : null])
      .then(([sizes, sizes60]): Encodable => ({ sizes, sizes60 }));
    void within(ask, RESOLUTIONS_MS, () => NO_ANSWER).catch(() => NO_ANSWER).then((e) => {
      if (!alive) return; // closed before the answer: starting now would be an export nobody can see or stop (audit V-131)
      setEncodable(e);
      // Without an answer about 60 fps the export stays at 30: a rate the encoder did not agree to is not started on a guess.
      const start = exportDefaults(project, e.sizes, e.sizes60 ?? [], prefs.size);
      own.current = exportDefaults(project, e.sizes, e.sizes60 ?? []).resolution;
      if (start.resolution && !picked.current.size) setResolution(start.resolution);
      // A preset tapped before the answer keeps its size where the encoder takes it, else the largest below it.
      else if (picked.current.size) setResolution((r) => (e.sizes.includes(r) ? r : e.sizes.filter((x) => x <= r).at(-1) ?? e.sizes[0] ?? r));
      if (!picked.current.fps) setFps(start.fps);
      // Quick export (nobody sees the sheet) starts with the same size and frame rate the sheet would show; a very long
      // video, or a file that may not fit, waits for a tap on the sheet that says so (S-1-5).
      if (auto) {
        if (!start.resolution) { setPhase({ kind: 'setup' }); return; }
        const res = start.resolution;
        void freeSpace().then((free) => {
          if (!alive) return;
          setFreeMb(free);
          const d = projectDuration(project), notes = exportNotes(d, estimateMb(res, start.fps, prefs.quality, d), free);
          if (notes.long || notes.room) setPhase({ kind: 'setup' }); else void run(res, start.fps, true);
        });
      }
    });
    return () => { alive = false; abort.current?.abort(); };
  }, [project.settings]);
  // The finished file is on the device only while this sheet offers it (audit V-189).
  useEffect(() => () => { if (done.current) void clearDiskFiles(); }, []);
  useEffect(() => { void import('../engine/exporter').catch(() => undefined); }, []); // fetched now, so the button does not wait; a failure is said by the button's own import

  const duration = projectDuration(project);
  const [w, h] = outputSize(project.settings, resolution);
  /** About how many megabytes a video of this size and rate comes to (the encoder's bitrates, not a promise). */
  const mbFor = (res: Resolution, rate: number) => estimateMb(res, rate, quality, duration);
  const estMb = mbFor(resolution, fps);
  const [freeMb, setFreeMb] = useState<number | null>(null);
  useEffect(() => { void freeSpace().then(setFreeMb); }, []);
  const notes = exportNotes(duration, estMb, freeMb);

  async function run(res: Resolution = resolution, rate = fps, isQuick = false) {
    // The size is remembered only when picked by hand, and forgotten when the pick is the videos' own size: tapping
    // that is the way back to "as the video". A size worked out here and stored would hold the next, larger video down.
    const size = !picked.current.size ? exportPrefs().size : res === own.current ? undefined : res;
    if (format === 'video') savePrefs({ quick, quality, evenLoudness: loudness, ...(size ? { size } : {}) });
    player.pause();
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: 'running', progress: 0 });
    setSaved(false);
    const [rw, rh] = outputSize(project.settings, res);
    setMade(format === 'gif' ? { format, w: gifSize(project.settings)[0], h: gifSize(project.settings)[1], fps: GIF_FPS }
      : format === 'video' ? { format, w: rw, h: rh, fps: rate, mb: mbFor(res, rate) }
      : { format, w: format === 'photo' ? w : 0, h: format === 'photo' ? h : 0 });
    // Keep the screen on: a phone going to sleep is the most common way long exports die. Not awaited: a lock that
    // never answers must not hold the export.
    const awake = keepAwake();
    track('export_started', { format, resolution: res, fps: rate, quality, loudness, quick: isQuick, duration: Math.round(duration) });
    releaseSpeechModel(); // an export needs the memory more than a speech model kept for later
    try {
      let last = 0, since = performance.now();
      // A lower value is an export that started again (the GPU was reset, the encoder fell back to Baseline): shown at
      // once, and the time left is measured from there.
      const progress = (f: number) => {
        if (f < last) since = performance.now();
        if (f < last || f - last > 0.005 || f === 1) {
          last = f;
          setPhase({ kind: 'running', progress: f, left: timeLeft((performance.now() - since) / 1000, f) ?? undefined });
        }
      };
      // Sound with natural pitch (or noise reduction) that is not ready yet is made first, so the file matches the settings.
      const withSound = format === 'video' || format === 'audio';
      const p = withSound && staleSoundClips(project).length ? await prepareStaleSounds((f) => setPhase({ kind: 'running', progress: f, label: t('Preparing the sound…') }), ac.signal) : project;
      if (!p) return;
      const exporter = await import('../engine/exporter');
      const result = format === 'photo' ? await exporter.exportFrame(p, player.time, resolution)
        : format === 'gif' ? await exporter.exportGif(p, progress, ac.signal, film)
        : format === 'audio' ? await exporter.exportAudio(p, loudness, progress, ac.signal)
        : await exporter.exportProject(p, { resolution: res, fps: rate, quality, loudness }, progress, ac.signal, film);
      setPhase({ kind: 'done', result, quick: isQuick });
      if (isQuick && !IOS) downloadFile(result.blob, result.fileName);
      track('export_completed', { resolution: res, fps: rate, quick: isQuick, seconds: Math.round(result.seconds), mb: Math.round(result.blob.size / 1e6) });
    } catch (e) {
      // An encoder or decoder interrupted by Cancel fails with its own error: that is a cancel, not a failure.
      if ((e as Error).name === 'AbortError' || ac.signal.aborted) { setPhase({ kind: 'setup' }); track('export_cancelled'); return; }
      const message = errorMessage(e);
      setPhase({ kind: 'error', message, detail: keepError(e, 'export') });
      track('export_failed', { resolution: res, fps: rate, quick: isQuick, error: message.slice(0, 80) });
    }
    finally {
      awake();
    }
  }

  // In an app's built-in browser the way out is the one white button (copy the link): a file made here cannot be saved.
  const lead = IN_APP ? 'quiet' : 'primary';
  const filmed = phase.kind !== 'setup' && phase.kind !== 'error' && (made?.format === 'video' || made?.format === 'gif');
  const working = phase.kind === 'running' || phase.kind === 'done';
  const pct = phase.kind === 'running' ? Math.round(phase.progress * 100) : 100;
  const left = phase.kind === 'running' && phase.left !== undefined ? roundLeft(phase.left) : null;
  const leftText = left && t('about {t} left', { t: 'min' in left ? t('{n} min', { n: left.min }) : t('{n} s', { n: left.s }) });

  return (
    <Sheet title={t('Export')}>
      {(phase.kind === 'setup' || phase.kind === 'done') && <InAppNotice />}
      {working && (
        // One container from the first percent to the saved file: the film the export painted stays where it was.
        <div className="export-progress ck-work" data-film={filmed || undefined}>
          <Progress label={t('Export')} value={phase.kind === 'running' ? phase.progress : 1}>
            {filmed && Array.from({ length: FILM }, (_, k) => (
              <canvas key={k} className="ck-work-frame" aria-hidden ref={(c) => { slots.current[k] = c; }} />
            ))}
          </Progress>
          {phase.kind === 'running' && (
            <>
              <div className="ck-work-status">
                {/* One text for a reader and for the tests: «51% — не закрывайте экран»; the eye gets the number large. */}
                <p className="ck-work-now"><span className="ck-digit ck-work-pct">{pct}<small>%</small></span><span className="ck-sr"> — </span><span>{t('keep this screen open')}</span></p>
                {/* There from the first moment, so nothing jumps when the time can be said. */}
                <p className="ck-work-left" data-wait={!leftText || undefined}>{leftText ?? t('Working out the time left…')}</p>
              </div>
              <p className="ck-hint">{phase.label ?? (made && `${t(FORMATS[made.format])} · ${facts(made, duration)}`)}</p>
              <div className="ck-work-actions" data-pair>
                <Button onClick={() => abort.current?.abort()}>{t('Settings')}</Button>
                <Button onClick={() => { abort.current?.abort(); editor().openSheet(null); }}>{t('Cancel')}</Button>
              </div>
            </>
          )}
          {phase.kind === 'done' && (
            <>
              <p className="ck-work-ready">{t('Ready: {mb} MB in {s} s', { mb: num(phase.result.blob.size / 1e6, 1), s: num(phase.result.seconds, 1) })}</p>
              {made && <p className="ck-hint">{facts(made, duration, phase.result.fileName)}</p>}
              {phase.result.noSound && <Alert>{t('This browser cannot encode sound, so the file has no sound. Try Chrome or Safari.')}</Alert>}
              {phase.quick && !IOS && <p className="ck-work-saved"><Check aria-hidden />{t('Saved to Downloads.')}</p>}
              {phase.quick && IOS && <p className="ck-hint">{t('iPhone saves to Photos through the share sheet: tap Save, then “Save Video”.')}</p>}
              <div className="ck-work-actions" data-stack>
                {phase.quick && !IOS && <Button icon={<Share aria-hidden />} onClick={() => save(phase.result)}>{t('Share')}</Button>}
                <Button variant="plain" onClick={() => setPhase({ kind: 'setup' })}>{t('Export again')}</Button>
              </div>
            </>
          )}
        </div>
      )}
      {/* Where the file still has to be saved (iPhone, an export without quick save), «Сохранить» is held at the bottom of
          the sheet: on an iPhone 15 the film, the facts and the note about Photos pushed it half under the sheet's edge (L5). */}
      {phase.kind === 'done' && !(phase.quick && !IOS) && (
        <Foot lead={lead} disabled={false} onClick={() => save(phase.result)}>{phase.quick ? t('Save') : t('Save / Share')}</Foot>
      )}
      {phase.kind === 'setup' && (
        <Chips options={Object.keys(FORMATS) as Format[]} value={format} onChange={setFormat} render={(f) => t(FORMATS[f])} even />
      )}
      {phase.kind === 'setup' && format === 'photo' && (
        <>
          <h3>{t('Resolution')}</h3>
          {supported && <Chips options={supported} value={resolution} onChange={pickSize} render={(r) => LABEL[r]} even />}
          <p className="ck-hint">{t('The frame at the playhead as a {w}×{h} JPEG.', { w, h })}</p>
          <Foot lead={lead} disabled={duration <= 0} onClick={() => void run()}>{t('Save photo')}</Foot>
        </>
      )}
      {phase.kind === 'setup' && format === 'gif' && (
        <>
          {duration > MAX_GIF_S + 0.05
            ? <Alert>{t('GIF works for videos up to {n} s. Trim the project or export a video.', { n: MAX_GIF_S })}</Alert>
            : <p className="ck-hint">{t('Loops forever. No sound in GIF.')}</p>}
          <Foot lead={lead} sum={duration <= MAX_GIF_S + 0.05 ? facts({ format: 'gif', w: gifSize(project.settings)[0], h: gifSize(project.settings)[1], fps: GIF_FPS }, duration) : undefined}
            disabled={duration <= 0 || duration > MAX_GIF_S + 0.05} onClick={() => void run()}>{t('Export GIF')}</Foot>
        </>
      )}
      {phase.kind === 'setup' && format === 'audio' && (
        <>
          <Toggle label={t('Even loudness')} note={t('−14 LUFS, for TikTok and YouTube')} value={loudness} onChange={setLoudness} />
          <Foot lead={lead} sum={facts({ format: 'audio', w: 0, h: 0 }, duration)} disabled={duration <= 0} onClick={() => void run()}>{t('Export audio')}</Foot>
        </>
      )}
      {phase.kind === 'setup' && format === 'video' && (
        <>
          <h3>{t('Presets')}</h3>
          <Chips options={PRESETS.map((p) => p.id)} render={(id) => PRESETS.find((p) => p.id === id)!.label}
            value={PRESETS.find((p) => p.resolution === resolution && p.fps === fps && p.quality === quality)?.id ?? null}
            onChange={(id) => {
              const pr = PRESETS.find((p) => p.id === id)!;
              // Tapped before the encoder answered: the preset's own size, fitted to the answer when it comes (see above).
              const res = !supported || supported.includes(pr.resolution) ? pr.resolution : supported.at(-1) ?? 1080;
              pickSize(res); pickFps(pr.fps); setQuality(pr.quality);
            }} />
          <h3>{t('Resolution')}</h3>
          {supported?.length === 0 ? <Alert>{t('This browser cannot encode video. Try Chrome or Safari.')}</Alert> : supported === null ? <p className="ck-hint">{t('Checking what this device can encode…')}</p> : (
            <Chips options={supported} value={resolution} onChange={pickSize} render={(r) => LABEL[r]} even />
          )}
          {/* Nothing is lost or blown up without a word (audit V-216): a choice that costs the video something says what. */}
          {!!supported?.length && cost.larger && <p className="ck-hint">{t('Larger than the source: the file grows, the picture does not get sharper.')}</p>}
          <h3>{t('Frame rate')}</h3>
          <Chips options={[24, 25, 30, 60] as const} value={fps} onChange={pickFps} render={(f) => `${f}`} even />
          {!!supported?.length && cost.frames && (
            <p className="ck-hint">
              {cost.frames.half ? t('The video is {src} fps: at {fps} every second frame is dropped.', { src: cost.frames.from, fps })
                : t('The video is {src} fps: at {fps} some of its frames are dropped.', { src: cost.frames.from, fps })}
              {cost.no60 && ` ${t('This device cannot encode this size at 60 fps.')}`}
            </p>
          )}
          <h3>{t('Quality')}</h3>
          <Chips options={['standard', 'high'] as const} value={quality} onChange={setQuality} render={(q) => (q === 'high' ? t('High') : t('Standard'))} even />
          <Toggle label={t('Even loudness')} note={t('−14 LUFS, for TikTok and YouTube')} value={loudness} onChange={setLoudness} />
          <Toggle label={t('Quick export')} note={t('The Export button saves right away with these settings')} value={quick}
            onChange={(v) => { setQuick(v); savePrefs({ ...exportPrefs(), quick: v }); }} />
          <p className="ck-hint">{t('Rendered on this device, nothing is uploaded.')}</p>
          {/* Said before the export, not found out after an hour of it (S-1-5). */}
          {notes.long && <p className="ck-hint">{t('A {min}-minute video: the file will be about {size}, and the export takes a while. Keep the screen on.', { min: Math.round(duration / 60), size: formatSize(estMb) })}</p>}
          {notes.room && <Alert>{t('The file will be about {size}, and this device has {free} free: it may not fit. Free up space or pick a smaller size.', { size: formatSize(estMb), free: formatSize(freeMb ?? 0) })}</Alert>}
          <Foot lead={lead} sum={facts({ format: 'video', w, h, fps, mb: estMb }, duration)} disabled={!supported?.length || duration <= 0} onClick={() => void run()}>{t('Export video')}</Foot>
        </>
      )}
      {phase.kind === 'error' && (
        <div className="export-progress ck-work">
          <Alert>{t('Export failed: {error}', { error: phase.message })}</Alert>
          <details className="error-more ck-more"><summary>{t('Details')}</summary><ErrorDetails entry={phase.detail} /></details>
          <div className="ck-work-actions"><Button onClick={() => setPhase({ kind: 'setup' })}>{t('Back')}</Button></div>
        </div>
      )}
    </Sheet>
  );
}

/** What a file is, in a line: «1080×1920 · 7,5 с · 30 к/с · около 7 МБ», or, made, «… · MP4». */
function facts(m: Made, duration: number, fileName?: string): string {
  const kind = fileName?.split('.').pop()?.toUpperCase();
  return [
    m.format === 'audio' ? null : `${m.w}×${m.h}`,
    m.format === 'photo' ? null : secs(duration),
    m.fps && !fileName ? t('{n} fps', { n: m.fps }) : null,
    m.mb !== undefined && !fileName ? t('about {mb} MB', { mb: m.mb < 1 ? 1 : Math.round(m.mb) }) : null,
    kind ?? null,
  ].filter(Boolean).join(' · ');
}

/** What went wrong or cannot be: a sign and words, not a colour (DESIGN.md §2.3: red is for deleting only). */
function Alert({ children }: { children: ReactNode }) {
  return <p className="error-text ck-alert" role="alert"><CircleAlert aria-hidden /><span>{children}</span></p>;
}

/**
 * The sheet's one action, held at the bottom of the sheet (seen without scrolling, in the same place for every format),
 * with what it will make as its second line.
 */
function Foot({ lead, sum, disabled, onClick, children }: { lead: 'primary' | 'quiet'; sum?: string; disabled: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <div className="ck-panel-foot">
      <Button variant={lead} size="large" disabled={disabled} onClick={onClick}>{children}{sum && <small className="ck-btn-sub">{sum}</small>}</Button>
    </div>
  );
}

/** Copies the export's own frame into a slot of the film, filling it as the timeline's film does. */
function paint(slot: HTMLCanvasElement | null | undefined, picture: HTMLCanvasElement): void {
  if (!slot || !picture.width || !picture.height) return;
  const r = slot.getBoundingClientRect();
  const k = Math.min(2, devicePixelRatio || 1);
  const w = Math.max(1, Math.round(r.width * k)), h = Math.max(1, Math.round(r.height * k));
  if (slot.width !== w || slot.height !== h) { slot.width = w; slot.height = h; }
  const s = Math.max(w / picture.width, h / picture.height);
  slot.getContext('2d')?.drawImage(picture, (w - picture.width * s) / 2, (h - picture.height * s) / 2, picture.width * s, picture.height * s);
}
