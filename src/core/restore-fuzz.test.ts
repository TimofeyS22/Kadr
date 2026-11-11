// A backup is a file from outside (docs/11 §3.15): whatever one value of its project.json says, the restored project
// opens and draws (S-1-3). Every value of a project that uses every part of the model is replaced, one at a time, by
// what a damaged or made-up file may hold; the project is repaired as a restore does, and every frame of it is built.
// Before S-1-3 a caption whose words held a null passed the checks and took the editor down at every opening.
import { describe, expect, it } from 'vitest';
import { createAudioClip, createCaptionClip, createImageClip, createProject, createTextClip, createVideoClip } from './defaults';
import { CAPTION_PRESETS } from './presets';
import { buildFrame, type Layer } from './frame';
import { repairBackup } from './restore';
import { normalizeProject, projectDuration, sourceTime } from './timeline';
import type { Asset, CaptionClip, MediaClip, Project, TextClip, TextStyle } from './types';

const video: Asset = { id: 'v1', kind: 'video', name: 'v.mp4', mime: 'video/mp4', size: 10, duration: 8, width: 1920, height: 1080, hasAudio: true, fps: 30, codec: 'avc', beats: { bpm: 120, times: [0.5, 1, 1.5] }, derived: { denoise: 'a1', pitch: { '2': 'a1' } } };
const photo: Asset = { id: 'p1', kind: 'image', name: 'p.png', mime: 'image/png', size: 1, duration: 0, width: 100, height: 100, hasAudio: false };
const sound: Asset = { id: 'a1', kind: 'audio', name: 's.m4a', mime: 'audio/mp4', size: 1, duration: 10, width: 0, height: 0, hasAudio: true };

/** A project that uses every part of the model a restore must accept. */
function whole(): Project {
  const p = createProject('Whole', '9:16', 1);
  Object.assign(p.assets, { v1: video, p1: photo, a1: sound });
  const v = createVideoClip(video, 0);
  v.duration = 4;
  v.transform.x = { v: 0, k: [{ t: 0, v: -0.2 }, { t: 2, v: 0.2, e: 'inOut' }] };
  Object.assign(v, {
    curve: [1, 2, 1], crop: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }, effect: { id: 'glitch', amount: 0.5 }, filter: { id: 'warm', intensity: 0.7 },
    mask: { shape: 'circle', x: 0.5, y: 0.5, w: 0.5, h: 0.5, rotation: 0, feather: 0.1, roundness: 0, invert: false },
    privacy: { faces: true, style: 'blur', areas: [{ x: { v: 0.5 }, y: { v: 0.4, k: [{ t: 0, v: 0.4 }, { t: 1, v: 0.5 }] }, w: 0.2, h: 0.2 }] },
    audioAssetId: 'a1', audioKey: 'denoise', denoise: true, duck: 0.5, flipX: true, reversedFrom: { assetId: 'v1', in: 0 },
  });
  const img = createImageClip(photo, 4, 3);
  img.transitionIn = { type: 'fade', duration: 0.5 };
  const text = createTextClip(1, 'Привет');
  text.loop = { type: 'pulse', period: 1 };
  text.animIn = { type: 'pop', duration: 0.4 };
  Object.assign(text.style, {
    stroke: { color: '#000', width: 0.1 }, background: { color: '#fff', opacity: 0.5, padding: 0.2, lines: true, radius: 0.3 },
    outline2: { color: '#f00', width: 0.05 }, copies: [{ color: '#0f0', x: 0.05, y: 0.05, depth: true }], gradient: '#00f', uppercase: true, letterSpacing: 0.1, lineHeight: 1.2,
  } satisfies Partial<TextStyle>);
  const cap = createCaptionClip([{ t0: 0.2, t1: 0.6, text: 'раз' }, { t0: 0.7, t1: 1.1, text: 'два', cue: 1 }, { t0: 1.2, t1: 1.8, text: 'три.' }], CAPTION_PRESETS[0]);
  Object.assign(cap, { emphasis: 'box', motion: 'pop', reveal: true, lowerStart: true, highlight: '#ff0' } satisfies Partial<CaptionClip>);
  const music = createAudioClip(sound, 0);
  music.duration = 7;
  p.tracks[0].clips.push(v, img);
  p.tracks.push({ id: 'o1', kind: 'overlay', clips: [text, cap] }, { id: 'm1', kind: 'audio', clips: [music], muted: false });
  return p;
}

/** What a damaged or made-up file may hold where a value was. */
const JUNK: unknown[] = [null, 'x', -1, 0, 1e9, true, [], {}, [null], [{}], { v: 'x' }];

/** Every path to a value inside the tracks and assets. */
function paths(x: unknown, at: (string | number)[] = []): (string | number)[][] {
  if (x === null || typeof x !== 'object') return [at];
  const keys = Array.isArray(x) ? x.map((_, i) => i) : Object.keys(x);
  return [at, ...keys.flatMap((k) => paths((x as Record<string | number, unknown>)[k], [...at, k]))];
}
function set(root: Record<string, unknown>, path: (string | number)[], v: unknown) {
  let o = root as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) o = o[k] as Record<string | number, unknown>;
  o[path[path.length - 1]] = v;
}

