import { useEffect, useRef, useState } from 'react';
import { projectDuration } from '../core/timeline';
import {
  MAX_GIF_S, downloadFile, exportAudio, exportFrame, exportGif, exportProject, gifSize, outputSize, saveFile, supportedResolutions, type ExportResult, type Resolution,
} from '../engine/exporter';
import { player } from '../engine/player';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { IOS, prepareStaleSounds, staleSoundClips } from './actions';
import { Chips, Sheet, Toggle } from './controls';
import { t } from '../lib/i18n';

type Format = 'video' | 'photo' | 'gif' | 'audio';
const FORMATS: Record<Format, string> = { video: 'Video', photo: 'Photo', gif: 'GIF', audio: 'Audio' };

type Phase = { kind: 'setup' } | { kind: 'running'; progress: number; label?: string } | { kind: 'done'; result: ExportResult; quick?: boolean } | { kind: 'error'; message: string };

/**
 * Quick export (v1.3, owner's feedback "saving should not take a dance"): on by default, the Export button renders
 * right away with the last settings and saves when done, like CapCut. Android and desktop download the file by
 * themselves; iPhone saves to Photos only through the share sheet, which needs a fresh tap, so it gets one Save button.
 */
/** The frame rate is not kept: it follows each project's own. */
interface ExportPrefs { quick: boolean; resolution: Resolution; quality: 'standard' | 'high'; loudness: boolean }
const PREFS_KEY = 'kadr.exportPrefs';
function exportPrefs(): ExportPrefs {
  const base: ExportPrefs = { quick: true, resolution: 1080, quality: 'high', loudness: true };
  try { return { ...base, ...(JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<ExportPrefs>) }; } catch { return base; }
}
function savePrefs(p: ExportPrefs): void {
  try { localStorage.setItem(PREFS_KEY, JSON.stringify(p)); } catch { /* storage off: defaults next time */ }
}

/** The Export button: with quick export on, the sheet starts rendering at once. */
export function startExport(): void {
  useEditor.setState({ startAuto: exportPrefs().quick });
  editor().openSheet('export');
}

const QUALITY_MBPS: Record<Resolution, number> = { 720: 5, 1080: 10, 1440: 18, 2160: 35 };
const LABEL: Record<Resolution, string> = { 720: '720p', 1080: '1080p', 1440: '2K', 2160: '4K' };
const PRESETS = [
  { id: 'social', label: t('TikTok, Reels, Shorts'), resolution: 1080, fps: 30, quality: 'high' },
  { id: 'best', label: t('Best quality'), resolution: 2160, fps: 30, quality: 'high' },
  { id: 'small', label: t('Small file'), resolution: 720, fps: 30, quality: 'standard' },
] as const;

