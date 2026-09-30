// Preview playback: audio clock drives time; frames render asynchronously and drop when late.
import { buildFrame } from '../core/frame';
import { clamp, findClip, isMedia, projectDuration } from '../core/timeline';
import type { Project } from '../core/types';
import { AudioEngine } from './audio';
import { Compositor, type LayerBounds } from './compositor';
import { MediaPool } from './media';
import { resolveDrawables } from './render';
import { frameDrawn } from '../lib/perf';
import { TextRasterizer } from './text';

const PREVIEW_MAX_DIM = 1280;
const PRELOAD_S = 0.7;

export class Player {
  readonly pool = new MediaPool(PREVIEW_MAX_DIM);
  readonly text = new TextRasterizer();
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
  playing = false;
  time = 0;
  bounds: LayerBounds[] = [];
  onTick: ((t: number) => void) | null = null;
  onPlayingChange: ((playing: boolean) => void) | null = null;
  onError: ((e: unknown) => void) | null = null;

  get canvas(): HTMLCanvasElement | null { return this.compositor?.canvas ?? null; }
  get duration(): number { return this.project ? projectDuration(this.project) : 0; }

  attach(canvas: HTMLCanvasElement): void {
    this.compositor = new Compositor(canvas);
    const idle = (window as Window & { requestIdleCallback?: (cb: () => void) => void }).requestIdleCallback ?? ((cb: () => void) => setTimeout(cb, 300));
    idle(() => this.audio.warm());
    this.audio.onError = (e) => this.onError?.(e);
    this.requestRender();
  }

  detach(): void {
    this.pause();
    this.compositor?.dispose();
    this.compositor = null;
    this.pool.sweep(new Set(), 0);
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
    if (this.playing) this.audio.start(p, this.audio.now(), this.pool);
    else this.requestRender();
  }

  play(): void {
    if (!this.project || this.playing) return;
    this.audio.unlock();
    if (this.time >= this.duration - 0.02) this.time = 0;
    this.playing = true;
    this.onPlayingChange?.(true);
    this.audio.start(this.project, this.time, this.pool);
    const loop = () => {
      if (!this.playing) return;
      const t = this.audio.now();
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
    this.time = Math.min(this.audio.now(), this.duration);
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
    if (this.playing && this.project) this.audio.start(this.project, this.time, this.pool);
    this.requestRender(this.time);
  }

  requestRender(t = this.time): void {
    this.pending = t;
    if (!this.rendering) void this.drain();
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
    const p = this.project, comp = this.compositor;
    if (!p || !comp) { for (const w of this.thumbWaiters.splice(0)) w(null); return; }
    const started = performance.now();
    const tt = Math.max(0, Math.min(t, this.duration - 1e-3));
    const desc = buildFrame(p, tt);
    const { width, height } = comp.canvas;
    const fast = this.fast;
    this.fast = false;
    const sources = await resolveDrawables(desc, this.pool, this.text, width, height, fast);
    if (this.compositor !== comp) return;
    this.bounds = comp.draw(desc, sources);
    const approx = [...sources.values()].some((d) => d.approx);
    frameDrawn(tt, performance.now() - started, !approx);
    if (approx && this.pending === null) this.pending = tt; // refine to the exact frame unless scrubbing moved on
    if (this.thumbWaiters.length) this.flushThumb(comp.canvas);
    for (const fn of this.frameListeners) fn();

    const keep = new Set<string>();
    for (const l of desc.layers) if (l.source.kind === 'video') keep.add(l.source.clipId);
    if (this.playing) {
      for (const l of buildFrame(p, tt + PRELOAD_S).layers) {
        if (l.source.kind !== 'video' || keep.has(l.source.clipId)) continue;
        const f = findClip(p, l.source.clipId);
        if (!f || !isMedia(f.clip)) continue;
        keep.add(l.source.clipId);
        void this.pool.frame(l.source.clipId, l.source.assetId, f.clip.in).catch(() => undefined);
      }
    }
    this.pool.sweep(keep);
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

export const player = new Player();
