// "Reel in one tap" sheet (docs/08 A): a few switches, one button, an honest progress and a summary that can be undone.
import { useEffect, useRef, useState } from 'react';
import { MOODS, type Mood } from '../core/music';
import { player } from '../engine/player';
import { CAPTION_PRESETS } from '../core/presets';
import { CAPTION_LANGUAGES } from '../engine/captions';
import { formatTime } from './format';
import { t } from '../lib/i18n';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { DEFAULT_REEL, makeReel, undoSteps, type ReelOptions, type ReelReport } from './autoreel';
import { Chips, Toggle } from './controls';
import { MOOD_LABEL } from './MusicSheet';
import { StyleSwatch } from './swatch';
import { defaultLanguage } from './ToolSheets';

const KEY = 'kadr.reel';
function loadOptions(): ReelOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ReelOptions> | null;
    return { ...DEFAULT_REEL, language: defaultLanguage(), ...saved };
  } catch { return { ...DEFAULT_REEL, language: defaultLanguage() }; }
}
const saveOptions = (o: ReelOptions) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* storage blocked */ } };

type Phase = { kind: 'setup' } | { kind: 'running'; label: string; f: number | null } | { kind: 'done'; report: ReelReport };

export function ReelBody() {
  const [o, setO] = useState(loadOptions);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  const abort = useRef<AbortController | null>(null);
  const set = (patch: Partial<ReelOptions>) => setO((x) => { const n = { ...x, ...patch }; saveOptions(n); return n; });
  useEffect(() => () => abort.current?.abort(), []);

  // From the home card / a deep link: start right away with the saved options.
  useEffect(() => {
    if (!useEditor.getState().startAuto) return;
    useEditor.setState({ startAuto: false });
    void run();
  }, []);

  async function run() {
    const ac = new AbortController();
    abort.current = ac;
    setPhase({ kind: 'running', label: t('Getting ready…'), f: null });
    try {
      const report = await makeReel(o, (label, f) => setPhase({ kind: 'running', label, f }), ac.signal);
      setPhase({ kind: 'done', report });
    } catch (e) {
      setPhase({ kind: 'setup' });
      if ((e as Error).name !== 'AbortError') editor().toast(t('Could not make the reel: {error}', { error: errorMessage(e) }), 'error');
    }
  }

  if (phase.kind === 'running') {
    return (
      <div className="export-progress">
        <div className="progress">{phase.f === null ? <div className="indeterminate" style={{ width: '30%' }} /> : <div style={{ width: `${Math.round(phase.f * 100)}%` }} />}</div>
        <p>{phase.label}{phase.f !== null && ` ${Math.round(phase.f * 100)}%`}</p>
        <button className="btn" onClick={() => abort.current?.abort()}>{t('Cancel')}</button>
      </div>
    );
  }

  if (phase.kind === 'done') {
    const r = phase.report;
    return (
      <div className="reel-done">
        <p className="reel-length"><b>{formatTime(r.before)}</b> → <b>{formatTime(r.after)}</b></p>
        <ul className="reel-list">
          {r.noSpeech && <li>{t('No speech found: captions, fillers and the title were skipped')}</li>}
          {r.pauses > 0 && <li>{t('Pauses removed: {n}', { n: r.pauses })}</li>}
          {r.fillers > 0 && <li>{t('Fillers and repeats removed: {n}', { n: r.fillers })}</li>}
          {r.words > 0 && <li>{t('Captions: {n} words, the spoken word lights up', { n: r.words })}</li>}
          {r.zoomed > 0 && <li>{t('Zoom-ins on cuts: {n}', { n: r.zoomed })}</li>}
          {r.hook && <li>{t('Title: “{text}”', { text: r.hook })}</li>}
          {r.music && <li>{t('Music: “{title}”, quieter under the voice', { title: r.music })}</li>}
          {r.musicError && <li>{t('Music was not added: {error}', { error: r.musicError })}</li>}
        </ul>
        <p className="hint">{t('Everything is on the timeline: tap any part to change it.')}</p>
        <button className="btn primary big" onClick={() => { editor().openSheet(null); player.seek(0); player.play(); }}>{t('Watch the reel')}</button>
        <button className="btn" onClick={() => { undoSteps(r.steps); track('reel_undo_all', { steps: r.steps }); setPhase({ kind: 'setup' }); }}>{t('Undo all')}</button>
      </div>
    );
  }

  return (
    <>
      <p className="hint">{t('Turns a recording of you talking into a ready reel. Each step is on the timeline and can be undone.')}</p>
      <Toggle label={t('Remove pauses')} value={o.pauses} onChange={(v) => set({ pauses: v })} />
      <Toggle label={t('Remove “um”, “uh” and repeats')} value={o.fillers} onChange={(v) => set({ fillers: v })} />
      <Toggle label={t('Captions with the spoken word highlighted')} value={o.captions} onChange={(v) => set({ captions: v })} />
      {o.captions && (
        <Chips options={CAPTION_PRESETS.map((x) => x.id)} value={o.preset} onChange={(id) => set({ preset: id })} scroll label={t('Style')}
          render={(id) => { const pr = CAPTION_PRESETS.find((x) => x.id === id)!; return <StyleSwatch style={pr.style} label={t(pr.name)} />; }} />
      )}
      <Toggle label={t('Zoom in on cuts')} value={o.zoom} onChange={(v) => set({ zoom: v })} />
      <Toggle label={t('Title from the first phrase')} value={o.hook} onChange={(v) => set({ hook: v })} />
      <h3>{t('Music')}</h3>
      <Chips options={['none', ...MOODS] as const} value={o.music ?? 'none'} scroll label={t('Music')}
        onChange={(m) => set({ music: m === 'none' ? null : (m as Mood) })} render={(m) => (m === 'none' ? t('No music') : t(MOOD_LABEL[m]))} />
      {(o.captions || o.fillers || o.hook) && (
        <>
          <h3>{t('Language')}</h3>
          <select className="select" value={o.language} onChange={(e) => set({ language: e.target.value })} aria-label={t('Language')}>
            {CAPTION_LANGUAGES.map((l) => <option key={l.label} value={l.id ?? ''}>{t(l.label)}</option>)}
          </select>
        </>
      )}
      <button className="btn primary big" onClick={() => void run()}>{t('Make the reel')}</button>
      <p className="hint">{t('Speech is recognized on this device; your video never leaves it.')}</p>
    </>
  );
}
