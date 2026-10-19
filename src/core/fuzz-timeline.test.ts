// QA (docs/11 §3.5): property-based check of the timeline operations. Seeded random sequences of edits, edge values
// included (cut at a clip's very edge, trims far past the source, speeds outside the range), and after every single
// edit the invariants every other module relies on. A failure prints the seed and the steps to replay it.
import { describe, expect, it } from 'vitest';
import { createAudioClip, createImageClip, createProject, createTextClip, createVideoClip } from './defaults';
import {
  MAX_STILL, MIN_CLIP, MIN_TRANSITION, clipEnd, deleteClip, duplicateClip, insertMain, isMedia, isVisual, mainTrack,
  moveClip, placeClip, projectDuration, reorderMain, setSpeed, setTransition, sourceSpan, splitClip, trimClip,
} from './timeline';
import type { Asset, Clip, Project } from './types';

function rng(seed: number) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 2 ** 32; };
}

const asset = (id: string, kind: Asset['kind'], duration: number): Asset =>
  ({ id, kind, name: id, mime: '', size: 1, duration, width: kind === 'audio' ? 0 : 1280, height: kind === 'audio' ? 0 : 720, hasAudio: kind !== 'image' });

const EDGE = [0, MIN_CLIP, MIN_CLIP * 0.99, 1e-7, -1e-7];

/** Every invariant, as a list of what is wrong (empty when the project is sound). */
function problems(p: Project): string[] {
  const out: string[] = [];
  const mains = p.tracks.filter((t) => t.kind === 'main');
  if (mains.length !== 1) out.push(`${mains.length} main tracks`);
  for (const t of p.tracks) {
    if (t.kind !== 'main' && !t.clips.length) out.push(`empty ${t.kind} track`);
    for (const c of t.clips) {
      const tag = `${t.kind}/${c.kind} ${c.id}`;
      if (!Number.isFinite(c.start) || c.start < -1e-9) out.push(`${tag}: start ${c.start}`);
      if (!Number.isFinite(c.duration) || c.duration < MIN_CLIP - 1e-6) out.push(`${tag}: duration ${c.duration}`);
      if (isMedia(c)) {
        const a = p.assets[c.assetId];
        if (!(c.speed >= 0.1 && c.speed <= 10)) out.push(`${tag}: speed ${c.speed}`);
        if (!Number.isFinite(c.in) || c.in < -1e-9) out.push(`${tag}: in ${c.in}`);
        if (a && c.in + sourceSpan(c) > a.duration + 1e-3) out.push(`${tag}: plays ${c.in + sourceSpan(c)} s of a ${a.duration} s source`);
      } else if (c.duration > MAX_STILL + 1e-6) out.push(`${tag}: still of ${c.duration} s`);
    }
    if (t.kind === 'main') {
      t.clips.forEach((c, i) => {
        const prev = t.clips[i - 1];
        const overlap = isVisual(c) && c.transitionIn ? c.transitionIn.duration : 0;
        const want = prev ? clipEnd(prev) - overlap : 0;
        if (Math.abs(c.start - want) > 1e-5) out.push(`main ${i}: starts ${c.start}, expected ${want}`);
        if (overlap && (overlap < MIN_TRANSITION - 1e-6 || !prev || overlap > Math.min(prev.duration, c.duration) / 2 + 1e-6)) out.push(`main ${i}: transition ${overlap}`);
      });
    } else {
      for (let i = 1; i < t.clips.length; i++) {
        if (t.clips[i].start < t.clips[i - 1].start) out.push(`${t.kind}: unsorted`);
        if (clipEnd(t.clips[i - 1]) > t.clips[i].start + 1e-6) out.push(`${t.kind}: ${t.clips[i - 1].id} overlaps ${t.clips[i].id}`);
      }
    }
  }
  if (!Number.isFinite(projectDuration(p))) out.push(`duration ${projectDuration(p)}`);
  return out;
}

