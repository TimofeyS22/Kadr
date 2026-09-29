import { Mic, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { captionPages, wordsFromSegment } from '../core/captions';
import { fillerIndices } from '../core/reframe';
import { wordCutRange } from '../core/silence';
import { clipEnd, cutTimelineRanges, mainTrack, soundAssetId, sourceTime, timelineTimeOf } from '../core/timeline';
import { PEAKS_PER_SEC, waveform } from '../engine/media';
import { createAudioClip } from '../core/defaults';
import { CAPTION_PRESETS, STICKERS } from '../core/presets';
import { placeClip } from '../core/timeline';
import type { CaptionClip, ImageClip, Rect, VideoClip } from '../core/types';
import { soundEntries } from '../engine/audio';
import { ASR_MODELS, CAPTION_LANGUAGES, transcribeProject, type AsrModel, type CaptionProgress } from '../engine/captions';
import { importFile } from '../engine/importer';
import { player } from '../engine/player';
import { VoiceRecorder } from '../engine/recorder';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { addCaptions, addSticker, editClip, exportSubtitles, importSubtitles } from './actions';
import { Chips, Slider, Swatches, Toggle, pct } from './controls';
import { formatTime } from './format';
import { t } from './i18n';

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
        <>
          <Slider label={t('Zoom')} value={zoom} min={1} max={4} format={(v) => `${v.toFixed(2)}×`} reset={1} onChange={(z) => place(z, panX, panY)} />
          <Slider label={t('Left ↔ right')} value={panX} min={-1} max={1} format={(v) => `${Math.round(v * 100)}`} reset={0} onChange={(v) => place(zoom, v, panY)} />
          <Slider label={t('Up ↕ down')} value={panY} min={-1} max={1} format={(v) => `${Math.round(v * 100)}`} reset={0} onChange={(v) => place(zoom, panX, v)} />
        </>
      ) : (
        <>
          <Slider label={t('Left edge')} value={rect.x} min={0} max={0.95} format={pct} reset={0} onChange={(v) => set({ ...rect, x: v, w: Math.min(rect.w, 1 - v) })} />
          <Slider label={t('Top edge')} value={rect.y} min={0} max={0.95} format={pct} reset={0} onChange={(v) => set({ ...rect, y: v, h: Math.min(rect.h, 1 - v) })} />
          <Slider label={t('Width')} value={rect.w} min={0.05} max={1 - rect.x} format={pct} reset={1 - rect.x} onChange={(v) => set({ ...rect, w: v })} />
          <Slider label={t('Height')} value={rect.h} min={0.05} max={1 - rect.y} format={pct} reset={1 - rect.y} onChange={(v) => set({ ...rect, h: v })} />
        </>
      )}
      <p className="hint">{t('Crop to 9:16 to turn a horizontal video into a full-screen vertical one.')}</p>
      <button className="btn" onClick={() => { setAspect('original'); editClip(clip.id, (c) => { if (c.kind === 'video' || c.kind === 'image') delete c.crop; }); }}>{t('Reset crop')}</button>
    </>
  );
}

// ---------- Voice-over ----------

const extFor = (type: string) => (type.includes('mp4') ? 'm4a' : type.includes('ogg') ? 'ogg' : 'webm');

