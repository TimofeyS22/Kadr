// "Reel in one tap" sheet (docs/08 A): a few switches, one button, an honest progress and a summary that can be undone.
import { useEffect, useRef, useState } from 'react';
import { MOODS, type Mood } from '../core/music';
import { player } from '../engine/player';
import { CAPTION_CATEGORIES, CAPTION_PRESETS } from '../core/presets';
import { CAPTION_LANGUAGES, defaultAsrModel, type DownloadConsent } from '../engine/captions';
import { formatTime } from './format';
import { t } from '../lib/i18n';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { finishPace, reportPace, startPace, type Pace } from '../core/pace';
import { projectDuration } from '../core/timeline';
import { DEFAULT_REEL, makeReel, reelDownload, reelUsesSpeech, undoSteps, type ReelOptions, type ReelReport } from './autoreel';
import { PaceBar, learnPace, speechStages } from './pace';
import { Chips, Toggle, useSheetGuard } from './controls';
import { ModelAsk, useModelAsk } from './modelAsk';
import { MOOD_LABEL } from './MusicSheet';
import { StylePicker } from './picker';
import { drawCaptionTile } from './tiles';
import { useHoldUpdates } from '../lib/update';

const KEY = 'kadr.reel';
function loadOptions(): ReelOptions {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<ReelOptions> | null;
    // The model has no control here: always the default for this interface language (GigaAM for Russian, v1.4).
    return { ...DEFAULT_REEL, ...saved, model: defaultAsrModel() };
  } catch { return { ...DEFAULT_REEL, model: defaultAsrModel() }; }
}
const saveOptions = (o: ReelOptions) => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch { /* storage blocked */ } };

type Phase = { kind: 'setup' } | { kind: 'running'; label: string } | { kind: 'done'; report: ReelReport };

export function ReelBody() {
  const [o, setO] = useState(loadOptions);
  const [phase, setPhase] = useState<Phase>({ kind: 'setup' });
  // The question before a model download (audit V-181). While it is on screen nothing runs: the sheet closes freely.
  const { asked, ask, answer } = useModelAsk();
  const checking = useRef(false);
  useHoldUpdates(phase.kind === 'running');
  useSheetGuard(phase.kind === 'running' && !asked ? t('The reel is still being made. Tap again to stop.') : null);
  const abort = useRef<AbortController | null>(null);
  const pace = useRef<Pace | null>(null);
  const set = (patch: Partial<ReelOptions>) => setO((x) => { const n = { ...x, ...patch }; saveOptions(n); return n; });
  useEffect(() => () => abort.current?.abort(), []);

  // From the home card / a deep link: start right away with the saved options.
  useEffect(() => {
    if (!useEditor.getState().startAuto) return;
    useEditor.setState({ startAuto: false });
    void run();
  }, []);

  /**
   * `opts`: a one-off change (the language picked after a run); the saved options stay as they are. `undo`: the steps
   * of the reel this run replaces, walked back once the run really starts.
   */
  async function run(opts: ReelOptions = o, undo = 0) {
    if (checking.current) return;
    const ac = new AbortController();
    abort.current = ac;
    let waited = false;
    let label = '';
    try {
      // Before anything starts: the model this reel loads first, when this device does not keep it yet. "Not now"
      // leaves the sheet and the project as they were, without a word.
      checking.current = true;
      const first = await reelDownload(opts).finally(() => { checking.current = false; });
      if (first && !(await ask(first))) return;
      undoSteps(undo);
      setPhase({ kind: 'running', label: t('Getting ready…') });
      const p = editor().project;
      const seconds = p ? projectDuration(p) : 0;
      const stages = speechStages(opts.model, seconds, { pauses: true, music: !!opts.music });
      pace.current = startPace(reelUsesSpeech(opts) ? stages : stages.filter((s) => s.id === 'pauses' || s.id === 'music'), performance.now());
      // A model that takes over later is asked about when it is needed; the wait for that answer is not this device's pace.
      const consent: DownloadConsent = { agreed: first?.model, ask: (d) => { waited = true; return ask(d); } };
      const report = await makeReel(opts, (stage, l, f) => {
        if (pace.current) reportPace(pace.current, stage, f, performance.now());
        if (l !== label) { label = l; setPhase({ kind: 'running', label: l }); }
      }, ac.signal, consent);
      if (pace.current && !waited) learnPace(opts.model, seconds, finishPace(pace.current, performance.now()));
      setPhase({ kind: 'done', report });
    } catch (e) {
      setPhase({ kind: 'setup' });
      if ((e as Error).name !== 'AbortError') editor().toast(t('Could not make the reel: {error}', { error: errorMessage(e) }), 'error');
    }
  }

  if (asked) return <ModelAsk d={asked} yes={t('Download and make the reel')} onAnswer={answer} />;
  if (phase.kind === 'running') {
    return (
      <div className="export-progress">
        <PaceBar pace={pace} />
        <p>{phase.label}</p>
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
        {r.language && (
          <label className="reel-lang">
            <span>{r.detected ? t('Speech language (found by Kadr)') : t('Speech language')}</span>
            <select className="select" value={r.language} aria-label={t('Speech language')} onChange={(e) => {
              track('reel_language_changed', { from: r.language ?? '', to: e.target.value, detected: r.detected });
              void run({ ...o, language: e.target.value }, r.steps);
            }}>
              {CAPTION_LANGUAGES.filter((l) => l.id).map((l) => <option key={l.code} value={l.id!}>{t(l.label)}</option>)}
            </select>
          </label>
        )}
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
        <StylePicker items={CAPTION_PRESETS} categories={CAPTION_CATEGORIES} value={o.preset} onChange={(id) => set({ preset: id })} label={t('Style')} draw={drawCaptionTile} animated />
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
