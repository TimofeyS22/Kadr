import { ADJUST_KEYS, type AdjustKey, type Adjustments, type FilterRef } from './types';

export interface FilterPreset { id: string; name: string; a: Partial<Adjustments> }

export const FILTERS: FilterPreset[] = [
  { id: 'vivid', name: 'Vivid', a: { saturation: 0.35, contrast: 0.12 } },
  { id: 'punch', name: 'Punch', a: { contrast: 0.35, saturation: 0.25, sharpen: 0.4, vignette: 0.3 } },
  { id: 'warm', name: 'Warm', a: { temperature: 0.45, saturation: 0.1 } },
  { id: 'cool', name: 'Cool', a: { temperature: -0.45, tint: 0.05 } },
  { id: 'teal', name: 'Teal/Orange', a: { temperature: 0.2, tint: -0.15, saturation: 0.2, contrast: 0.15, highlights: -0.1 } },
  { id: 'film', name: 'Film', a: { fade: 0.35, temperature: 0.15, grain: 0.35, saturation: -0.1 } },
  { id: 'retro', name: 'Retro', a: { temperature: 0.35, fade: 0.3, grain: 0.5, saturation: -0.25, vignette: 0.4 } },
  { id: 'faded', name: 'Faded', a: { fade: 0.6, contrast: -0.15, saturation: -0.2 } },
  { id: 'dream', name: 'Dream', a: { exposure: 0.15, highlights: 0.3, fade: 0.25, saturation: 0.1 } },
  { id: 'night', name: 'Night', a: { temperature: -0.6, exposure: -0.25, saturation: -0.3 } },
  { id: 'mono', name: 'Mono', a: { saturation: -1, contrast: 0.15 } },
  { id: 'noir', name: 'Noir', a: { saturation: -1, contrast: 0.45, vignette: 0.6, exposure: -0.1 } },
  // v1.5: the looks short videos use most (adjustment sets, so preview = export through the same shader).
  { id: 'golden', name: 'Golden hour', a: { temperature: 0.55, exposure: 0.08, highlights: -0.2, saturation: 0.15, vignette: 0.2 } },
  { id: 'cinematic', name: 'Cinematic', a: { contrast: 0.25, saturation: -0.15, temperature: -0.1, tint: -0.08, shadows: -0.15, vignette: 0.45 } },
  { id: 'moody', name: 'Moody', a: { exposure: -0.15, contrast: 0.3, saturation: -0.35, shadows: -0.2, vignette: 0.5 } },
  { id: 'pastel', name: 'Pastel', a: { exposure: 0.12, fade: 0.4, contrast: -0.2, saturation: -0.1, tint: 0.06 } },
  { id: 'vintage', name: 'Vintage', a: { temperature: 0.3, tint: 0.05, fade: 0.45, saturation: -0.35, grain: 0.45, vignette: 0.35 } },
  { id: 'sepia', name: 'Sepia', a: { saturation: -0.85, temperature: 0.7, contrast: 0.1, fade: 0.15 } },
  { id: 'highKey', name: 'High key', a: { exposure: 0.3, highlights: 0.2, contrast: -0.2, saturation: -0.1 } },
  { id: 'matte', name: 'Matte', a: { fade: 0.5, contrast: -0.1, saturation: -0.05, shadows: 0.15 } },
  { id: 'summer', name: 'Summer', a: { saturation: 0.4, temperature: 0.3, exposure: 0.08, contrast: 0.1 } },
  { id: 'winter', name: 'Winter', a: { temperature: -0.5, saturation: -0.2, exposure: 0.12, highlights: 0.1 } },
  { id: 'clarity', name: 'Clarity', a: { contrast: 0.2, sharpen: 0.7, shadows: 0.2, highlights: -0.15 } },
  { id: 'cyber', name: 'Cyber', a: { tint: 0.35, temperature: -0.35, saturation: 0.35, contrast: 0.25 } },
];

const UNSIGNED: ReadonlySet<AdjustKey> = new Set(['fade', 'vignette', 'sharpen', 'grain']);

export const adjustRange = (k: AdjustKey): [number, number] => (UNSIGNED.has(k) ? [0, 1] : [-1, 1]);

/** Final adjustments = manual adjustments + preset × intensity, clamped to each key's range. */
export function resolveAdjust(adjust: Adjustments, filter: FilterRef | null): Adjustments {
  const preset = filter ? FILTERS.find((f) => f.id === filter.id) : undefined;
  if (!preset || !filter) return adjust;
  const out = { ...adjust };
  for (const k of ADJUST_KEYS) {
    const [lo, hi] = adjustRange(k);
    out[k] = Math.min(hi, Math.max(lo, adjust[k] + (preset.a[k] ?? 0) * filter.intensity));
  }
  return out;
}

export const isNeutral = (a: Adjustments): boolean => ADJUST_KEYS.every((k) => a[k] === 0);