export function VoiceoverBody() {
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  const [elapsed, setElapsed] = useState(0);
  const [level, setLevel] = useState(0);
  const rec = useRef<VoiceRecorder | null>(null);
  const startAt = useRef(0);
  const raf = useRef(0);

  useEffect(() => () => {
    rec.current?.cancel();
    cancelAnimationFrame(raf.current);
    player.setMuted(false);
  }, []);

  async function start() {
    player.prime(); // unlock audio inside the tap, before the permission prompt
    try {
      const r = new VoiceRecorder();
      await r.start();
      rec.current = r;
      startAt.current = player.time;
      const t0 = performance.now();
      player.setMuted(true);
      player.play();
      setState('recording');
      const tick = () => {
        setElapsed((performance.now() - t0) / 1000);
        setLevel(r.level());
        raf.current = requestAnimationFrame(tick);
      };
      tick();
    } catch (e) {
      editor().toast(t('Microphone is not available: {error}', { error: errorMessage(e) }), 'error');
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
    <div className="recorder">
      <p className="hint">{t('Recording starts at the playhead. The video plays without sound so you can talk over it.')}</p>
      <div className="meter" aria-hidden><div style={{ width: `${Math.round(level * 100)}%` }} /></div>
      <span className="rec-time">{formatTime(elapsed)}</span>
      {state === 'recording'
        ? <button className="rec-btn on" onClick={() => void stop()} aria-label={t('Stop recording')}><Square size={26} fill="currentColor" /></button>
        : <button className="rec-btn" disabled={state === 'saving'} onClick={() => void start()} aria-label={t('Start recording')}><Mic size={28} /></button>}
    </div>
  );
}

// ---------- Stickers ----------

export function StickersBody() {
  return (
    <div className="sticker-grid">
      {STICKERS.map((s) => <button key={s} className="sticker" onClick={() => addSticker(s)} aria-label={`Add ${s}`}>{s}</button>)}
    </div>
  );
}

// ---------- Auto captions ----------

const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function progressLabel(p: CaptionProgress): [string, number] {
  if (p.phase === 'download') return [t('Getting the speech model ({mb} MB, once)…', { mb: p.mb }), p.fraction];
  if (p.phase === 'prepare') return [t('Preparing the sound…'), 0];
  if (p.phase === 'listen') return [t('Finding speech…'), 0];
  return [t('Recognizing speech…'), p.fraction];
}

export function CaptionsBody() {
  const [model, setModel] = useState<AsrModel>(isIOS ? 'tiny' : 'base');
  const [lang, setLang] = useState('');
  const [preset, setPreset] = useState('pop');
  const [progress, setProgress] = useState<CaptionProgress | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function run() {
    const p = editor().project;
    if (!p) return;
    if (!soundEntries(p).length) { editor().toast(t('There is no sound in this project to caption')); return; }
    player.pause();
    const ac = new AbortController();
    abort.current = ac;
    const started = performance.now();
    try {
      const words = await transcribeProject(p, model, lang || null, setProgress, ac.signal);
      track('captions_generated', { model, lang: lang || 'auto', words: words.length, seconds: Math.round((performance.now() - started) / 1000) });
      addCaptions(words, preset);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') editor().toast(t('Captions failed: {error}', { error: errorMessage(e) }), 'error');
    } finally {
      setProgress(null);
    }
  }

  if (progress) {
    const [label, f] = progressLabel(progress);
    return (
      <div className="export-progress">
        <div className="progress"><div style={{ width: `${Math.round(f * 100)}%` }} /></div>
        <p>{label} {Math.round(f * 100)}%</p>
        <button className="btn" onClick={() => abort.current?.abort()}>{t('Cancel')}</button>
      </div>
    );
  }
  return (
    <>
      <h3>{t('Language')}</h3>
      <select className="select" value={lang} onChange={(e) => setLang(e.target.value)} aria-label={t('Language')}>
        {CAPTION_LANGUAGES.map((l) => <option key={l.label} value={l.id ?? ''}>{t(l.label)}</option>)}
      </select>
      <p className="hint">{t('Pick the language if the video mixes languages or the result looks wrong.')}</p>
      <h3>{t('Recognition')}</h3>
      <Chips options={['tiny', 'base'] as const} value={model} onChange={setModel} render={(m) => `${t(ASR_MODELS[m].label)}, ${ASR_MODELS[m].mb} MB`} />
      <h3>{t('Style')}</h3>
      <Chips options={CAPTION_PRESETS.map((x) => x.id)} value={preset} onChange={setPreset} render={(id) => CAPTION_PRESETS.find((x) => x.id === id)!.name} />
      <p className="hint">{t('Speech is recognized on this device and your audio is never uploaded. The model downloads once and is kept in this browser.')}</p>
      <button className="btn primary big" onClick={() => void run()}>{t('Create captions')}</button>
      <button className="btn" onClick={() => void importSubtitles()}>{t('Import .srt or .vtt')}</button>
    </>
  );
}

export function CaptionEditBody({ clip }: { clip: CaptionClip }) {
  const e = (fn: (c: CaptionClip) => void, key?: string) =>
    editClip(clip.id, (c) => { if (c.kind === 'caption') fn(c); }, key && `${key}:${clip.id}`);
  const pages = captionPages(clip.words, Math.max(1, clip.wordsPerPage));

  const commitPage = (i: number, text: string) => e((c) => {
    const pg = captionPages(c.words, Math.max(1, c.wordsPerPage))[i];
    if (!pg || pg.map((w) => w.text).join(' ') === text.trim()) return;
    const at = c.words.indexOf(pg[0]);
    const words = text.trim() ? wordsFromSegment(pg[0].t0, pg[pg.length - 1].t1, text) : [];
    c.words.splice(at, pg.length, ...words);
  });

  return (
    <>
      <Chips options={CAPTION_PRESETS.map((x) => x.id)} value={clip.preset ?? null} render={(id) => CAPTION_PRESETS.find((x) => x.id === id)!.name}
        onChange={(id) => e((c) => {
          const pr = CAPTION_PRESETS.find((x) => x.id === id)!;
          Object.assign(c, { style: { ...pr.style }, highlight: pr.highlight, wordsPerPage: pr.wordsPerPage, preset: pr.id });
        })} />
      <Slider label={t('Words at once')} value={clip.wordsPerPage} min={1} max={12} step={1} format={(v) => String(v)} reset={4}
        onChange={(v) => e((c) => { c.wordsPerPage = v; }, 'wpp')} />
      <Slider label={t('Size')} value={clip.style.size} min={0.02} max={0.15} step={0.001} format={(v) => `${Math.round(v * 1000) / 10}`} reset={0.055}
        onChange={(v) => e((c) => { c.style.size = v; }, 'csize')} />
      <h3>{t('Text color')}</h3>
      <Swatches label={t('Text color')} value={clip.style.color} onChange={(col) => e((c) => { c.style.color = col; })} />
      <Toggle label={t('Highlight the spoken word')} value={!!clip.highlight} onChange={(v) => e((c) => { c.highlight = v ? '#ffc53d' : null; })} />
      {clip.highlight && <Swatches label={t('Highlight color')} value={clip.highlight} onChange={(col) => e((c) => { c.highlight = col; })} />}
      <h3>{t('Text ({n} lines)', { n: pages.length })}</h3>
      <div className="caption-list">
        {pages.map((pg, i) => {
          const text = pg.map((w) => w.text).join(' ');
          return (
            <label key={`${pg[0].t0.toFixed(3)}:${text}`} className="caption-row">
              <span>{formatTime(clip.start + pg[0].t0)}</span>
              <input defaultValue={text} aria-label={t('Caption line {n}', { n: i + 1 })}
                onFocus={() => { player.pause(); player.seek(clip.start + pg[0].t0 + 0.01); useEditor.setState({ time: player.time }); }}
                onBlur={(ev) => commitPage(i, ev.target.value)}
                onKeyDown={(ev) => { if (ev.key === 'Enter') (ev.target as HTMLInputElement).blur(); }} />
            </label>
          );
        })}
      </div>
      <CutByText clip={clip} />
      <button className="btn" onClick={() => void exportSubtitles()}>{t('Save as .srt')}</button>
    </>
  );
}

/** "Edit by text": mark words (fillers, repeats, anything) and cut them out of the video; captions follow. */
function CutByText({ clip }: { clip: CaptionClip }) {
  const [on, setOn] = useState(false);
  const [marked, setMarked] = useState<Set<number>>(new Set());
  const toggle = (i: number) => setMarked((m) => { const n = new Set(m); if (n.has(i)) n.delete(i); else n.add(i); return n; });
  const seconds = [...marked].reduce((n, i) => n + (clip.words[i].t1 - clip.words[i].t0), 0);

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

  if (!on) return <button className="btn" onClick={() => setOn(true)}>{t('Edit video by text')}</button>;
  return (
    <div className="cut-text">
      <h3>{t('Tap words to cut them from the video')}</h3>
      <div className="words">
        {clip.words.map((w, i) => (
          <button key={i} className={`word ${marked.has(i) ? 'cut' : ''}`} aria-pressed={marked.has(i)} onClick={() => toggle(i)}>{w.text}</button>
        ))}
      </div>
      <div className="row">
        <button className="btn" onClick={() => setMarked(new Set(fillerIndices(clip.words)))}>{t('Mark fillers and repeats')}</button>
        <button className="btn primary" disabled={!marked.size} onClick={() => void cut()}>{t('Cut {n} words ({s} s)', { n: marked.size, s: seconds.toFixed(1) })}</button>
      </div>
      <p className="hint">{t('Only the main track is cut; captions move with it. You can undo it.')}</p>
    </div>
  );
}
