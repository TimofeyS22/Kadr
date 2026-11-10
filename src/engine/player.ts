// Preview playback: audio clock drives time; frames render asynchronously and drop when late.
import { buildFrame, withoutLook } from '../core/frame';
import { clamp, findClip, isMedia, projectDuration } from '../core/timeline';
import type { Project } from '../core/types';
import { AudioEngine, duckRanges, soundEntries } from './audio';
import { Compositor, type LayerBounds } from './compositor';
import { MediaPool } from './media';
import { resolveDrawables } from './render';
import { frameDrawn } from '../lib/perf';
import { TextRasterizer } from './text';

const PREVIEW_MAX_DIM = 1280;
const PRELOAD_S = 0.7;
/** How long a lost GPU context may take to come back before the preview gets a new canvas. */
const CONTEXT_MS = 2500;

export class Player {
  readonly pool = new MediaPool(PREVIEW_MAX_DIM);
  readonly text = new TextRasterizer();
  /** The clip shown without its colour and effect while a person holds Before / after; never in an export. */
  private original: string | null = null;
  readonly audio = new AudioEngine();
  private compositor: Compositor | null = null;
  private project: Project | null = null;
  private rendering = false;
  private pending: number | null = null;
  /** The next render follows a seek while paused: keyframes are fine, the exact frame comes right after. */
  private fast = false;
  private raf = 0;
  private frameListeners = new Set<() => void>();
  private thumbWaiters: ((url: string | null) => void)[] = [];
  private captureWaiters: ((canvas: HTMLCanvasElement | null) => void)[] = [];
  private captureFrom: Project | null = null;
  private idleSweep = 0;
  private contextTimer = 0;
  playing = false;
  /** An export is running: its decoders are the ones a phone has to spare (audit V-192). */
  locked = false;
  time = 0;
  bounds: LayerBounds[] = [];
  onTick: ((t: number) => void) | null = null;
  onPlayingChange: ((playing: boolean) => void) | null = null;
  onError: ((e: unknown) => void) | null = null;
  /** The GPU took the preview's context and did not give it back: the canvas has to be replaced. */
  onContextGone: (() => void) | null = null;

  get canvas(): HTMLCanvasElement | null { return this.compositor?.canvas ?? null; }
  get duration(): number { return this.project ? projectDuration(this.project) : 0; }

