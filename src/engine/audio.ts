// Audio mixing with Web Audio. The same scheduling code drives realtime preview (AudioContext)
// and export (OfflineAudioContext rendered in windows), so the exported mix matches the preview.
import { duckBreakpoints, duckGain, mergeRanges } from '../core/duck';
import { speechRanges } from '../core/silence';
import { clipEnd, fitFades, soundAssetId, sourceSpan, sourceTime, timelineTimeOf } from '../core/timeline';
import type { Project, SoundClip } from '../core/types';
import type { WrappedAudioBuffer } from 'mediabunny';
import { MediaError, PEAKS_PER_SEC, waveform, type MediaPool } from './media';
import type { SoundSink } from './sound';

export interface SoundEntry { clip: SoundClip; fadeIn: number; fadeOut: number; duck: number }

/** Audible clips with effective fades (main-track transitions crossfade the sound too). */
export function soundEntries(p: Project): SoundEntry[] {
  const out: SoundEntry[] = [];
  for (const track of p.tracks) {
    if (track.muted) continue;
    track.clips.forEach((c, i) => {
      if ((c.kind !== 'video' && c.kind !== 'audio') || c.muted || c.volume <= 0) return;
      if (!p.assets[soundAssetId(c)]?.hasAudio) return;
      let fadeIn = c.fadeIn, fadeOut = c.fadeOut;
      if (track.kind === 'main') {
        const next = track.clips[i + 1];
        if (c.kind === 'video' && c.transitionIn) fadeIn = Math.max(fadeIn, c.transitionIn.duration);
        if (next && next.kind !== 'audio' && next.transitionIn) fadeOut = Math.max(fadeOut, next.transitionIn.duration);
      }
      [fadeIn, fadeOut] = fitFades(c.duration, fadeIn, fadeOut);
      out.push({ clip: c, fadeIn, fadeOut, duck: c.duck ?? 0 });
    });
  }
  return out;
}

const duckCache = new WeakMap<Project, Promise<[number, number][]>>();

/**
 * Timeline ranges with sound in clips that are not themselves ducked (voices, talking video) — the music
 * clips marked for ducking are lowered during these. Cached per project version.
 */
export function duckRanges(p: Project): Promise<[number, number][]> {
  let r = duckCache.get(p);
  if (!r) {
    r = (async () => {
      const ranges: [number, number][] = [];
      for (const e of soundEntries(p)) {
        if (e.duck > 0) continue;
        const c = e.clip;
        const peaks = await waveform(soundAssetId(c));
        for (const [a, b] of speechRanges(peaks, PEAKS_PER_SEC, c.in, c.in + sourceSpan(c), { threshold: 0.02, minPause: 0.5, pad: 0.05 })) {
          ranges.push([Math.max(c.start, timelineTimeOf(c, a)), Math.min(clipEnd(c), timelineTimeOf(c, b))]);
        }
      }
      return mergeRanges(ranges);
    })();
    duckCache.set(p, r);
  }
  return r;
}

function envelope(e: SoundEntry, t: number, ducks: [number, number][]): number {
  const c = e.clip;
  let g = c.volume * (e.duck > 0 ? duckGain(t, ducks, e.duck) : 1);
  if (e.fadeIn > 0) g *= Math.min(1, Math.max(0, (t - c.start) / e.fadeIn));
  if (e.fadeOut > 0) g *= Math.min(1, Math.max(0, (clipEnd(c) - t) / e.fadeOut));
  return g;
}

interface ScheduleOpts {
  ctx: BaseAudioContext;
  out: AudioNode;
  sink: SoundSink;
  entry: SoundEntry;
  from: number;
  to: number;
  /** Timeline time → context time. */
  at: (tl: number) => number;
  keep: (n: AudioNode) => void;
  drop?: (n: AudioNode) => void;
  pace?: (tl: number) => Promise<void>;
  signal?: AbortSignal;
  ducks?: [number, number][];
  /** The clip's buffers from the window start, when they were opened ahead (see `primed`). */
  stream?: AsyncIterable<WrappedAudioBuffer>;
}

