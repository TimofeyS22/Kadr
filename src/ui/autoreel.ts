// "Reel in one tap" (docs/08 A): runs the plan from core/autoreel on the open project. Every change is its own
// history step, so "Undo all" (and plain undo) walks it back; a cancel mid-way restores the project as it was.
import { projectScript } from '../core/script';
import { fillerCuts, fitWordsToPauses, hookClip, hookText, jumpZoom, pauseCuts, soundMainClips, withoutIndices } from '../core/autoreel';
import { captionLayout, setCaptionLayout } from '../core/captions';
import { createAudioClip, createCaptionClip } from '../core/defaults';
import { fitTrack, type Mood } from '../core/music';
import { CAPTION_ACCENT, CAPTION_PRESETS } from '../core/presets';
import { cutTimelineRanges, endWithContent, mainTrack, placeClip, projectDuration, soundAssetId } from '../core/timeline';
import type { CaptionWord, Project } from '../core/types';
import type { AsrModel, CaptionProgress } from '../engine/captions';
import { MediaError, PEAKS_PER_SEC, waveform } from '../engine/media';
import { player } from '../engine/player';
import { t } from '../lib/i18n';
import { errorMessage, track } from '../lib/telemetry';
import { editor, useEditor } from '../state/store';
import { downloadLibraryTrack, loadManifest } from './actions';
import { keepAwake } from '../lib/wakeLock';

export interface ReelOptions {
  pauses: boolean; fillers: boolean; captions: boolean; preset: string; zoom: boolean; hook: boolean;
  music: Mood | null; language: string; model: AsrModel;
}
export const DEFAULT_REEL: ReelOptions = {
  pauses: true, fillers: true, captions: true, preset: 'bold', zoom: true, hook: true, music: 'calm', language: '', model: 'base',
};

export interface ReelReport {
  steps: number; before: number; after: number; pauses: number; fillers: number; words: number; zoomed: number;
  hook: string | null; music: string | null; musicError: string | null; noSpeech: boolean; seconds: number;
  /** Speech language used (id from CAPTION_LANGUAGES) and whether Kadr detected it. */
  language: string | null; detected: boolean;
  /** Captions and title took their words from the teleprompter text (docs/09 S1). */
  script: boolean;
}

/** Whether the reel will listen to speech (and so needs the speech stages on its bar). */
export const reelUsesSpeech = (o: ReelOptions): boolean => o.captions || o.fillers || o.hook;

/** Stage on the progress bar (ui/pace), what to say, and the fraction when the job knows it. */
function speechLabel(p: CaptionProgress): [string, string, number | null] {
  if (p.phase === 'download') return ['model', t('Getting the speech model ({mb} MB, once)…', { mb: p.mb }), p.fraction];
  if (p.phase === 'prepare') return ['prepare', t('Preparing the sound…'), null];
  if (p.phase === 'listen') return ['listen', t('Finding speech…'), null];
  return ['transcribe', t('Recognizing speech…'), p.fraction];
}

