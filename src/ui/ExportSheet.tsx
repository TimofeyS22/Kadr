import { useEffect, useRef, useState } from 'react';
import { projectDuration } from '../core/timeline';
import { exportProject, outputSize, saveFile, supportedResolutions, type ExportResult, type Resolution } from '../engine/exporter';
import { player } from '../engine/player';
import { errorMessage, track } from '../lib/telemetry';
import { useEditor } from '../state/store';
import { Chips, Sheet } from './controls';
import { t } from '../lib/i18n';

type Phase = { kind: 'setup' } | { kind: 'running'; progress: number } | { kind: 'done'; result: ExportResult } | { kind: 'error'; message: string };

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
  const [resolution, setResolution] = useState<Resolution>(1080);
  const [fps, setFps] = useState(project.settings.fps);
  const [quality, setQuality] = useState<'standard' | 'high'>('high');
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    supportedResolutions(project.settings).then((r) => {
      setSupported(r);
      if (!r.includes(1080) && r.length) setResolution(r[r.length - 1]);
    });
    return () => abort.current?.abort();
  }, [project.settings]);

  const duration = projectDuration(project);
  const [w, h] = outputSize(project.settings, resolution);
  const estMb = (QUALITY_MBPS[resolution] * (quality === 'high' ? 1.5 : 1) * (fps > 30 ? 1.4 : 1) * duration) / 8;

  async function run() {
    player.pause();
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: 'running', progress: 0 });
    // Keep the screen on: a phone going to sleep is the most common way long exports die.
    const lock = await (navigator as Navigator & { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } })
      .wakeLock?.request('screen').catch(() => null);
    track('export_started', { resolution, fps, quality, duration: Math.round(duration) });
    try {
      let last = 0;
      const result = await exportProject(project, { resolution, fps, quality }, (f) => {
        if (f - last > 0.005 || f === 1) { last = f; setPhase({ kind: 'running', progress: f }); }
      }, ac.signal);
      setPhase({ kind: 'done', result });
      track('export_completed', { resolution, fps, seconds: Math.round(result.seconds), mb: Math.round(result.blob.size / 1e6) });
    } catch (e) {
      if ((e as Error).name === 'AbortError') { setPhase({ kind: 'setup' }); track('export_cancelled'); return; }
      setPhase({ kind: 'error', message: errorMessage(e) });
      track('export_failed', { resolution, fps, error: errorMessage(e).slice(0, 80) });
    }
    finally {
      void lock?.release().catch(() => undefined);
    }
  }

  return (
    <Sheet title={t('Export')}>
      {phase.kind === 'setup' && (
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
          <p className="hint">{t('{w}×{h}, {s} s, about {mb} MB. Rendered on this device, nothing is uploaded.', { w, h, s: duration.toFixed(1), mb: estMb < 1 ? 1 : Math.round(estMb) })}</p>
          <button className="btn primary big" disabled={!supported?.length || duration <= 0} onClick={run}>{t('Export video')}</button>
        </>
      )}
      {phase.kind === 'running' && (
        <div className="export-progress">
          <div className="progress"><div style={{ width: `${phase.progress * 100}%` }} /></div>
          <p>{t('{p}% — keep this screen open', { p: Math.round(phase.progress * 100) })}</p>
          <button className="btn" onClick={() => abort.current?.abort()}>{t('Cancel')}</button>
        </div>
      )}
      {phase.kind === 'done' && (
        <div className="export-progress">
          <p>{t('Ready: {mb} MB in {s} s', { mb: (phase.result.blob.size / 1e6).toFixed(1), s: phase.result.seconds.toFixed(1) })}</p>
          <button className="btn primary big" onClick={() => saveFile(phase.result.blob, phase.result.fileName)}>{t('Save / Share')}</button>
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
