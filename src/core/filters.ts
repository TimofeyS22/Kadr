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
