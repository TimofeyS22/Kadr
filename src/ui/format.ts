/**
 * Timeline time as people read it: m:ss.s, and h:mm:ss.s from an hour (S-1-5: ten hours read "600:00.0"). Rounded as a
 * whole, so 59.96 s is 1:00.0, never 0:60.0.
 */
export function formatTime(t: number, precise = true): string {
  const total = precise ? Math.round(Math.max(0, t) * 10) / 10 : Math.floor(Math.max(0, t));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total - h * 3600) / 60);
  const s = total - h * 3600 - m * 60;
  const sec = precise ? s.toFixed(1).padStart(4, '0') : String(Math.floor(s)).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}
