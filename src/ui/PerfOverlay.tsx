// Performance overlay for testing on a real phone (docs/04): open the site with ?perf once, it stays on until ?perf=0.
import { useEffect, useState } from 'react';
import { perf } from '../lib/perf';

export function perfOverlayEnabled(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('perf');
    if (q !== null) localStorage.setItem('kadr.perf', q === '0' ? '0' : '1');
    return localStorage.getItem('kadr.perf') === '1';
  } catch {
    return false;
  }
}

export function PerfOverlay() {
  const [text, setText] = useState('');
  useEffect(() => {
    let drawn = perf.drawn, at = performance.now(), tasks = perf.longTasks.length;
    const id = setInterval(() => {
      const now = performance.now();
      const fps = ((perf.drawn - drawn) * 1000) / (now - at);
      const recent = [...perf.drawMs.slice(-60)].sort((a, b) => a - b);
      const p95 = recent.length ? recent[Math.floor(recent.length * 0.95)] : 0;
      const blocked = perf.longTasks.slice(tasks).reduce((s, d) => s + Math.max(0, d - 50), 0);
      const mem = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      setText(`${Math.round(fps)} fps · frame p95 ${Math.round(p95)} ms · blocked ${Math.round(blocked)} ms/s${mem ? ` · JS ${Math.round(mem / 1e6)} MB` : ''}`);
      drawn = perf.drawn; at = now; tasks = perf.longTasks.length;
    }, 1000);
    return () => clearInterval(id);
  }, []);
  return <div className="perf-overlay" aria-hidden>{text}</div>;
}
