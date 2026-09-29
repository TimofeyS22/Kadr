export function formatTime(t: number, precise = true): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return precise ? `${m}:${s.toFixed(1).padStart(4, '0')}` : `${m}:${Math.floor(s).toString().padStart(2, '0')}`;
}