export function run(seed: number, steps: number, trace = false): { log: string[]; bad: string[] } {
  const r = rng(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
  const p = createProject('fuzz', '9:16', 0);
  const v = asset('v', 'video', 8), img = asset('img', 'image', 0), aud = asset('aud', 'audio', 20);
  p.assets = { v, img, aud };
  insertMain(p, createVideoClip(v), 0);
  insertMain(p, createImageClip(img), 99);
  placeClip(p, createAudioClip(aud));
  placeClip(p, createTextClip(1));
  const log: string[] = [];
  const all = (): Clip[] => p.tracks.flatMap((t) => t.clips);
  const num = () => (r() < 0.25 ? pick(EDGE) : r() < 0.15 ? pick([-1e6, 1e6, -5, 50]) : r() * 20 - 2);
  for (let s = 0; s < steps; s++) {
    const clips = all();
    const c = clips.length ? pick(clips) : null;
    const op = Math.floor(r() * 11);
    if (!c && op < 9) continue;
    let what = '';
    switch (op) {
      case 0: { const t = r() < 0.3 ? pick([c!.start, clipEnd(c!), c!.start + MIN_CLIP, clipEnd(c!) - MIN_CLIP * 0.5]) : c!.start + r() * c!.duration; what = `split ${c!.id} @${t}`; splitClip(p, c!.id, t); break; }
      case 1: { const t = c!.start + num(); what = `trim start ${c!.id} → ${t}`; trimClip(p, c!.id, 'start', t); break; }
      case 2: { const t = clipEnd(c!) + num(); what = `trim end ${c!.id} → ${t}`; trimClip(p, c!.id, 'end', t); break; }
      case 3: { const sp = pick([0.1, 0.25, 0.5, 2, 4, 10, 0.05, 20, 1 + r() * 3]); what = `speed ${c!.id} ×${sp}`; setSpeed(p, c!.id, sp); break; }
      case 4: { const d = pick([0.05, 0.1, 0.5, 1, 3, 30]); what = `transition ${c!.id} ${d}`; setTransition(p, c!.id, { type: 'fade', duration: d }); break; }
      case 5: what = `duplicate ${c!.id}`; duplicateClip(p, c!.id); break;
      case 6: what = `delete ${c!.id}`; deleteClip(p, c!.id); break;
      case 7: { const st = num() * 3; what = `move ${c!.id} → ${st}`; moveClip(p, c!.id, st); break; }
      case 8: { const i = Math.floor(r() * 8) - 2; what = `reorder ${c!.id} → ${i}`; reorderMain(p, c!.id, i); break; }
      case 9: { const t = num(); const k = r() < 0.5 ? createVideoClip(v) : createImageClip(img); what = `insert ${k.kind} @${t}`; insertMain(p, k, t); break; }
      default: { const k = r() < 0.5 ? createAudioClip(aud, Math.max(0, num())) : createTextClip(Math.max(0, num())); what = `place ${k.kind} @${k.start}`; placeClip(p, k); }
    }
    log.push(what);
    if (trace) console.log(what, '\n  ', mainTrack(p).clips.map((x) => `${x.id}:${x.kind} s${x.start} d${x.duration}${isMedia(x) ? ` in${x.in} sp${x.speed}` : ''}${isVisual(x) && x.transitionIn ? ` tr${x.transitionIn.duration}` : ''}`).join(' | '));
    const bad = problems(p);
    if (bad.length) return { log, bad };
  }
  return { log, bad: [] };
}

it.skipIf(!process.env.FUZZ_TRACE)('trace', () => { run(Number(process.env.FUZZ_TRACE), 60, true); });
it.skipIf(!process.env.FUZZ_SUMMARY)('summary of the first failure per seed, grouped', () => {
  const groups = new Map<string, { n: number; ex: string }>();
  for (let seed = 1; seed <= Number(process.env.FUZZ_SUMMARY); seed++) {
    const { log, bad } = run(seed, 60);
    if (!bad.length) continue;
    const op = (log.at(-1) ?? '').split(' ').slice(0, 2).join(' ');
    const key = `${op.replace(/ [a-z0-9]{9}$/, '')} ⇒ ${bad[0].replace(/[a-z0-9]{9}/g, 'X').replace(/-?[\d.]+(e-?\d+)?/g, 'N')}`;
    const g = groups.get(key) ?? { n: 0, ex: `seed ${seed}: ${log.slice(-2).join(' / ')} → ${bad[0]}` };
    g.n++; groups.set(key, g);
  }
  console.log([...groups].sort((a, b) => b[1].n - a[1].n).map(([k, g]) => `${g.n}x ${k}\n    ${g.ex}`).join('\n'));
});

describe('timeline operations keep the project sound under any sequence of edits (fuzz, docs/11 §3.5)', () => {
  it('300 seeded sequences × 60 edits, edge values included', () => {
    for (let seed = 1; seed <= 300; seed++) {
      const { log, bad } = run(seed, 60);
      if (bad.length) expect.fail(`seed ${seed}, after:\n${log.slice(-6).join('\n')}\n→ ${bad.join('; ')}`);
    }
  });
});

it('×10 on the last 0.46 s of a video lowers the speed so the 0.1 s piece still ends inside the source (fuzz seed 15)', () => {
  const p = createProject('t', '9:16', 0);
  const v = asset('v', 'video', 8);
  p.assets = { v };
  const c = createVideoClip(v);
  insertMain(p, c, 0);
  const tail = splitClip(p, c.id, 7.54)!;
  setSpeed(p, tail, 10);
  const t = mainTrack(p).clips[1];
  expect(t.kind === 'video' && t.in + sourceSpan(t)).toBeLessThanOrEqual(8 + 1e-6);
  expect(t.duration).toBeGreaterThanOrEqual(MIN_CLIP - 1e-6);
  expect(t.kind === 'video' && t.speed).toBeCloseTo(4.6, 5);
});
