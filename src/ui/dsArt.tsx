// Pictures that stand in for a person's video in the gallery `?ds`: content, not interface, so their colours are free
// (tokens.test.ts lists this file as content). Drawn, not filmed: no faces, no files from fixtures/real (docs/17 Ч1).
import { useId, type CSSProperties } from 'react';

type Scene = 'night' | 'mountains' | 'food';

/** A 9:16 frame of one of three scenes. `look` is a CSS filter, to show a filter or a colour setting on it. */
export function Shot({ scene = 'night', look, slice = true }: { scene?: Scene; look?: string; slice?: boolean }) {
  const id = useId().replace(/:/g, '');
  const style: CSSProperties | undefined = look ? { filter: look } : undefined;
  const fit = slice ? 'xMidYMid slice' : 'xMidYMid meet';
  if (scene === 'mountains') return (
    <svg viewBox="0 0 90 160" preserveAspectRatio={fit} style={style} aria-hidden="true">
      <defs><linearGradient id={`${id}s`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#22395f" /><stop offset=".55" stopColor="#d9825a" /><stop offset=".75" stopColor="#f2c47c" /></linearGradient></defs>
      <rect width="90" height="160" fill={`url(#${id}s)`} />
      <circle cx="60" cy="96" r="10" fill="#fff0c8" />
      <path d="M0 112 18 92 34 108 52 86 72 106 90 94V160H0Z" fill="#3d3552" />
      <path d="M0 130 24 114 46 128 70 114 90 126V160H0Z" fill="#241f34" />
      <circle cx="32" cy="116" r="5.5" fill="#14121c" /><path d="M24 160V134q0-10 8-10t8 10V160Z" fill="#14121c" /><path d="M38 128h5v14h-5Z" fill="#b5503c" />
    </svg>
  );
  if (scene === 'food') return (
    <svg viewBox="0 0 90 160" preserveAspectRatio={fit} style={style} aria-hidden="true">
      <defs><linearGradient id={`${id}d`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#3b2a1d" /><stop offset=".5" stopColor="#a8683a" /><stop offset="1" stopColor="#1d130d" /></linearGradient></defs>
      <rect width="90" height="160" fill={`url(#${id}d)`} />
      {[[20, 26, 10, '#ffe2a8', 0.4], [52, 18, 7, '#fff3d6', 0.45], [74, 40, 12, '#ffc46b', 0.35], [8, 58, 8, '#ffd9a0', 0.3], [40, 48, 5, '#ffffff', 0.4]].map(([x, y, r, c, o]) =>
        <circle key={`${x}`} cx={x} cy={y} r={r} fill={c as string} fillOpacity={(o as number) * 0.7} />)}
      <path d="M0 124h90v36H0Z" fill="#120c08" />
      <ellipse cx="45" cy="118" rx="22" ry="7" fill="#f1e7d8" /><ellipse cx="45" cy="116" rx="16" ry="4.5" fill="#b8442a" />
    </svg>
  );
  return (
    <svg viewBox="0 0 90 160" preserveAspectRatio={fit} style={style} aria-hidden="true">
      <defs><linearGradient id={`${id}n`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#0b1524" /><stop offset=".55" stopColor="#182a44" /><stop offset="1" stopColor="#090c13" /></linearGradient></defs>
      <rect width="90" height="160" fill={`url(#${id}n)`} />
      {[[14, 30, 9, '#ffb36b', 0.35], [34, 22, 6, '#6fd3ff', 0.3], [58, 34, 11, '#ff7a59', 0.3], [78, 24, 7, '#ffd9a0', 0.4], [70, 58, 9, '#8fa8ff', 0.28], [10, 66, 7, '#6fd3ff', 0.25], [26, 52, 5, '#ffd9a0', 0.45], [84, 82, 8, '#ffb36b', 0.3]].map(([x, y, r, c, o]) =>
        <circle key={`${x}-${y}`} cx={x} cy={y} r={r} fill={c as string} fillOpacity={(o as number) * 0.7} stroke={c as string} strokeOpacity={Math.min(1, (o as number) * 1.5)} strokeWidth=".5" />)}
      <path d="M12 160C12 130 26 119 45 119s33 11 33 41Z" fill="#07090d" /><rect x="39" y="104" width="12" height="18" fill="#0a0c11" /><ellipse cx="45" cy="92" rx="13.5" ry="16.5" fill="#0b0d12" />
      <path d="M57.5 82q4 10-.5 21" fill="none" stroke="#ffb070" strokeWidth="1.1" strokeLinecap="round" />
    </svg>
  );
}

/** Peaks of a short piece of music, for a waveform. */
export const PEAKS = Array.from({ length: 120 }, (_, i) => 0.25 + 0.55 * Math.abs(Math.sin(i * 0.37) * Math.cos(i * 0.11)) + (i % 8 === 0 ? 0.2 : 0));
