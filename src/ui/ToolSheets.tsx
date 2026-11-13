import { CircleAlert, Mic } from 'lucide-react';
import { memo, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { CAPTION_LAYOUTS, applyCaptionLook, captionCursor, captionLayout, captionPages, lineWords, normalizeRanges, rangesSeconds, setCaptionLayout, wordsFromSegment, type CaptionLayout } from '../core/captions';
import { fillerIndices } from '../core/reframe';
import { wordCutRange } from '../core/silence';
import { clipEnd, cutTimelineRanges, mainTrack, projectDuration, soundAssetId, sourceTime, timelineTimeOf } from '../core/timeline';
import { PEAKS_PER_SEC, waveform } from '../engine/media';
import { createAudioClip } from '../core/defaults';
import { CAPTION_ACCENT, CAPTION_CATEGORIES, CAPTION_PRESETS, STICKER_GROUPS } from '../core/presets';
import { placeClip } from '../core/timeline';
import { CAPTION_EMPHASES, CAPTION_MOTIONS, type CaptionClip, type CaptionEmphasis, type CaptionMotion, type ImageClip, type Rect, type VideoClip } from '../core/types';
import { soundEntries } from '../engine/audio';
import { METER_IDLE, meterStep } from '../core/meter';
import { finishPace, reportPace, startPace, type Pace } from '../core/pace';
import { projectScript } from '../core/script';
import { ASR_CHOICES, ASR_MODELS, CAPTION_LANGUAGES, alignToScript, firstDownload, fittingModel, languageLabel, modelsToDownload, startingModel, transcribeProject, type AsrChoice, type AsrModel, type CaptionProgress, type DownloadConsent } from '../engine/captions';
import { importFile } from '../engine/importer';
import { player } from '../engine/player';
import { VoiceRecorder } from '../engine/recorder';
import './capture.css';
import './catalog.css';
import './detail.css';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { addCaptions, addSticker, editClip, exportSubtitles, importSubtitles } from './actions';
import { Chips, Slider, Swatches, Toggle, Values, num, pct, useSheetGuard } from './controls';
import { ModelAsk, useModelAsk } from './modelAsk';
import { PaceBar, learnPace, speechStage, speechStages } from './pace';
import { formatTime } from './format';
import { t } from '../lib/i18n';
import { StylePicker } from './picker';
import { drawCaptionTile } from './tiles';
import { FontPicker } from './FontPicker';
import { TextLook } from './TextLook';
import { useHoldUpdates } from '../lib/update';
import { Button } from './ck/controls';

// ---------- Crop ----------

const CROP_ASPECTS = ['original', 'free', '9:16', '16:9', '1:1', '4:5'] as const;
type CropAspect = (typeof CROP_ASPECTS)[number];
const FULL: Rect = { x: 0, y: 0, w: 1, h: 1 };

function aspectRatio(a: CropAspect, srcRatio: number): number | null {
  if (a === 'free') return null;
  if (a === 'original') return srcRatio;
  const [x, y] = a.split(':').map(Number);
  return x / y;
}
/** Largest crop (in normalized source units) with pixel aspect `ratio`. */
const fit = (ratio: number, src: number) => (ratio > src ? { w: 1, h: src / ratio } : { w: ratio / src, h: 1 });
const r4 = (x: number) => Math.round(x * 1e4) / 1e4;

export function CropBody({ clip }: { clip: VideoClip | ImageClip }) {
  const asset = useEditor((s) => s.project?.assets[clip.assetId]);
  const src = asset && asset.height ? asset.width / asset.height : 16 / 9;
  const rect = clip.crop ?? FULL;
  const pxRatio = (rect.w * src) / rect.h;
  const guess = CROP_ASPECTS.find((a) => { const r = aspectRatio(a, src); return r !== null && Math.abs(r - pxRatio) < 0.01; }) ?? 'free';
  const [aspect, setAspect] = useState<CropAspect>(guess);
  const ratio = aspectRatio(aspect, src);
  const set = (r: Rect) => editClip(clip.id, (c) => { if (c.kind === 'video' || c.kind === 'image') c.crop = { x: r4(r.x), y: r4(r.y), w: r4(r.w), h: r4(r.h) }; }, `crop:${clip.id}`);

  const box = ratio ? fit(ratio, src) : null;
  const zoom = box ? Math.max(1, box.w / rect.w) : 1;
  const panX = rect.w < 1 ? (rect.x / (1 - rect.w)) * 2 - 1 : 0;
  const panY = rect.h < 1 ? (rect.y / (1 - rect.h)) * 2 - 1 : 0;
  const place = (z: number, px: number, py: number) => {
    if (!box) return;
    const w = box.w / z, h = box.h / z;
    set({ w, h, x: ((1 - w) * (px + 1)) / 2, y: ((1 - h) * (py + 1)) / 2 });
  };

  return (
    <>
      <Chips options={CROP_ASPECTS} value={aspect} render={(a) => (a === 'original' ? t('Original') : a === 'free' ? t('Free') : a)}
        onChange={(a) => {
          setAspect(a);
          const r = aspectRatio(a, src);
          if (r) { const b = fit(r, src); set({ w: b.w, h: b.h, x: (1 - b.w) / 2, y: (1 - b.h) / 2 }); }
        }} />
      {box ? (
        <Values label={t('Zoom')}>
          <Slider label={t('Zoom')} value={zoom} min={1} max={4} format={(v) => `${num(v)}×`} reset={1} onChange={(z) => place(z, panX, panY)} />
          <Slider label={t('Left ↔ right')} value={panX} min={-1} max={1} format={(v) => `${Math.round(v * 100)}`} reset={0} onChange={(v) => place(zoom, v, panY)} />
          <Slider label={t('Up ↕ down')} value={panY} min={-1} max={1} format={(v) => `${Math.round(v * 100)}`} reset={0} onChange={(v) => place(zoom, panX, v)} />
        </Values>
      ) : (
        <Values label={t('Crop')}>
          <Slider label={t('Left edge')} value={rect.x} min={0} max={0.95} format={pct} reset={0} onChange={(v) => set({ ...rect, x: v, w: Math.min(rect.w, 1 - v) })} />
          <Slider label={t('Top edge')} value={rect.y} min={0} max={0.95} format={pct} reset={0} onChange={(v) => set({ ...rect, y: v, h: Math.min(rect.h, 1 - v) })} />
          <Slider label={t('Width')} value={rect.w} min={0.05} max={1 - rect.x} format={pct} reset={1 - rect.x} onChange={(v) => set({ ...rect, w: v })} />
          <Slider label={t('Height')} value={rect.h} min={0.05} max={1 - rect.y} format={pct} reset={1 - rect.y} onChange={(v) => set({ ...rect, h: v })} />
        </Values>
      )}
      <p className="ck-hint">{t('Crop to 9:16 to turn a horizontal video into a full-screen vertical one.')}</p>
      <Button onClick={() => { setAspect('original'); editClip(clip.id, (c) => { if (c.kind === 'video' || c.kind === 'image') delete c.crop; }); }}>{t('Reset crop')}</Button>
    </>
  );
}

// ---------- Voice-over ----------

const extFor = (type: string) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm');

export function VoiceoverBody() {
  const [state, setState] = useState<'idle' | 'asking' | 'recording' | 'saving'>('idle');
  useHoldUpdates(state !== 'idle'); // a reload would lose the recording
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const [meter, setMeter] = useState<ReturnType<typeof meterStep>>({ ...METER_IDLE, clip: false });
  const rec = useRef<VoiceRecorder | null>(null);
  const startAt = useRef(0);
  const raf = useRef(0);

  const gone = useRef(false);
  useEffect(() => () => {
    gone.current = true;
    rec.current?.cancel();
    cancelAnimationFrame(raf.current);
    player.setMuted(false);
  }, []);

  async function start() {
    player.prime(); // unlock audio inside the tap, before the permission prompt
    setState('asking');
    try {
      const r = new VoiceRecorder();
      await r.start();
      // The sheet closed while the microphone was opening: nobody would ever stop this recording (audit V-224).
      if (gone.current) { r.cancel(); return; }
      rec.current = r;
      startAt.current = player.time;
      const t0 = performance.now();
      player.setMuted(true);
      player.play();
      setState('recording');
      const tick = () => {
        setElapsed((performance.now() - t0) / 1000);
        const { level: lv, peak } = r.levels();
        setLevel(lv);
        setMeter((m) => meterStep(m, peak, performance.now()));
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      editor().toast(t('Microphone is not available: {error}', { error: errorMessage(e) }), 'error');
      setState('idle');
    }
  }

  async function stop() {
    const r = rec.current;
    if (!r) return;
    cancelAnimationFrame(raf.current);
    setState('saving');
    player.pause();
    player.setMuted(false);
    try {
      const blob = await r.stop();
      const asset = await importFile(blob, `Voice-over.${extFor(blob.type)}`);
      let id = '';
      editor().commit((d) => {
        d.assets[asset.id] = asset;
        const c = createAudioClip(asset, startAt.current);
        placeClip(d, c);
        id = c.id;
      });
      editor().select(id);
      track('voiceover_recorded', { seconds: Math.round(asset.duration) });
    } catch (e) {
      editor().toast(t('Could not save the recording: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      rec.current = null;
      setState('idle');
    }
  }

  return (
    // Chetko (Ч4 release 9): the same white record button as the camera's; too loud is words with a sign, not red.
    <div className="recorder ck-voice">
      <div className="ck-voice-note" role="status">
        {meter.clip && state === 'recording'
          ? <p className="clip-warn ck-loud"><CircleAlert aria-hidden />{t('Too loud: hold the phone a little further away')}</p>
          : <p className="ck-hint">{t('Recording starts at the playhead. The video plays without sound so you can talk over it.')}</p>}
      </div>
      <div className={`meter ck-meter ${meter.clip ? 'clip' : ''}`} data-clip={meter.clip ? true : undefined} aria-hidden>
        <div style={{ width: `${Math.round(level * 100)}%` }} />
        {meter.hold > 0 && <i className="hold" style={{ left: `${Math.round(Math.min(1, meter.hold * 1.5) * 100)}%` }} />}
      </div>
      <span className="rec-time ck-rec-time" data-on={state === 'recording' ? true : undefined}>{state === 'asking' ? t('Allow microphone access…') : formatTime(elapsed)}</span>
      {state === 'recording'
        ? <button type="button" className="rec-btn on ck-rec" data-on onClick={() => void stop()} aria-label={t('Stop recording')} />
        : <button type="button" className="rec-btn ck-rec" disabled={state === 'saving' || state === 'asking'} onClick={() => void start()} aria-label={t('Start recording')}><Mic aria-hidden /></button>}
    </div>
  );
}

// ---------- Stickers ----------

export function StickersBody() {
  // Groups as headings in one scroll (v1.5): the popular set first, the rest by theme.
  return (
    <>
      {STICKER_GROUPS.map((g) => (
        <section key={g.id} aria-label={t(g.name)}>
          <h3>{t(g.name)}</h3>
          <div className="sticker-grid ck-stickers">
            {g.items.map((s) => <button type="button" key={s} className="sticker ck-sticker" onClick={() => addSticker(s)} aria-label={t('Add {name}', { name: s })}>{s}</button>)}
          </div>
        </section>
      ))}
    </>
  );
}

// ---------- Auto captions ----------


function progressLabel(p: CaptionProgress): string {
  // Two different things, worded apart (the owner, 2026-11-13: «модель скачивается каждый раз»): bytes from the
  // network, with how many; or the model this device keeps being started, with no network at all.
  if (p.phase === 'download') return t('Downloading the speech model: {mb} MB, once…', { mb: p.mb });
  if (p.phase === 'load') return t('Starting the speech model (it is on this device)…');
  if (p.phase === 'prepare') return t('Preparing the sound…');
  if (p.phase === 'listen') return t('Finding speech…');
  return t('Recognizing speech…');
}

const LAYOUT_LABELS: Record<CaptionLayout, string> = { phrase: 'Phrase', word: 'Word by word', highlight: 'Highlight the word', reveal: 'Words appear' };
const EMPHASIS_LABELS: Record<CaptionEmphasis, string> = {
  color: 'Color', box: 'Box', underline: 'Underline', scale: 'Bigger', fill: 'Karaoke fill', past: 'Said so far', dim: 'Dim the rest',
};
const MOTION_LABELS: Record<CaptionMotion, string> = { none: 'None', pop: 'Pop', fade: 'Fade', rise: 'Rise', slide: 'Slide', zoom: 'Zoom', bounce: 'Bounce' };

/** Caption look: the template catalog (v1.5: categories, live previews) and layout chips. Shared by "create" and "edit". */
function CaptionLook({ layout, preset, onLayout, onPreset }: { layout: CaptionLayout; preset: string | null; onLayout: (l: CaptionLayout) => void; onPreset: (id: string) => void }) {
  const draw = drawCaptionTile; // on the black of the stage, as the text styles and fonts (docs/18; the owner, 2026-11-11)
  return (
    <>
      <h3>{t('Style')}</h3>
      <StylePicker items={CAPTION_PRESETS} categories={CAPTION_CATEGORIES} value={preset} onChange={onPreset} label={t('Style')} draw={draw} animated ground="stage" />
      <h3>{t('Layout')}</h3>
      <Chips options={CAPTION_LAYOUTS} value={layout} onChange={onLayout} render={(l) => t(LAYOUT_LABELS[l])} />
    </>
  );
}

/**
 * The caption look and the recognition last chosen here: one-tap captions (v1.3) reuse them. The model was not kept
 * before docs/20: the next tap went back to the default, whatever the person had chosen (the owner, 2026-11-13:
 * «всегда пишется… 77 МБ, хотя в выборе есть другие»). The language is not kept: the next video may be in another.
 */
const LOOK_KEY = 'kadr.captionLook';
function savedLook(): { preset: string; layout: CaptionLayout; model: AsrChoice } {
  try {
    const v = JSON.parse(localStorage.getItem(LOOK_KEY) ?? 'null') as { preset?: string; layout?: CaptionLayout; model?: AsrChoice } | null;
    const model = v && ASR_CHOICES.includes(v.model!) ? v.model! : 'auto';
    if (v && CAPTION_PRESETS.some((x) => x.id === v.preset) && CAPTION_LAYOUTS.includes(v.layout!)) return { preset: v.preset!, layout: v.layout!, model };
    return { preset: 'pop', layout: 'highlight', model };
  } catch { /* storage off: defaults */ }
  return { preset: 'pop', layout: 'highlight', model: 'auto' };
}

/** Where captions are made: the whole video, the clips ticked, or one stretch of it (docs/20 ADR-С6). */
type Scope = 'all' | 'clips' | 'part';
const SCOPE_LABELS: Record<Scope, string> = { all: 'Whole video', clips: 'Clips', part: 'A part' };

/**
 * A stretch of the video between two marks, the system's own sign for work that is held: two sliders on one line (each
 * a native range, so keys, a screen reader and a finger all work), and "here" buttons that take the playhead. Moving
 * a mark shows its frame.
 */
function PartPick({ value, duration, onChange }: { value: [number, number]; duration: number; onChange: (v: [number, number]) => void }) {
  const [a, b] = value;
  const STEP = 0.1, MIN = 0.5;
  const show = (at: number) => { player.pause(); player.seek(at); useEditor.setState({ time: player.time }); };
  const from = (v: number, look = true) => { const x = Math.max(0, Math.min(v, b - MIN)); onChange([x, b]); if (look) show(x); };
  const to = (v: number, look = true) => { const x = Math.min(duration, Math.max(v, a + MIN)); onChange([a, x]); if (look) show(Math.max(0, x - 0.05)); };
  const pos = (v: number) => (duration > 0 ? v / duration : 0).toFixed(5);
  return (
    <div className="ck-part">
      <div className="ck-part-bar" style={{ ['--from' as string]: pos(a), ['--to' as string]: pos(b) }}>
        <i className="ck-part-held" aria-hidden="true" />
        <input type="range" min={0} max={duration} step={STEP} value={a} aria-label={t('Start of the part')} aria-valuetext={formatTime(a)}
          onChange={(e) => from(Number(e.target.value))} />
        <input type="range" min={0} max={duration} step={STEP} value={b} aria-label={t('End of the part')} aria-valuetext={formatTime(b)}
          onChange={(e) => to(Number(e.target.value))} />
      </div>
      <p className="ck-part-says" aria-live="polite">{t('From {a} to {b}: {s} s', { a: formatTime(a), b: formatTime(b), s: num(b - a, 1) })}</p>
      <div className="ck-work-actions" data-pair>
        <Button onClick={() => from(player.time, false)}>{t('Start here')}</Button>
        <Button onClick={() => to(player.time, false)}>{t('End here')}</Button>
      </div>
    </div>
  );
}

export function CaptionsBody() {
  // "Auto" by default (docs/20 ADR-С2): the model that reads the speech's language best on this device — the Russian
  // model for Russian speech whatever the interface language, Whisper for the rest. A model the person picks is kept
  // for the next time. Before, the default came from the interface language and the choice was forgotten.
  const [picked, setPicked] = useState<AsrChoice>(() => savedLook().model);
  // Auto by default: the language is detected from the speech (eval in docs/02, v1.1.1).
  const [lang, setLang] = useState('');
  // The Russian models read Russian only: offered while the language is Russian or Auto.
  // "Fast" got four words in five wrong on Russian (audit V-251): not offered once the language is known to be Russian.
  const models: readonly AsrChoice[] = lang === 'russian' ? ['auto', 'ru', 'ru-fast', 'base', 'small'] : lang === '' ? ASR_CHOICES : ['auto', 'tiny', 'base', 'small'];
  const model: AsrChoice = models.includes(picked) ? picked : 'auto';
  const setModel = (m: AsrChoice) => {
    setPicked(m);
    try { localStorage.setItem(LOOK_KEY, JSON.stringify({ ...savedLook(), model: m })); } catch { /* storage off */ }
  };
  // What each model would still download: a model this device keeps says so on its chip, instead of its megabytes
  // (the owner, 2026-11-13: it looked as if the model came again every time).
  const [toCome, setToCome] = useState<Record<AsrModel, number> | null>(null);
  useEffect(() => { let on = true; void modelsToDownload().then((m) => { if (on) setToCome(m); }); return () => { on = false; }; }, []);
  const chip = (m: AsrChoice) => (m === 'auto' ? t('Auto')
    : toCome && toCome[m] === 0 ? t('{name}, on this device', { name: t(ASR_MODELS[m].label) })
      : `${t(ASR_MODELS[m].label)}, ${t('{n} MB', { n: toCome?.[m] ?? ASR_MODELS[m].mb })}`);
  // Where: the whole video, the clips ticked, or a stretch between two marks (the owner, 2026-11-13).
  const [scope, setScope] = useState<Scope>('all');
  const project = useEditor((st) => st.project);
  const duration = project ? projectDuration(project) : 0;
  // Every piece of the main track: the voice may lie on another track over a photo.
  const pieces = project ? mainTrack(project).clips : [];
  const under = (at: number) => pieces.find((c) => at >= c.start && at < clipEnd(c)) ?? pieces[0];
  const [ticked, setTicked] = useState<ReadonlySet<string>>(() => new Set(under(player.time) ? [under(player.time).id] : []));
  const [part, setPart] = useState<[number, number]>(() => {
    const at = player.time < duration - 1 ? player.time : 0;
    return [at, Math.min(duration, Math.max(at + 1, under(at) ? clipEnd(under(at)) : duration))];
  });
  /** The stretches to caption, or null for the whole video. */
  const wanted = (): [number, number][] | null => (scope === 'all' ? null
    : normalizeRanges(scope === 'part' ? [part] : pieces.filter((c) => ticked.has(c.id)).map((c): [number, number] => [c.start, clipEnd(c)]), duration));
  const hasCaptions = !!project?.tracks.some((tr) => tr.clips.some((c) => c.kind === 'caption'));
  const [preset, setPreset] = useState(() => savedLook().preset);
  const [layout, setLayout] = useState<CaptionLayout>(() => savedLook().layout);
  // Words from the user's own text (docs/09 S1) are a choice: captions say what the video says (v1.6, the owner: "from
  // the video, not from the teleprompter"). The teleprompter text waits in the box for when it is chosen.
  const [script, setScript] = useState(() => { const p = editor().project; return p ? projectScript(p) : ''; });
  const [source, setSource] = useState<'speech' | 'script'>('speech');
  // What the job is doing, as words; the bar itself is drawn from the pace (docs/09 Q4).
  const [progress, setProgress] = useState<string | null>(null);
  // The question before a model download (audit V-181). While it is on screen nothing runs: the sheet closes freely.
  const { asked, ask, answer } = useModelAsk();
  const checking = useRef(false);
  useHoldUpdates(progress !== null);
  useSheetGuard(progress !== null && !asked ? t('Captions are still being made. Tap again to stop.') : null);
  const pace = useRef<Pace | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);
  // The Captions tool (v1.3): start right away with the defaults; the settings are one tap away while it runs.
  useEffect(() => {
    if (!useEditor.getState().startAuto) return;
    useEditor.setState({ startAuto: false });
    void run();
  }, []);

  async function run() {
    const p = editor().project;
    if (!p || checking.current) return;
    if (!soundEntries(p).length) { editor().toast(t('There is no sound in this project to caption')); return; }
    const ranges = source === 'speech' ? wanted() : null;
    if (ranges && !ranges.length) { editor().toast(t('Choose the clips to caption')); return; }
    try { localStorage.setItem(LOOK_KEY, JSON.stringify({ preset, layout, model })); } catch { /* storage off */ }
    player.pause();
    const ac = new AbortController();
    abort.current = ac;
    try {
      // Before anything starts: the model this run loads first, when this device does not keep it yet. "Not now"
      // leaves the sheet as it was, without a word.
      checking.current = true;
      const first = await firstDownload(model, lang || null).finally(() => { checking.current = false; });
      if (first && !(await ask(first))) return;
      // A model that takes over later (Whisper for speech that is not Russian, a lighter one after one that did not
      // fit) is asked about when it is needed; the wait for that answer is not this device's pace.
      let waited = false;
      const consent: DownloadConsent = { agreed: first?.model, ask: (d) => { waited = true; return ask(d); } };
      const started = performance.now();
      const seconds = ranges ? rangesSeconds(ranges) : projectDuration(p);
      const withScript = source === 'script' && !!script.trim();
      const starts = startingModel(model, lang || null);
      pace.current = startPace(speechStages(starts, seconds, { script: withScript }), performance.now());
      setProgress(t('Getting ready…'));
      const report = (pr: CaptionProgress) => {
        if (pace.current) reportPace(pace.current, speechStage(pr.phase), pr.phase === 'download' || pr.phase === 'transcribe' ? pr.fraction : null, performance.now());
        const label = progressLabel(pr);
        setProgress((old) => (old === label ? old : label));
      };
      const tr = await transcribeProject(p, model, lang || null, report, ac.signal, consent, ranges);
      if (withScript && pace.current) { reportPace(pace.current, 'align', null, performance.now()); setProgress(t('Matching your text…')); }
      const { language, detected } = tr;
      let words = tr.words;
      const own = source === 'script' && script.trim() ? await alignToScript(script, tr) : null;
      if (own) words = own.words;
      else if (source === 'script' && script.trim() && tr.words.length) editor().toast(t('The text did not match the speech: captions are from recognition.'), 'info', 6000);
      track('captions_generated', {
        model, engine: tr.engine, scope, lang: lang || 'auto', detected: detected ? language ?? 'none' : '', layout, words: words.length, seconds: Math.round((performance.now() - started) / 1000),
        source: own ? 'script' : 'speech', ...(own && { matched: Math.round(own.matched * 100), skipped: own.skipped, adlibs: own.adlibs }),
      });
      // The pace is this device's only when one model did the whole run (no switch for the language or the memory).
      if (pace.current && !waited && tr.engine === starts) learnPace(starts, seconds, finishPace(pace.current, performance.now()));
      addCaptions(words, preset, layout, true, ranges);
      if (detected && language) editor().toast(t('Speech language: {language}. Wrong? Pick it and create again.', { language: languageLabel(language) }), 'info', 6000);
      // Whisper on Russian speech gets a third of the words wrong; the Russian model, one in ten (audit V-191).
      if (detected && language === 'russian' && tr.engine !== 'ru' && tr.engine !== 'ru-fast') editor().toast(t('This is Russian speech: choose the Russian model for far fewer mistakes.'), 'info', 8000);
      if (tr.unreadable.length) editor().toast(t('Captions are made without “{name}”: its sound cannot be decoded in this browser.', { name: tr.unreadable.join(', ') }), 'info', 8000);
    } catch (e) {
      // A decoder interrupted by Cancel or by leaving the project fails with its own error: that is a cancel, not a failure.
      if ((e as Error).name !== 'AbortError' && !ac.signal.aborted) editor().toast(t('Captions failed: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setProgress(null);
    }
  }

  if (asked) return <ModelAsk d={asked} yes={t('Download and make captions')} onAnswer={answer} />;
  if (progress) {
    return (
      <div className="export-progress ck-work">
        <PaceBar pace={pace} />
        <p className="ck-work-label">{progress}</p>
        <div className="ck-work-actions" data-pair>
          <Button onClick={() => abort.current?.abort()}>{t('Settings')}</Button>
          <Button onClick={() => { abort.current?.abort(); editor().openSheet(null); }}>{t('Cancel')}</Button>
        </div>
      </div>
    );
  }
  return (
    <>
      <h3>{t('Words')}</h3>
      <Chips even options={['speech', 'script'] as const} value={source} onChange={setSource} label={t('Words')}
        render={(s) => (s === 'speech' ? t('Recognize speech') : t('From my text'))} />
      {source === 'script' && (
        <>
          <textarea className="ck-input ck-panel-script" value={script} onChange={(e) => setScript(e.target.value)} rows={5}
            aria-label={t('Your text')} placeholder={t('Paste the text you read')} />
          <p className="ck-hint">{t('Words come from your text, timing from the recording. The speech model still runs to place each word.')}</p>
        </>
      )}
      {/* A part of the video is for recognized speech: a text of one's own is matched to the whole recording. */}
      {source === 'speech' && (
        <>
          <h3>{t('Where')}</h3>
          <Chips even options={['all', 'clips', 'part'] as const} value={scope} onChange={setScope} label={t('Where')} render={(x) => t(SCOPE_LABELS[x])} />
          {scope === 'clips' && (
            <div className="ck-chips ck-pieces" data-scroll role="group" aria-label={t('Clips to caption')}>
              {pieces.map((c, i) => (
                <button key={c.id} type="button" role="checkbox" aria-checked={ticked.has(c.id)} className="chip ck-chip"
                  onClick={() => { setTicked((old) => { const n = new Set(old); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; }); player.pause(); player.seek(c.start + 0.01); useEditor.setState({ time: player.time }); }}>
                  {`${i + 1} · ${formatTime(c.start, false)}–${formatTime(clipEnd(c), false)}`}
                </button>
              ))}
            </div>
          )}
          {scope === 'part' && <PartPick value={part} duration={duration} onChange={setPart} />}
          {scope !== 'all' && hasCaptions && <p className="ck-hint">{t('Captions in the rest of the video stay as they are.')}</p>}
        </>
      )}
      <h3>{t('Language')}</h3>
      <select className="ck-select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Language')}>
        {CAPTION_LANGUAGES.map((l) => <option key={l.label} value={l.id ?? ''}>{t(l.label)}</option>)}
      </select>
      <p className="ck-hint">{t('Pick the language if the video mixes languages or the result looks wrong.')}</p>
      <h3>{t('Recognition')}</h3>
      <Chips options={models} value={model} onChange={setModel} render={chip} label={t('Recognition')} />
      {model === 'auto' ? <p className="ck-hint">{t('Kadr picks the model for the language of the speech: “{name}” reads Russian, “{other}” the other languages.', { name: t(ASR_MODELS[startingModel('auto', 'russian')].label), other: t(ASR_MODELS.base.label) })}</p>
        : fittingModel(model) !== model
        ? <p className="ck-hint">{t('This device ran out of memory for it before: captions are made by “{name}”.', { name: t(ASR_MODELS[fittingModel(model)].label) })}</p>
        : model === 'ru' ? <p className="ck-hint">{t('GigaAM reads Russian speech best. Speech in other languages is recognized by “Accurate”.')}</p>
        : model === 'ru-fast' && <p className="ck-hint">{t('Reads Russian speech with punctuation, made for phones. Speech in other languages is recognized by “Accurate”.')}</p>}
      <CaptionLook layout={layout} preset={preset} onLayout={setLayout}
        onPreset={(id) => { setPreset(id); setLayout(CAPTION_PRESETS.find((x) => x.id === id)?.layout ?? layout); }} />
      <p className="ck-hint">{t('Speech is recognized on this device and your audio is never uploaded. The model downloads once and is kept in this browser.')}</p>
      <Button variant="primary" disabled={source === 'script' && !script.trim()} onClick={() => void run()}>{t('Create captions')}</Button>
      <Button onClick={() => void importSubtitles()}>{t('Import .srt or .vtt')}</Button>
    </>
  );
}

export function CaptionEditBody({ clip }: { clip: CaptionClip }) {
  const e = (fn: (c: CaptionClip) => void, key?: string) =>
    editClip(clip.id, (c) => { if (c.kind === 'caption') fn(c); }, key && `${key}:${clip.id}`);
  return (
    <>
      <CaptionLook layout={captionLayout(clip)} preset={clip.preset ?? null}
        onLayout={(l) => e((c) => { setCaptionLayout(c, l, CAPTION_PRESETS.find((x) => x.id === c.preset)?.highlight ?? CAPTION_ACCENT); })}
        onPreset={(id) => e((c) => {
          // A template is the whole look (v1.5): font and colours, how the spoken word stands out and moves, and its
          // layout, which the chips below can change after. The text and timing stay.
          applyCaptionLook(c, CAPTION_PRESETS.find((x) => x.id === id)!);
        })} />
      <FontPicker clipId={clip.id} style={clip.style} onFont={(f) => e((c) => { c.style.font = f; })} onWeight={(w) => e((c) => { c.style.weight = w; })} />
      <Slider label={t('Words at once')} value={clip.wordsPerPage} min={1} max={12} step={1} format={(v) => String(v)} reset={4}
        onChange={(v) => e((c) => { c.wordsPerPage = v; }, 'wpp')} />
      <Slider label={t('Size')} value={clip.style.size} min={0.02} max={0.15} step={0.001} format={(v) => `${Math.round(v * 1000) / 10}`} reset={0.055}
        onChange={(v) => e((c) => { c.style.size = v; }, 'csize')} />
      <Toggle label={t('Highlight the spoken word')} value={!!clip.highlight} onChange={(v) => e((c) => { c.highlight = v ? '#ffc53d' : null; })} />
      {clip.highlight && (
        <>
          <Swatches label={t('Highlight color')} value={clip.highlight} onChange={(col) => e((c) => { c.highlight = col; })} />
          <h3>{t('The spoken word')}</h3>
          <Chips options={CAPTION_EMPHASES} value={clip.emphasis ?? 'color'} label={t('The spoken word')} render={(m) => t(EMPHASIS_LABELS[m])}
            onChange={(m) => e((c) => { c.emphasis = m; })} />
        </>
      )}
      <TextLook style={clip.style} change={(fn, key) => e((c) => fn(c.style), key)} />
      <h3>{t('Animation')}</h3>
      <Chips options={CAPTION_MOTIONS} value={clip.motion ?? (clip.wordsPerPage === 1 && !clip.reveal ? 'pop' : 'none')} label={t('Animation')} render={(m) => t(MOTION_LABELS[m])}
        onChange={(m) => e((c) => { c.motion = m; })} />
      <CaptionLines clip={clip} />
      <CutByText clip={clip} />
      <Button onClick={() => void exportSubtitles()}>{t('Save as .srt')}</Button>
      <Button onClick={() => editor().openSheet('captions')}>{t('Create again…')}</Button>
    </>
  );
}

/** A line reads as it is drawn (`lineWords`): with small first letters, the list shows them too. */
const lineText = (c: CaptionClip, pg: { text: string }[]) => lineWords(c, pg.map((w) => w.text)).join(' ');

/**
 * Where the playhead stands in the caption's text, as one number that changes only when the word does: the sheet is
 * not drawn again on every tick of playback. -1: nowhere (no words).
 */
function useCaptionCursor(clip: CaptionClip): { page: number; word: number; index: number } | null {
  const key = useEditor((st) => { const at = captionCursor(clip, st.time - clip.start); return at ? at.index : -1; });
  return key < 0 ? null : captionCursor(clip, clip.words[key]?.t0 ?? 0);
}

/**
 * One line of the captions: when, and its words to correct. On the line the playhead stands on, the word it stands on
 * is marked (the owner, 2026-11-13: «слово, на котором остановили просмотр, должно подсвечиваться»): white, as the
 * playhead is. The mark is drawn over the field by a copy of its text set in the same face, and is gone while the
 * line is being typed in.
 */
const CaptionLine = memo(function CaptionLine({ i, at, text, now, onSeek, onCommit }: {
  i: number; at: number; text: string; /** The word the playhead is on, or -1 when it is on another line. */ now: number;
  /** The same functions from render to render: only the two lines the playhead moves between are drawn again. */
  onSeek: (line: number) => void; onCommit: (line: number, text: string) => void;
}) {
  const field = useRef<HTMLInputElement>(null), copy = useRef<HTMLSpanElement>(null);
  const words = text.split(' ');
  // A long line runs past the field's edge: the field and the copy move together, so the marked word is in sight.
  useLayoutEffect(() => {
    const f = field.current, c = copy.current, m = c?.querySelector('mark');
    if (!f || document.activeElement === f) return;
    if (!c || !m) { f.scrollLeft = 0; return; }
    const pad = parseFloat(getComputedStyle(f).paddingLeft) || 0;
    const room = f.clientWidth - 2 * pad;
    f.scrollLeft = m.offsetLeft + m.offsetWidth - pad > room ? Math.max(0, m.offsetLeft - pad - (room - m.offsetWidth) / 2) : 0;
    c.scrollLeft = f.scrollLeft; // what the field really did (a browser may refuse to scroll it)
  }, [now, text]);
  return (
    <label className="caption-row ck-line" data-now={now >= 0 || undefined}>
      <span>{formatTime(at)}</span>
      <span className="ck-line-field">
        {now >= 0 && (
          <span ref={copy} className="ck-input ck-line-now" aria-hidden="true">
            {words.map((w, i) => (i === now ? <mark key={i}>{w}</mark> : <span key={i}>{w}</span>)).flatMap((el, i) => (i ? [' ', el] : [el]))}
          </span>
        )}
        {/* No automatic capital: a phone keyboard would start every corrected line with one (v1.6). */}
        <input ref={field} className="ck-input" defaultValue={text} aria-label={t('Caption line {n}', { n: i + 1 })} autoCapitalize="none"
          aria-current={now >= 0 ? 'true' : undefined}
          onFocus={() => onSeek(i)}
          onBlur={(ev) => { onCommit(i, ev.target.value); if (ev.target.value.trim().replace(/\s+/g, ' ') === text) ev.target.value = text; }}
          onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
      </span>
    </label>
  );
});

/** The lines of the captions, the one under the playhead marked and kept in sight while the list is on screen. */
function CaptionLines({ clip }: { clip: CaptionClip }) {
  const pages = captionPages(clip.words, Math.max(1, clip.wordsPerPage));
  const cursor = useCaptionCursor(clip);
  const list = useRef<HTMLDivElement>(null);
  const clipRef = useRef(clip);
  clipRef.current = clip;
  const seek = useRef((i: number) => {
    const c = clipRef.current, pg = captionPages(c.words, Math.max(1, c.wordsPerPage))[i];
    if (!pg) return;
    player.pause(); player.seek(c.start + pg[0].t0 + 0.01); useEditor.setState({ time: player.time });
  }).current;
  const commit = useRef((i: number, text: string) => editClip(clipRef.current.id, (c) => {
    if (c.kind !== 'caption') return;
    const pg = captionPages(c.words, Math.max(1, c.wordsPerPage))[i];
    if (!pg || lineText(c, pg) === text.trim().replace(/\s+/g, ' ')) return;
    const at = c.words.indexOf(pg[0]);
    const words = text.trim() ? wordsFromSegment(pg[0].t0, pg[pg.length - 1].t1, text) : [];
    c.words.splice(at, pg.length, ...words);
  })).current;
  const toNow = (block: ScrollLogicalPosition) => list.current?.querySelector('[data-now]')?.scrollIntoView({ block, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  // The line follows the playhead while the list is in sight and nobody is typing in it; a sheet open on its style
  // is not pulled down to the text.
  const page = cursor?.page ?? -1;
  useEffect(() => {
    const el = list.current, body = el?.closest('.sheet-body');
    if (!el || !body || el.contains(document.activeElement)) return;
    const r = el.getBoundingClientRect(), b = body.getBoundingClientRect();
    if (r.bottom > b.top && r.top < b.bottom) toNow('nearest');
  }, [page]);
  return (
    <>
      <h3>{t('Text ({n} lines)', { n: pages.length })}</h3>
      <Toggle label={t('Lines start with a small letter')} value={!!clip.lowerStart}
        onChange={(v) => editClip(clip.id, (c) => { if (c.kind !== 'caption') return; if (v) c.lowerStart = true; else delete c.lowerStart; })} />
      {pages.length > 4 && <Button onClick={() => toNow('center')}>{t('Show the line at the playhead')}</Button>}
      <div ref={list} className="caption-list ck-lines">
        {pages.map((pg, i) => {
          const text = lineText(clip, pg);
          return (
            <CaptionLine key={`${pg[0].t0.toFixed(3)}:${text}`} i={i} at={clip.start + pg[0].t0} text={text} now={cursor?.page === i ? cursor.word : -1}
              onSeek={seek} onCommit={commit} />
          );
        })}
      </div>
    </>
  );
}

/** "Edit by text": mark words (fillers, repeats, anything) and cut them out of the video; captions follow. */
function CutByText({ clip }: { clip: CaptionClip }) {
  const [on, setOn] = useState(false);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setMarked((m) => { const n = new Set(m); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const seconds = [...marked].reduce((n, i) => n + (clip.words[i].t1 - clip.words[i].t0), 0);
  const now = useCaptionCursor(clip)?.index ?? -1;

  async function cut() {
    const p = editor().project;
    if (!p) return;
    // Word times are approximate: move each edge to the quietest point on its side, so neighbours aren't clipped.
    const main = mainTrack(p);
    const ranges: [number, number][] = [];
    for (const i of [...marked].sort((x, y) => x - y)) {
      const a = clip.start + clip.words[i].t0, b = clip.start + clip.words[i].t1;
      const c = main.clips.find((x) => x.kind === 'video' && (a + b) / 2 >= x.start && (a + b) / 2 <= clipEnd(x));
      if (!c || c.kind !== 'video') { ranges.push([a, b]); continue; }
      const [s0, s1] = wordCutRange(await waveform(soundAssetId(c)), PEAKS_PER_SEC, sourceTime(c, a), sourceTime(c, b));
      ranges.push([timelineTimeOf(c, s0), timelineTimeOf(c, s1)]);
    }
    let removed = 0;
    editor().commit((d) => { removed = cutTimelineRanges(d, ranges); });
    editor().toast(t('Cut {n} words, {s} s shorter', { n: marked.size, s: removed.toFixed(1) }));
    track('cut_by_text', { words: marked.size, seconds: Math.round(removed * 10) / 10 });
    setMarked(new Set());
    setOn(false);
  }

  if (!on) return <Button onClick={() => setOn(true)}>{t('Edit video by text')}</Button>;
  return (
    <div className="cut-text ck-cut">
      <h3>{t('Tap words to cut them from the video')}</h3>
      <div className="words ck-words">
        {clip.words.map((w, i) => (
          <button type="button" key={i} className={`word ck-word ${marked.has(i) ? 'cut' : ''}`} aria-pressed={marked.has(i)} data-now={i === now || undefined}
            aria-current={i === now ? 'true' : undefined} onClick={() => toggle(i)}>{w.text}</button>
        ))}
      </div>
      <div className="row ck-actions">
        <Button onClick={() => setMarked(new Set(fillerIndices(clip.words)))}>{t('Mark fillers and repeats')}</Button>
      </div>
      {/* It deletes: red, on a line of its own, apart from the marking (DESIGN.md §2.3 and §2.6; the art director, release 11). */}
      <div className="ck-cut-go">
        <Button variant="danger" disabled={!marked.size} onClick={() => void cut()}>{t('Cut {n} words ({s} s)', { n: marked.size, s: num(seconds, 1) })}</Button>
      </div>
      <p className="ck-hint">{t('Only the main track is cut; captions move with it. You can undo it.')}</p>
    </div>
  );
}