export function ExportSheet() {
  const project = useEditor((s) => s.project)!;
  const [supported, setSupported] = useState<Resolution[] | null>(null);
  const [prefs] = useState(exportPrefs);
  const [resolution, setResolution] = useState<Resolution>(prefs.resolution);
  const [fps, setFps] = useState(project.settings.fps);
  const [quality, setQuality] = useState<'standard' | 'high'>(prefs.quality);
  // Consumed once: the Export button asked for a quick export (see startExport). It opens straight on the progress.
  const [auto] = useState(() => { const a = useEditor.getState().startAuto; if (a) useEditor.setState({ startAuto: false }); return a; });
  const [phase, setPhase] = useState<Phase>(() => (auto ? { kind: 'running', progress: 0 } : { kind: 'setup' }));
  const [format, setFormat] = useState<Format>('video');
  const [loudness, setLoudness] = useState(prefs.loudness);
  const [quick, setQuick] = useState(prefs.quick);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    supportedResolutions(project.settings).then((r) => {
      setSupported(r);
      // The saved resolution, or the best this device can encode below it.
      const fit = r.includes(prefs.resolution) ? prefs.resolution : r.filter((x) => x <= prefs.resolution).at(-1) ?? r.at(-1);
      if (fit && fit !== prefs.resolution) setResolution(fit);
      if (auto) { if (fit) void run(fit, true); else setPhase({ kind: 'setup' }); }
    });
    return () => abort.current?.abort();
  }, [project.settings]);

  const duration = projectDuration(project);
  const [w, h] = outputSize(project.settings, resolution);
  const estMb = (QUALITY_MBPS[resolution] * (quality === 'high' ? 1.5 : 1) * (fps > 30 ? 1.4 : 1) * duration) / 8;

  async function run(res: Resolution = resolution, isQuick = false) {
    if (format === 'video') savePrefs({ quick, resolution: res, quality, loudness });
    player.pause();
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: 'running', progress: 0 });
    // Keep the screen on: a phone going to sleep is the most common way long exports die.
    const lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
      .wakeLock?.request('screen').catch(() => null);
    track('export_started', { format, resolution: res, fps, quality, loudness, quick: isQuick, duration: Math.round(duration) });
    try {
      let last = 0;
      const progress = (f: number) => { if (f - last > 0.005 || f === 1) { last = f; setPhase({ kind: 'running', progress: f }); } };
      // Sound with natural pitch (or noise reduction) that is not ready yet is made first, so the file matches the settings.
      const withSound = format === 'video' || format === 'audio';
      const p = withSound && staleSoundClips(project).length ? await prepareStaleSounds((f) => setPhase({ kind: 'running', progress: f, label: t('Preparing the sound…') }), ac.signal) : project;
      if (!p) return;
      const result = format === 'photo' ? await exportFrame(p, player.time, resolution)
        : format === 'gif' ? await exportGif(p, progress, ac.signal)
        : format === 'audio' ? await exportAudio(p, loudness, progress, ac.signal)
        : await exportProject(p, { resolution: res, fps, quality, loudness }, progress, ac.signal);
      setPhase({ kind: 'done', result, quick: isQuick });
      if (isQuick && !IOS) downloadFile(result.blob, result.fileName);
      track('export_completed', { resolution: res, fps, quick: isQuick, seconds: Math.round(result.seconds), mb: Math.round(result.blob.size / 1e6) });
    } catch (e) {
      // An encoder or decoder interrupted by Cancel fails with its own error: that is a cancel, not a failure.
      if ((e as Error).name === 'AbortError' || ac.signal.aborted) { setPhase({ kind: 'setup' }); track('export_cancelled'); return; }
      setPhase({ kind: 'error', message: errorMessage(e) });
      track('export_failed', { resolution: res, fps, quick: isQuick, error: errorMessage(e).slice(0, 80) });
    }
    finally {
      void lock?.release().catch(() => undefined);
    }
  }

  return (
    <Sheet title={t('Export')}>
      {phase.kind === 'setup' && (
        <Chips options={Object.keys(FORMATS) as Format[]} value={format} onChange={setFormat} render={(f) => t(FORMATS[f])} />
      )}
      {phase.kind === 'setup' && format === 'photo' && (
        <>
          <h3>{t('Resolution')}</h3>
          {supported && <Chips options={supported} value={resolution} onChange={setResolution} render={(r) => LABEL[r]} />}
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
              const res = supported?.includes(pr.resolution) ? pr.resolution : supported?.at(-1) ?? 1080;
              setResolution(res); setFps(pr.fps); setQuality(pr.quality);
            }} />
          <h3>{t('Resolution')}</h3>
          {supported === null ? <p className="hint">{t('Checking what this device can encode…')}</p> : (
            <Chips options={supported} value={resolution} onChange={setResolution} render={(r) => LABEL[r]} />
          )}
          <h3>{t('Frame rate')}</h3>
          <Chips options={[24, 25, 30, 60] as const} value={fps} onChange={setFps} render={(f) => `${f}`} />
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
          {phase.quick && !IOS && <p className="hint">{t('Saved to Downloads.')}</p>}
          {phase.quick && IOS && <p className="hint">{t('iPhone saves to Photos through the share sheet: tap Save, then “Save Video”.')}</p>}
          {phase.quick && !IOS
            ? <button className="btn" onClick={() => void saveFile(phase.result.blob, phase.result.fileName)}>{t('Share')}</button>
            : <button className="btn primary big" onClick={() => void saveFile(phase.result.blob, phase.result.fileName)}>{phase.quick ? t('Save') : t('Save / Share')}</button>}
          <button className="btn" onClick={() => setPhase({ kind: 'setup' })}>{t('Export again')}</button>
        </div>
      )}
      {phase.kind === 'error' && (
        <div className="export-progress">
          <p className="error-text">{t('Export failed: {error}', { error: phase.message })}</p>
          <button className="btn" onClick={() => setPhase({ kind: 'setup' })}>{t('Back')}</button>
        </div>
      )}
    </Sheet>
  );
}
