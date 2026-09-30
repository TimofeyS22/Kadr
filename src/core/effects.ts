// Video effects: transform effects are computed here, pixel effects in the compositor shader. Everything is a
// pure function of the clip, its local time and the amount, so preview and export are identical (ADR 17).
import type { EffectId } from './types';

export interface EffectDef { id: EffectId; name: string; /** Shader effect code; 0 = transform-only. */ code: number }

export const EFFECTS: EffectDef[] = [
  { id: 'glitch', name: 'Glitch', code: 1 },
  { id: 'shake', name: 'Shake', code: 0 },
  { id: 'zoomPunch', name: 'Zoom punch', code: 0 },
  { id: 'vhs', name: 'VHS', code: 2 },
  { id: 'blur', name: 'Blur', code: 3 },
  { id: 'rgbSplit', name: 'RGB split', code: 4 },
];

export const effectCode = (id: EffectId): number => EFFECTS.find((e) => e.id === id)?.code ?? 0;

/** Stable 0..1 seed from a clip id. */
export function seedOf(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

const hash = (n: number) => { const x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };
/** Smooth value noise in -1..1. */
function noise(t: number, seed: number): number {
  const i = Math.floor(t), f = t - i, u = f * f * (3 - 2 * f);
  return (hash(i + seed * 1000) * (1 - u) + hash(i + 1 + seed * 1000) * u) * 2 - 1;
}

/** Camera shake: position offset (canvas fractions) and rotation (degrees). */
export function shake(t: number, amount: number, seed: number): { dx: number; dy: number; rot: number } {
  const f = 9; // shakes per second
  return {
    dx: noise(t * f, seed) * 0.025 * amount,
    dy: noise(t * f, seed + 0.37) * 0.025 * amount,
    rot: noise(t * f * 0.7, seed + 0.71) * 2 * amount,
  };
}

/** Zoom punch: a quick zoom-in that settles, twice per second (120 BPM feel). */
export function punchScale(t: number, amount: number): number {
  const phase = ((t % 0.5) + 0.5) % 0.5;
  return 1 + 0.18 * amount * Math.exp(-phase / 0.09);
}
