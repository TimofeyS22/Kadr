// Local performance probes (v0.7, docs/04): marks, frame timing, long tasks. Nothing leaves the device; the
// ?perf overlay and the perf bench read `window.__kadrPerf`.
export const perf = {
  marks: {} as Record<string, number>,
  /** Frames drawn by the preview, and how long each took from request to pixels (ms, last 600). */
  drawn: 0,
  drawMs: [] as number[],
  last: { t: -1, at: 0, exact: true },
  longTasks: [] as number[],
};

export function mark(name: string): void {
  perf.marks[name] ??= performance.now();
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
