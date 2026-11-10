import { useEffect, useMemo, useRef, useState } from 'react';
import { exportCost, exportDefaults, exportSource, isFast } from '../core/exportDefaults';
import { projectDuration } from '../core/timeline';
import type { ExportResult } from '../engine/exporter';
import { MAX_GIF_S, gifSize, outputSize, supportedResolutions, type Resolution } from '../engine/exportSizes';
import { downloadFile, saveFile } from '../engine/save';
import { exportPrefs, savePrefs } from './exportPrefs';
import { releaseSpeechModel } from '../engine/captions';
import { player } from '../engine/player';
import { within } from '../lib/limits';
import { errorMessage, track } from '../lib/telemetry';
import { keepAwake } from '../lib/wakeLock';
import { editor, useEditor } from '../state/store';
import { IOS, prepareStaleSounds, staleSoundClips } from './actions';
import { Chips, Sheet, Toggle } from './controls';
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

type Phase = { kind: 'setup' } | { kind: 'running'; progress: number; label?: string } | { kind: 'done'; result: ExportResult; quick?: boolean } | { kind: 'error'; message: string; detail: ErrorEntry };

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
const QUALITY_MBPS: Record<Resolution, number> = { 720: 5, 1080: 10, 1440: 18, 2160: 35 };
const LABEL: Record<Resolution, string> = { 720: '720p', 1080: '1080p', 1440: '2K', 2160: '4K' };
const PRESETS = [
  { id: 'social', label: t('TikTok, Reels, Shorts'), resolution: 1080, fps: 30, quality: 'high' },
  { id: 'best', label: t('Best quality'), resolution: 2160, fps: 30, quality: 'high' },
  { id: 'small', label: t('Small file'), resolution: 720, fps: 30, quality: 'standard' },
] as const;

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
      // Quick export (nobody sees the sheet) starts with the same size and frame rate the sheet would show.
      if (auto) { if (start.resolution) void run(start.resolution, start.fps, true); else setPhase({ kind: 'setup' }); }
    });
    return () => { alive = false; abort.current?.abort(); };
  }, [project.settings]);
  // The finished file is on the device only while this sheet offers it (audit V-189).
  useEffect(() => () => { if (done.current) void clearDiskFiles(); }, []);
  useEffect(() => { void import('../engine/exporter').catch(() => undefined); }, []); // fetched now, so the button does not wait; a failure is said by the button's own import

  const duration = projectDuration(project);
  const [w, h] = outputSize(project.settings, resolution);
  const estMb = (QUALITY_MBPS[resolution] * (quality === 'high' ? 1.5 : 1) * (fps > 30 ? 1.4 : 1) * duration) / 8;

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
    // Keep the screen on: a phone going to sleep is the most common way long exports die. Not awaited: a lock that
    // never answers must not hold the export.
    const awake = keepAwake();
    track('export_started', { format, resolution: res, fps: rate, quality, loudness, quick: isQuick, duration: Math.round(duration) });
    releaseSpeechModel(); // an export needs the memory more than a speech model kept for later
    try {
      let last = 0;
      // A lower value is an export that started again (the GPU was reset, the encoder fell back to Baseline): shown at once.
      const progress = (f: number) => { if (f < last || f - last > 0.005 || f === 1) { last = f; setPhase({ kind: 'running', progress: f }); } };
      // Sound with natural pitch (or noise reduction) that is not ready yet is made first, so the file matches the settings.
      const withSound = format === 'video' || format === 'audio';
      const p = withSound && staleSoundClips(project).length ? await prepareStaleSounds((f) => setPhase({ kind: 'running', progress: f, label: t('Preparing the sound…') }), ac.signal) : project;
      if (!p) return;
      const exporter = await import('../engine/exporter');
      const result = format === 'photo' ? await exporter.exportFrame(p, player.time, resolution)
        : format === 'gif' ? await exporter.exportGif(p, progress, ac.signal)
        : format === 'audio' ? await exporter.exportAudio(p, loudness, progress, ac.signal)
        : await exporter.exportProject(p, { resolution: res, fps: rate, quality, loudness }, progress, ac.signal);
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

  return (
    <Sheet title={t('Export')}>
      {(phase.kind === 'setup' || phase.kind === 'done') && <InAppNotice />}
      {phase.kind === 'setup' && (
        <Chips options={Object.keys(FORMATS) as Format[]} value={format} onChange={setFormat} render={(f) => t(FORMATS[f])} />
      )}
      {phase.kind === 'setup' && format === 'photo' && (
        <>
          <h3>{t('Resolution')}</h3>
          {supported && <Chips options={supported} value={resolution} onChange={pickSize} render={(r) => LABEL[r]} />}
          <p className="hint">{t('The frame at the playhead as a {w}×{h} JPEG.', { w, h })}</p>
          <button className="btn primary big" disabled={duration <= 0} onClick={() => void run()}>{t('Save photo')}</button>
        </>
      )}
      {phase.kind === 'setup' && format === 'gif' && (
        <>
          <p className="hint">{duration > MAX_GIF_S + 0.05
            ? t('GIF works for videos up to {n} s. Trim the project or export a video.', { n: MAX_GIF_S })
            : t('{w}×{h}, 12 fps, loops forever. No sound in GIF.', { w: gifSize(project.settings)[0], h: gifSize(project.settings)[1] })}</p>
          <button className="btn primary big" disabled={duration <= 0 || duration > MAX_GIF_S + 0.05} onClick={() => void run()}>{t('Export GIF')}</button>
        </>
      )}
      {phase.kind === 'setup' && format === 'audio' && (
        <>
          <Toggle label={t('Even loudness for TikTok and YouTube (−14 LUFS)')} value={loudness} onChange={setLoudness} />
          <p className="hint">{t('The whole soundtrack, {s} s.', { s: duration.toFixed(1) })}</p>
          <button className="btn primary big" disabled={duration <= 0} onClick={() => void run()}>{t('Export audio')}</button>
        </>
      )}
      {phase.kind === 'setup' && format === 'video' && (
        <>
          <Chips options={PRESETS.map((p) => p.id)} render={(id) => PRESETS.find((p) => p.id === id)!.label}
            value={PRESETS.find((p) => p.resolution === resolution && p.fps === fps && p.quality === quality)?.id ?? null}
            onChange={(id) => {
              const pr = PRESETS.find((p) => p.id === id)!;
              // Tapped before the encoder answered: the preset's own size, fitted to the answer when it comes (see above).
              const res = !supported || supported.includes(pr.resolution) ? pr.resolution : supported.at(-1) ?? 1080;
              pickSize(res); pickFps(pr.fps); setQuality(pr.quality);
            }} />
          <h3>{t('Resolution')}</h3>
          {supported?.length === 0 ? <p className="error-text">{t('This browser cannot encode video. Try Chrome or Safari.')}</p> : supported === null ? <p className="hint">{t('Checking what this device can encode…')}</p> : (
            <Chips options={supported} value={resolution} onChange={pickSize} render={(r) => LABEL[r]} />
          )}
          {/* Nothing is lost or blown up without a word (audit V-216): a choice that costs the video something says what. */}
          {!!supported?.length && cost.larger && <p className="hint">{t('Larger than the source: the file grows, the picture does not get sharper.')}</p>}
          <h3>{t('Frame rate')}</h3>
          <Chips options={[24, 25, 30, 60] as const} value={fps} onChange={pickFps} render={(f) => `${f}`} />
          {!!supported?.length && cost.frames && (
            <p className="hint">
              {cost.frames.half ? t('The video is {src} fps: at {fps} every second frame is dropped.', { src: cost.frames.from, fps })
                : t('The video is {src} fps: at {fps} some of its frames are dropped.', { src: cost.frames.from, fps })}
              {cost.no60 && ` ${t('This device cannot encode this size at 60 fps.')}`}
            </p>
          )}
          <h3>{t('Quality')}</h3>
          <Chips options={['standard', 'high'] as const} value={quality} onChange={setQuality} render={(q) => (q === 'high' ? t('High') : t('Standard'))} />
          <Toggle label={t('Even loudness for TikTok and YouTube (−14 LUFS)')} value={loudness} onChange={setLoudness} />
          <Toggle label={t('Quick export: the Export button saves right away with these settings')} value={quick}
            onChange={(v) => { setQuick(v); savePrefs({ ...exportPrefs(), quick: v }); }} />
          <p className="hint">{t('{w}×{h}, {s} s, about {mb} MB. Rendered on this device, nothing is uploaded.', { w, h, s: duration.toFixed(1), mb: estMb < 1 ? 1 : Math.round(estMb) })}</p>
          <button className="btn primary big" disabled={!supported?.length || duration <= 0} onClick={() => void run()}>{t('Export video')}</button>
        </>
      )}
      {phase.kind === 'running' && (
        <div className="export-progress">
          <div className="progress"><div style={{ width: `${phase.progress * 100}%` }} /></div>
          <p>{phase.label && `${phase.label} `}{t('{p}% — keep this screen open', { p: Math.round(phase.progress * 100) })}</p>
          <button className="btn" onClick={() => abort.current?.abort()}>{t('Settings')}</button>
          <button className="btn" onClick={() => { abort.current?.abort(); editor().openSheet(null); }}>{t('Cancel')}</button>
        </div>
      )}
      {phase.kind === 'done' && (
        <div className="export-progress">
          <p>{t('Ready: {mb} MB in {s} s', { mb: (phase.result.blob.size / 1e6).toFixed(1), s: phase.result.seconds.toFixed(1) })}</p>
          {phase.result.noSound && <p className="error-text">{t('This browser cannot encode sound, so the file has no sound. Try Chrome or Safari.')}</p>}
          {phase.quick && !IOS && <p className="hint">{t('Saved to Downloads.')}</p>}
          {phase.quick && IOS && <p className="hint">{t('iPhone saves to Photos through the share sheet: tap Save, then “Save Video”.')}</p>}
          {phase.quick && !IOS
            ? <button className="btn" onClick={() => save(phase.result)}>{t('Share')}</button>
            : <button className="btn primary big" onClick={() => save(phase.result)}>{phase.quick ? t('Save') : t('Save / Share')}</button>}
          <button className="btn" onClick={() => setPhase({ kind: 'setup' })}>{t('Export again')}</button>
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="export-progress">
          <p className="error-text">{t('Export failed: {error}', { error: phase.message })}</p>
          <details className="error-more"><summary>{t('Details')}</summary><ErrorDetails entry={phase.detail} /></details>
          <button className="btn" onClick={() => setPhase({ kind: 'setup' })}>{t('Back')}</button>
        </div>
      )}
    </Sheet>
  );
}