/** Schedules the part of a clip inside timeline window [from, to). */
async function scheduleClip(o: ScheduleOpts): Promise<void> {
  const { ctx, entry: e, at } = o;
  const c = e.clip;
  const t0 = Math.max(o.from, c.start), t1 = Math.min(o.to, clipEnd(c));
  if (t1 <= t0) return;
  const gain = ctx.createGain();
  gain.connect(o.out);
  o.keep(gain);
  const floor = ctx.currentTime;
  const ducks = o.ducks ?? [];
  const points = [t0, c.start + e.fadeIn, clipEnd(c) - e.fadeOut, t1, ...(e.duck > 0 ? duckBreakpoints(ducks, t0, t1) : [])]
    .filter((x) => x >= t0 && x <= t1).sort((a, b) => a - b);
  gain.gain.setValueAtTime(envelope(e, t0, ducks), Math.max(floor, at(t0)));
  for (const x of points.slice(1)) gain.gain.linearRampToValueAtTime(envelope(e, x, ducks), Math.max(floor, at(x)));

  const s0 = sourceTime(c, t0), s1 = sourceTime(c, t1);
  for await (const { buffer, timestamp } of o.stream ?? o.sink.buffers(s0, s1)) {
    if (o.signal?.aborted) return;
    const b0 = Math.max(timestamp, s0), b1 = Math.min(timestamp + buffer.duration, s1);
    if (b1 <= b0) continue;
    const tl0 = timelineTimeOf(c, b0);
    const tl1 = timelineTimeOf(c, b1);
    if (tl1 <= tl0) continue;
    const rate = (b1 - b0) / (tl1 - tl0); // follows speed curves buffer by buffer
    if (o.pace) await o.pace(tl0);
    if (o.signal?.aborted) return;
    let when = at(tl0);
    let offset = b0 - timestamp;
    const now = ctx.currentTime;
    if (when < now) { offset += (now - when) * rate; when = now; } // started late: skip what already passed
    const end = at(tl1);
    if (end <= when) continue;
    const node = ctx.createBufferSource();
    node.buffer = buffer;
    node.playbackRate.value = rate;
    node.connect(gain);
    node.start(when, offset);
    node.stop(end);
    o.keep(node);
    node.onended = () => o.drop?.(node); // one node per decoded buffer: release them as they finish
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const LOOKAHEAD = 1.2;
/** Clips starting this soon after the playhead have this much decoded before the clock starts. */
const PRIME_S = 0.5;
/** The longest the clock waits for that sound; then playback starts and late sound joins in sync. */
const PRIME_MAX_MS = 2000;

/** A buffer stream with its first `seconds` already decoded; `close` releases the decoder if it is never played. */
async function primed(it: AsyncGenerator<WrappedAudioBuffer, void, unknown>, seconds: number) {
  const head: WrappedAudioBuffer[] = [];
  let got = 0, done = false;
  while (got < seconds) {
    const r = await it.next();
    if (r.done) { done = true; break; }
    head.push(r.value);
    got += r.value.duration;
  }
  const close = () => void it.return(undefined).catch(() => undefined);
  return {
    stream: (async function* () { try { yield* head; if (!done) yield* it; } finally { close(); } })(),
    close,
  };
}

/** Realtime preview mixer; its context clock is the playback clock. */
export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private nodes = new Set<AudioNode>();
  private abort: AbortController | null = null;
  private startCtx = 0;
  private startTl = 0;
  onError: ((e: unknown) => void) | null = null;

  /**
   * Creates the context ahead of time (it starts suspended). Creating it can block the main thread for a
   * noticeable moment, so it happens while the editor is idle, not inside the Play tap (docs/04).
   */
  warm(): void {
    if (this.ctx) return;
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.master = this.ctx.createGain();
    this.master.connect(this.ctx.destination);
  }

  /** Must run synchronously inside a user gesture (iOS/Chrome autoplay rules). */
  unlock(): void {
    this.warm();
    // Play through the iOS silent switch, like video apps do.
    const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
    if (this.ctx!.state !== 'running') void this.ctx!.resume();
  }

  now(): number {
    return this.ctx ? Math.max(this.startTl, this.startTl + this.ctx.currentTime - this.startCtx) : this.startTl;
  }

  /**
   * Plays the mix from timeline time `t`. With `wait`, the clock holds at `t` (now() stays put, so does the picture)
   * until the sound at the playhead is decoded, up to PRIME_MAX_MS: otherwise a slow first decode (opening the file,
   * a busy phone) made playback start silent, the clip's first moments skipped as already late (QA, docs/11 §3.2).
   * Without it (a restart after an edit while playing) the clock runs on at once.
   */
  start(p: Project, t: number, pool: MediaPool, wait = false): void {
    this.stop();
    const ctx = this.ctx, master = this.master;
    this.startTl = t;
    if (!ctx || !master) return;
    const ac = new AbortController();
    this.abort = ac;
    this.startCtx = Infinity; // holds now() at t
    const at = (tl: number) => this.startCtx + (tl - t);
    const pace = async (tl: number) => {
      while (!ac.signal.aborted && tl - this.now() > LOOKAHEAD) await sleep(100);
    };
    const ready: Promise<unknown>[] = [];
    let go!: () => void;
    const clock = new Promise<void>((r) => { go = r; });
    ac.signal.addEventListener('abort', () => go()); // waiting tasks see the abort and release what they opened
    for (const entry of soundEntries(p)) {
      const c = entry.clip;
      if (clipEnd(c) <= t) continue;
      const soon = wait && c.start <= t + PRIME_S;
      const opened = (async () => {
        if (!soon) { await clock; await pace(c.start); }
        if (ac.signal.aborted) return null;
        const sink = await pool.audioSink(soundAssetId(c));
        const ducks = entry.duck > 0 ? await duckRanges(p) : undefined;
        if (!sink || ac.signal.aborted) return null;
        const head = soon ? await primed(sink.buffers(sourceTime(c, Math.max(t, c.start)), sourceTime(c, clipEnd(c))), PRIME_S) : null;
        return { sink, ducks, head };
      })();
      if (soon) ready.push(opened.catch(() => undefined));
      void (async () => {
        const o = await opened;
        if (!o) return;
        await clock;
        if (ac.signal.aborted) { o.head?.close(); return; }
        await scheduleClip({ ctx, out: master, sink: o.sink, entry, from: t, to: Infinity, at, keep: (n) => this.nodes.add(n), drop: (n) => { n.disconnect(); this.nodes.delete(n); }, pace, signal: ac.signal, ducks: o.ducks, stream: o.head?.stream });
      })().catch((e) => { if (!ac.signal.aborted) this.onError?.(e); });
    }
    const run = () => {
      if (ac.signal.aborted) return;
      this.startCtx = ctx.currentTime + 0.05;
      go();
    };
    if (ready.length) void Promise.race([Promise.all(ready), sleep(PRIME_MAX_MS)]).then(run);
    else run();
  }

  /** Silences playback (e.g. while recording a voice-over) without affecting the mix. */
  setMuted(muted: boolean): void {
    if (this.master) this.master.gain.value = muted ? 0 : 1;
  }

  stop(): void {
    this.abort?.abort();
    this.abort = null;
    for (const n of this.nodes) {
      if (n instanceof AudioScheduledSourceNode) try { n.stop(); } catch { /* not started */ }
      n.disconnect();
    }
    this.nodes.clear();
  }

  dispose(): void {
    this.stop();
    void this.ctx?.close();
    this.ctx = null;
    this.master = null;
  }
}

/**
 * Renders the mix for [from, to) seconds (use sample-aligned bounds for gapless concatenation). With `skip`, a sound
 * that cannot be decoded is left out and its asset id added to the set (captions); without it, that is an error.
 */
export async function renderAudioWindow(p: Project, pool: MediaPool, from: number, to: number, sampleRate: number, skip?: Set<string>): Promise<AudioBuffer> {
  const length = Math.max(1, Math.round((to - from) * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  for (const entry of soundEntries(p)) {
    if (entry.clip.start >= to || clipEnd(entry.clip) <= from) continue;
    const id = soundAssetId(entry.clip);
    if (skip?.has(id)) continue;
    const ducks = entry.duck > 0 ? await duckRanges(p) : undefined;
    try {
      const sink = await pool.audioSink(id);
      // The file had sound when it was added: no track that decodes now is a decoding failure, not silence.
      if (!sink && p.assets[id]?.hasAudio) throw new Error('No audio track decodes');
      if (sink) await scheduleClip({ ctx, out: ctx.destination, sink, entry, from, to, at: (tl) => tl - from, keep: () => undefined, ducks });
    } catch (e) {
      if ((e as Error).name === 'AbortError' || e instanceof MediaError) throw e;
      if (skip) { console.warn('sound left out', p.assets[id]?.name, e); skip.add(id); continue; }
      // Name the file: a bare decoder message ("Unsupported configuration…") does not tell anyone what to do.
      throw new MediaError('The sound of “{name}” cannot be decoded in this browser ({error})', { name: p.assets[id]?.name ?? '?', error: (e as Error).message ?? String(e) });
    }
  }
  return ctx.startRendering();
}