const finite = (n: unknown) => typeof n === 'number' && Number.isFinite(n);
/** The shape of a text style the canvas drawing reads, from types.ts. */
function styleOk(s: TextStyle): boolean {
  const colorW = (o: unknown) => o === null || (typeof o === 'object' && typeof (o as { color: unknown }).color === 'string' && finite((o as { width: unknown }).width));
  return typeof s.font === 'string' && finite(s.size) && typeof s.color === 'string' && [400, 700, 900].includes(s.weight) && typeof s.italic === 'boolean'
    && ['left', 'center', 'right'].includes(s.align) && colorW(s.stroke) && typeof s.shadow === 'boolean'
    && (s.background === null || (typeof s.background === 'object' && typeof s.background.color === 'string' && finite(s.background.opacity)))
    && (s.outline2 === undefined || colorW(s.outline2))
    && (s.copies === undefined || (Array.isArray(s.copies) && s.copies.every((c) => c && typeof c.color === 'string' && finite(c.x) && finite(c.y))))
    && (s.letterSpacing === undefined || finite(s.letterSpacing)) && (s.lineHeight === undefined || finite(s.lineHeight))
    && (s.gradient === undefined || typeof s.gradient === 'string') && (s.shadowColor === undefined || typeof s.shadowColor === 'string');
}

/** What must hold for any restored project: it draws, every number it draws with is a number. */
function drawable(p: Project): string | null {
  const d = projectDuration(p);
  if (!finite(d)) return `duration ${d}`;
  for (const t of p.tracks) for (const c of t.clips) {
    if ((c.kind === 'video' || c.kind === 'audio') && !finite(sourceTime(c as MediaClip, c.start + c.duration / 2))) return `source time of ${c.id}`;
    if ((c.kind === 'text' || c.kind === 'caption') && !styleOk((c as TextClip).style)) return `style of ${c.id}`;
  }
  for (let i = 0; i <= 20; i++) {
    let layers: Layer[];
    try { layers = buildFrame(p, (d * i) / 20).layers; } catch (e) { return `frame at ${((d * i) / 20).toFixed(2)} s: ${(e as Error).message}`; }
    for (const l of layers) {
      for (const k of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) if (!finite(l[k])) return `${k} of ${l.id} is ${l[k]}`;
      // Everything else the compositor hands to the GPU, as numbers it can use.
      const nums: [string, unknown][] = [
        ...Object.entries(l.adjust ?? {}),
        ...(l.crop ? Object.entries(l.crop) : []),
        ...(l.mask ? (['x', 'y', 'w', 'h', 'rotation', 'feather', 'roundness'] as const).map((k) => [`mask.${k}`, l.mask![k]] as [string, unknown]) : []),
        ...(l.chroma ? [['chroma.similarity', l.chroma.similarity], ['chroma.smoothness', l.chroma.smoothness]] as [string, unknown][] : []),
        ...(l.fx ? [['fx.amount', l.fx.amount], ['fx.time', l.fx.time]] as [string, unknown][] : []),
        ...(l.privacy ? l.privacy.areas.flat().map((v, i) => [`privacy.${i}`, v] as [string, unknown]) : []),
      ];
      for (const [k, v] of nums) if (!finite(v)) return `${k} of ${l.id} is ${JSON.stringify(v)}`;
      if (l.mask && !['circle', 'rect', 'linear'].includes(l.mask.shape)) return `mask shape of ${l.id}`;
      if (l.chroma && typeof l.chroma.color !== 'string') return `chroma colour of ${l.id}`;
      if (!['normal', 'screen', 'multiply', 'add'].includes(l.blend)) return `blend of ${l.id}`;
    }
  }
  return null;
}

describe('a restored backup always opens and draws (S-1-3)', () => {
  it('the whole project is kept as it is and draws', () => {
    const p = whole(), before = JSON.stringify(p);
    expect(repairBackup(p)).toBe(0);
    expect(JSON.stringify(p)).toBe(before);
    normalizeProject(p);
    expect(drawable(p)).toBeNull();
  });

  it('any one value of the tracks and the media replaced by junk', async () => {
    const base = whole();
    const failures: string[] = [];
    let runs = 0;
    for (const root of ['tracks', 'assets'] as const) {
      for (const path of paths(base[root]).filter((x) => x.length > 0)) {
        for (const junk of JUNK) {
          const p = structuredClone(base) as unknown as Record<string, unknown>;
          set(p[root] as Record<string, unknown>, path, structuredClone(junk));
          runs++;
          try {
            repairBackup(p as unknown as Project);
            normalizeProject(p as unknown as Project);
            const why = drawable(p as unknown as Project);
            if (why) failures.push(`${root}.${path.join('.')} = ${JSON.stringify(junk)}: ${why}`);
          } catch (e) {
            failures.push(`${root}.${path.join('.')} = ${JSON.stringify(junk)}: repair threw ${(e as Error).message}`);
          }
        }
      }
    }
    expect(runs).toBeGreaterThan(3000);
    if (process.env.FUZZ_DUMP) (await import('node:fs')).writeFileSync(process.env.FUZZ_DUMP, failures.join('\n'));
    expect(failures.slice(0, 25), `${failures.length} of ${runs} damaged projects do not draw`).toEqual([]);
  }, 120_000);
});