/** Runs the reel plan. Throws AbortError on cancel, after undoing whatever it had already changed. */
export async function makeReel(o: ReelOptions, onProgress: (stage: string, label: string, f: number | null) => void, signal: AbortSignal): Promise<ReelReport> {
  const s = editor();
  const p0 = s.project;
  if (!p0 || !mainTrack(p0).clips.length) throw new MediaError('Add a video with speech first');
  player.pause();
  const started = performance.now();
  const r: ReelReport = { steps: 0, before: projectDuration(p0), after: 0, pauses: 0, fillers: 0, words: 0, zoomed: 0, hook: null, music: null, musicError: null, noSpeech: false, seconds: 0, language: null, detected: false, script: false };
  /** One history step; counted only when it changed the project. */
  const step = (fn: (d: Project) => void) => {
    const before = editor().project;
    editor().commit(fn);
    if (editor().project !== before) r.steps++;
  };
  const check = () => { if (signal.aborted) throw new DOMException('Cancelled', 'AbortError'); };
  track('reel_started', { ...o, music: o.music ?? 'none', clips: mainTrack(p0).clips.length, seconds: Math.round(r.before) });
  const awake = keepAwake(); // minutes of work: a dark screen would suspend it
  try {
    const clips = soundMainClips(p0);
    let words: CaptionWord[] = [];
    let own: CaptionWord[] | null = null; // the recording's own text, timed by the speech
    if ((o.captions || o.fillers || o.hook) && clips.length) {
      const { transcribeProject } = await import('../engine/captions');
      const tr = await transcribeProject(p0, o.model, o.language || null, (pr) => onProgress(...speechLabel(pr)), signal);
      words = tr.words;
      r.language = tr.language;
      r.detected = tr.detected;
      const script = projectScript(p0);
      if (script && (o.captions || o.hook)) {
        const { alignToScript } = await import('../engine/captions');
        onProgress('align', t('Matching your text…'), null);
        own = (await alignToScript(script, tr))?.words ?? null;
        r.script = !!own;
      }
    }
    r.noSpeech = !words.length;
    check();
    onProgress('pauses', t('Finding pauses…'), null);
    const peaks = new Map<string, Float32Array>();
    for (const c of clips) peaks.set(c.id, await waveform(soundAssetId(c)));
    check();
    const filler = o.fillers && words.length
      ? fillerCuts(words, clips, (c) => peaks.get(c.id), PEAKS_PER_SEC)
      : { ranges: [] as [number, number][], indices: [] as number[] };
    // All cut ranges are planned on the untouched timeline, before anything moves.
    const pauseRanges = o.pauses ? clips.flatMap((c) => pauseCuts(c, peaks.get(c.id)!, PEAKS_PER_SEC)) : [];
    // Fillers are cut by the recognized words; what the captions say comes from the text when there is one.
    const spoken = fitWordsToPauses(own ?? withoutIndices(words, filler.indices), pauseRanges);

    if (o.captions && spoken.length) {
      const preset = CAPTION_PRESETS.find((x) => x.id === o.preset) ?? CAPTION_PRESETS[0];
      step((d) => {
        const c = createCaptionClip(spoken, preset);
        // A reel follows the speech word by word: a template of plain phrases gets the spoken word lit; the others keep
        // their own layout (one word, words appearing).
        if (captionLayout(c) === 'phrase') setCaptionLayout(c, 'highlight', preset.highlight ?? CAPTION_ACCENT);
        endWithContent(d, c);
        placeClip(d, c);
      });
      r.words = spoken.length;
    }
    if (pauseRanges.length || filler.ranges.length) {
      step((d) => { cutTimelineRanges(d, [...pauseRanges, ...filler.ranges]); }); // captions move with the cuts
      r.pauses = pauseRanges.length;
      r.fillers = filler.indices.length;
    }
    if (o.zoom) step((d) => { r.zoomed = jumpZoom(d); });
    const hook = o.hook ? hookText(spoken) : null;
    if (hook) { step((d) => { const c = hookClip(hook); endWithContent(d, c); placeClip(d, c); }); r.hook = hook; }
    check();

    if (o.music) {
      // Music is a bonus: if it can't be fetched (offline), the reel is still done.
      try {
        onProgress('music', t('Adding music…'), 0);
        const dur = projectDuration(editor().project!);
        const pool = (await loadManifest()).tracks.filter((x) => x.mood === o.music);
        const tr = pool.find((x) => x.duration >= dur) ?? [...pool].sort((a, b) => b.duration - a.duration)[0];
        if (tr) {
          const asset = await downloadLibraryTrack(tr, (f) => onProgress('music', t('Adding music…'), f), signal);
          step((d) => {
            d.assets[asset.id] = asset;
            const c = createAudioClip(asset, 0);
            const fit = fitTrack(asset.duration, dur);
            c.duration = fit.duration;
            c.fadeOut = fit.fadeOut;
            c.volume = 0.5;
            c.duck = 0.8; // lowered under the voice
            placeClip(d, c);
          });
          r.music = tr.title;
        }
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        r.musicError = errorMessage(e);
      }
    }
    r.after = projectDuration(editor().project!);
    r.seconds = (performance.now() - started) / 1000;
    track('reel_done', {
      steps: r.steps, seconds: Math.round(r.seconds), before: Math.round(r.before), after: Math.round(r.after),
      pauses: r.pauses, fillers: r.fillers, words: r.words, zoomed: r.zoomed, music: !!r.music, noSpeech: r.noSpeech,
      language: r.language ?? 'none', detected: r.detected, script: r.script,
    });
    editor().select(null);
    player.seek(0);
    useEditor.setState({ time: 0 });
    return r;
  } catch (e) {
    undoSteps(r.steps);
    if ((e as Error).name === 'AbortError') track('reel_cancelled', { steps: r.steps });
    throw e;
  } finally {
    awake();
  }
}

/** Walks back the reel's own history steps (it made nothing else in between). */
export function undoSteps(n: number): void {
  for (let i = 0; i < n; i++) editor().undo();
}