  attach(canvas: HTMLCanvasElement): void {
    const comp = this.compositor = new Compositor(canvas);
    // Not all the GPU's losses come back (audit V-228): what is restored redraws itself; what is not gets a new canvas.
    comp.onRestored = () => { clearTimeout(this.contextTimer); this.requestRender(); };
    comp.onLost = () => {
      clearTimeout(this.contextTimer);
      this.contextTimer = window.setTimeout(() => { if (this.compositor === comp && comp.isLost()) this.onContextGone?.(); }, CONTEXT_MS);
    };
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 300));
    idle(() => this.audio.warm());
    document.addEventListener('visibilitychange', this.onHidden);
    this.audio.onError = (e) => this.onError?.(e);
    // The clock is the sound: without it the picture stands still under a Pause button (audit V-133).
    this.audio.onInterrupted = () => this.pause();
    this.requestRender();
  }

  /** The page went to the background: the sound and the frames stop until the person comes back and presses Play. */
  private readonly onHidden = () => { if (document.visibilityState === 'hidden') this.pause(); };

  detach(): void {
    document.removeEventListener('visibilitychange', this.onHidden);
    this.pause();
    clearTimeout(this.contextTimer);
    this.compositor?.dispose();
    this.compositor = null;
    this.pool.release();
  }

  onFrame(fn: () => void): () => void {
    this.frameListeners.add(fn);
    return () => this.frameListeners.delete(fn);
  }

  setProject(p: Project | null): void {
    const changed = p !== this.project;
    this.project = p;
    if (!p) { this.pause(); return; }
    if (!changed) return;
    // Music lowered under speech cannot play until the speech is mapped. Mapped at Play, a talking video's sound was
    // decoded alongside the starting playback (seconds on Chromium) and the music came in late (QA, docs/11 §3.2).
    if (soundEntries(p).some((e) => e.duck > 0)) setTimeout(() => { if (this.project === p) void duckRanges(p).catch(() => undefined); }, 0);
    if (this.playing) this.audio.start(p, this.audio.heard(), this.pool); // on from what was heard: no jump of the latency
    else this.requestRender();
  }

  play(): void {
    if (!this.project || this.playing || this.locked) return;
    this.audio.unlock();
    if (this.time >= this.duration - 0.02) this.time = 0;
    this.playing = true;
    this.onPlayingChange?.(true);
    this.audio.start(this.project, this.time, this.pool, true);
    const loop = () => {
      if (!this.playing) return;
      const t = this.audio.heard(); // what is heard now, not what is being computed: Bluetooth adds 150–300 ms
      if (t >= this.duration) {
        this.pause();
        this.time = this.duration;
        this.onTick?.(this.time);
        this.requestRender();
        return;
      }
      this.time = t;
      this.onTick?.(t);
      this.requestRender(t);
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  pause(): void {
    if (!this.playing) return;
    this.time = Math.min(this.audio.heard(), this.duration); // the moment the person stopped on is the one they heard
    this.playing = false;
    cancelAnimationFrame(this.raf);
    this.audio.stop();
    this.onPlayingChange?.(false);
  }

  toggle(): void { if (this.playing) this.pause(); else this.play(); }

  setMuted(muted: boolean): void { this.audio.setMuted(muted); }

  /** Creates/resumes the audio context; call synchronously inside a user gesture. */
  prime(): void { this.audio.unlock(); }

  seek(t: number): void {
    this.time = clamp(t, 0, this.duration);
    this.fast = !this.playing;
    if (this.playing && this.project) this.audio.start(this.project, this.time, this.pool, true);
    this.requestRender(this.time);
  }

  requestRender(t = this.time): void {
    this.pending = t;
    if (!this.rendering) void this.drain();
  }

  /**
   * The next rendered frame copied to a 2D canvas at the preview's size, to read colours from (the eyedropper). With
   * `from`, that frame is drawn from another version of the project (the chroma key's colour is picked with the key
   * off), and the screen goes back to the real one right after.
   */
  capture(from?: Project | null): Promise<HTMLCanvasElement | null> {
    this.captureFrom = from ?? null; // never an earlier capture's version
    return new Promise((resolve) => { this.captureWaiters.push(resolve); this.requestRender(); });
  }

  /** Resolves with a small JPEG data URL of the next rendered frame. */
  snapshot(): Promise<string | null> {
    return new Promise((resolve) => { this.thumbWaiters.push(resolve); this.requestRender(); });
  }

  private async drain(): Promise<void> {
    this.rendering = true;
    try {
      while (this.pending !== null) {
        const t = this.pending;
        this.pending = null;
        await this.renderAt(t);
      }
    } catch (e) {
      this.onError?.(e);
    } finally {
      this.rendering = false;
    }
  }

  private async renderAt(t: number): Promise<void> {
    const comp = this.compositor;
    if (!this.project || !comp) { for (const w of [...this.thumbWaiters.splice(0), ...this.captureWaiters.splice(0)]) w(null); return; }
    // A capture gets a frame begun after it was asked for: one asked mid-frame waits for the next (requestRender), or
    // the chroma key's eyedropper read the frame with the key on, already see-through.
    const capture = this.captureWaiters.splice(0);
    const from = capture.length ? this.captureFrom : null;
    if (capture.length) this.captureFrom = null;
    let shot: HTMLCanvasElement | null = null;
    try {
      shot = await this.drawFrame(t, comp, from, capture.length > 0);
    } finally {
      for (const w of capture) w(shot);
    }
  }

  showOriginal(clipId: string | null): void {
    if (this.original === clipId) return;
    this.original = clipId;
    this.requestRender();
  }

  /** Draws the frame at `t` (from `from` instead of the project, if given); with `copy`, returns a copy of it. */
  private async drawFrame(t: number, comp: Compositor, from: Project | null, copy: boolean): Promise<HTMLCanvasElement | null> {
    const p = from ?? this.project!;
    const started = performance.now();
    const tt = Math.max(0, Math.min(t, this.duration - 1e-3));
    const built = buildFrame(p, tt);
    const desc = !from && this.original ? withoutLook(built, this.original) : built;
    const { width, height } = comp.canvas;
    const fast = this.fast;
    this.fast = false;
    const sources = await resolveDrawables(desc, this.pool, this.text, width, height, fast, comp.frameMax);
    if (this.compositor !== comp) return null;
    this.bounds = comp.draw(desc, sources);
    const approx = [...sources.values()].some((d) => d.approx);
    frameDrawn(tt, performance.now() - started, !approx);
    if (approx && this.pending === null) this.pending = tt; // refine to the exact frame unless scrubbing moved on
    if (this.thumbWaiters.length) this.flushThumb(comp.canvas);
    const shot = copy ? copyCanvas(comp.canvas) : null;
    if (from && this.pending === null) this.pending = tt; // the real frame again
    for (const fn of this.frameListeners) fn();

    const keep = new Set<string>();
    for (const l of desc.layers) if (l.source.kind === 'video') keep.add(l.source.clipId);
    if (this.playing) {
      for (const l of buildFrame(p, tt + PRELOAD_S).layers) {
        if (l.source.kind !== 'video' || keep.has(l.source.clipId)) continue;
        const f = findClip(p, l.source.clipId);
        if (!f || !isMedia(f.clip)) continue;
        keep.add(l.source.clipId);
        void this.pool.picture(l.source.clipId, l.source.assetId, f.clip.in, false, comp.frameMax).catch(() => undefined);
      }
    }
    this.pool.sweep(keep);
    this.pool.trimImages(new Set(desc.layers.flatMap((l) => (l.source.kind === 'image' ? [l.source.assetId] : []))));
    // The preview renders nothing while it is still, so nothing closed the decoders of clips the playhead passed on its
    // way (a scrub across 8 clips kept 8 hardware decoders, which a phone does not have to spare: audit V-171). They
    // close once the screen has been still for a moment.
    clearTimeout(this.idleSweep);
    this.idleSweep = window.setTimeout(() => { if (!this.playing && !this.rendering) this.pool.sweep(keep); }, 1600);
    return shot;
  }

  private flushThumb(src: HTMLCanvasElement): void {
    let url: string | null = null;
    try {
      const s = 240 / Math.max(src.width, src.height);
      const c = document.createElement('canvas');
      c.width = Math.round(src.width * s);
      c.height = Math.round(src.height * s);
      c.getContext('2d')!.drawImage(src, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', 0.7);
    } catch { /* tainted or lost context */ }
    for (const w of this.thumbWaiters.splice(0)) w(url);
  }
}

/** Copies the frame just drawn: a WebGL canvas is readable only before the browser composites it. */
function copyCanvas(src: HTMLCanvasElement): HTMLCanvasElement | null {
  try {
    const out = Object.assign(document.createElement('canvas'), { width: src.width, height: src.height });
    out.getContext('2d', { willReadFrequently: true })!.drawImage(src, 0, 0);
    return out;
  } catch { return null; /* tainted or lost context */ }
}

export const player = new Player();
