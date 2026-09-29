import type { Anim, Easing, Keyframe } from './types';

/** Two keyframes closer than this are the same keyframe (≈ half a frame at 60 fps). */
export const KEY_EPS = 1 / 120;

export function ease(e: Easing | undefined, x: number): number {
  switch (e) {
    case 'in': return x * x;
    case 'out': return 1 - (1 - x) * (1 - x);
    case 'inOut': return x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x);
    case 'hold': return 0;
    default: return x;
  }
}

export const hasKeys = (a: Anim): boolean => !!a.k && a.k.length > 0;

export function evalAnim(a: Anim, t: number): number {
  const k = a.k;
  if (!k || k.length === 0) return a.v;
  if (t <= k[0].t) return k[0].v;
  const last = k[k.length - 1];
  if (t >= last.t) return last.v;
  let i = 0;
  while (i < k.length - 2 && k[i + 1].t <= t) i++;
  const k0 = k[i], k1 = k[i + 1];
  return k0.v + (k1.v - k0.v) * ease(k0.e, (t - k0.t) / (k1.t - k0.t));
}

export function keyIndexAt(a: Anim, t: number): number {
  return a.k ? a.k.findIndex((k) => Math.abs(k.t - t) < KEY_EPS) : -1;
}

function insertKey(a: Anim, key: Keyframe): void {
  a.k = [...(a.k ?? []).filter((k) => Math.abs(k.t - key.t) >= KEY_EPS), key].sort((p, q) => p.t - q.t);
}

/** Set the value at clip time `t`: writes a keyframe when the property is animated, else the static value. */
export function setAnim(a: Anim, t: number, v: number): void {
  if (!hasKeys(a)) { a.v = v; return; }
  const i = keyIndexAt(a, t);
  if (i >= 0) a.k![i].v = v;
  else insertKey(a, { t, v });
}

/** Adds a keyframe at `t` holding the current value, or removes the one there. Returns true if added. */
export function toggleKey(a: Anim, t: number): boolean {
  const i = keyIndexAt(a, t);
  if (i >= 0) {
    a.v = a.k![i].v;
    a.k!.splice(i, 1);
    if (a.k!.length === 0) delete a.k;
    return false;
  }
  const v = evalAnim(a, t);
  insertKey(a, { t, v });
  a.v = v;
  return true;
}

/** Splits an animation at clip time `at` into [left, right]; right's times are rebased to 0. */
export function splitAnim(a: Anim, at: number): [Anim, Anim] {
  if (!hasKeys(a)) return [{ v: a.v }, { v: a.v }];
  const mid = evalAnim(a, at);
  const k = a.k!;
  const left = k.filter((x) => x.t < at - KEY_EPS);
  const right = k.filter((x) => x.t > at + KEY_EPS).map((x) => ({ ...x, t: x.t - at }));
  return [
    { v: a.v, k: [...left, { t: at, v: mid }] },
    { v: a.v, k: [{ t: 0, v: mid }, ...right] },
  ];
}

export function mapAnimTime(a: Anim, fn: (t: number) => number): void {
  if (a.k) for (const k of a.k) k.t = fn(k.t);
}
