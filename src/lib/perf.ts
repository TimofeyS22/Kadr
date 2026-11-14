// Local performance probes (v0.7, docs/04): marks, frame timing, long tasks. Nothing leaves the device; the
// ?perf overlay and the perf bench read `window.__kadrPerf`.
export const perf = {
  marks: {} as Record<string, number>,
  /** Frames drawn by the preview, and how long each took from request to pixels (ms, last 600). */
  drawn: 0,
  drawMs: [] as number[],
  last: { t: -1, at: 0, exact: true },
  longTasks: [] as number[],
  /** Media kept in chunks (a private tab): the most chunks held in memory at once, and reads of a chunk from storage. */
  chunks: { peak: 0, loads: 0 },
  /** Stored media read through the door (docs/19 H5): dead leases replaced, and reads that failed even so. */
  leases: { renewed: 0, failed: 0 },
};

const waiting = new Map<string, (() => void)[]>();

export function mark(name: string): void {
  if (name in perf.marks) return;
  perf.marks[name] = performance.now();
  for (const go of waiting.get(name) ?? []) go();
  waiting.delete(name);
}

/**
 * Resolves once `name` is marked (at once if it already is). Code a screen does not need to be used waits for its mark,
 * so a first visit downloads it after the screen answers, not before (audit V-143: `editor:shown`).
 */
export function marked(name: string): Promise<void> {
  if (name in perf.marks) return Promise.resolve();
  return new Promise((go) => waiting.set(name, [...(waiting.get(name) ?? []), go]));
}

export function frameDrawn(t: number, ms: number, exact = true): void {
  perf.drawn++;
  perf.last = { t, at: performance.now(), exact };
  perf.drawMs.push(ms);
  if (perf.drawMs.length > 600) perf.drawMs.shift();
}

try {
  new PerformanceObserver((list) => { for (const e of list.getEntries()) { perf.longTasks.push(e.duration); if (perf.longTasks.length > 500) perf.longTasks.shift(); } })
    .observe({ type: 'longtask', buffered: true });
} catch { /* long tasks are Chromium-only */ }

(globalThis as unknown as { __kadrPerf: typeof perf }).__kadrPerf = perf;
