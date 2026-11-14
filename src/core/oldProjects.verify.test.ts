// Verifier E1 (docs/21 §5; docs/16 N10, CapCut I2 "worse after an update"): a project saved by an earlier version opens
// with every clip and is drawn the same. The archive in oldProjects/ was made by each version's own src/core (commit in
// the file): one project with a cut, a trimmed piece, 2× speed, a photo and a text over the video and music, and what
// buildFrame drew at every second frame. The generator is oldProjects/README-gen.test.ts.txt: put it in an old checkout
// as src/core/zz-archive.gen.test.ts and run it with ARCHIVE_OUT and ARCHIVE_VERSION set.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildFrame, type Layer } from './frame';
import { normalizeProject, projectDuration } from './timeline';
import type { Project } from './types';

interface Archived { version: string; commit: string; duration: number; project: Project; times: number[]; frames: string[][] }

const DIR = join(import.meta.dirname, 'oldProjects');
const archive: Archived[] = readdirSync(DIR).filter((f) => f.endsWith('.json')).sort()
  .map((f) => JSON.parse(readFileSync(join(DIR, f), 'utf8')) as Archived);

/** What a layer shows and where: the same reduction the old versions wrote. */
function sig(l: Layer): string {
  const s = l.source as { kind: string; assetId?: string; time?: number; clip?: { text?: string }; chars?: number };
  const what = s.kind === 'video' ? `${s.assetId}@${(s.time ?? 0).toFixed(3)}` : s.kind === 'image' ? s.assetId : s.kind === 'text' ? `${s.clip?.text}/${s.chars}` : '';
  return `${s.kind}:${what} x${l.x.toFixed(3)} y${l.y.toFixed(3)} s${l.scale.toFixed(3)} r${l.rotation.toFixed(2)} o${l.opacity.toFixed(3)}`;
}

const clips = (p: Project) => p.tracks.reduce((n, t) => n + t.clips.length, 0);

describe('a project from an earlier version opens and is drawn the same (N10, C-I2)', () => {
  it('the archive holds projects of several versions', () => {
    expect(archive.map((a) => a.version)).toEqual(expect.arrayContaining(['v0.5', 'v1.0.0', 'v1.8.0']));
  });

  for (const a of archive) {
    it(`${a.version} (${a.commit}): every clip, the same length, the same picture at every frame`, () => {
      const p = structuredClone(a.project);
      normalizeProject(p); // what the editor does when it opens a project
      expect(clips(p), 'no clip lost on opening').toBe(clips(a.project));
      expect(projectDuration(p)).toBeCloseTo(a.duration, 6);
      expect(a.times.length, 'the archive covers the whole project').toBeGreaterThan(a.duration * 14);
      const wrong: string[] = [];
      a.times.forEach((t, i) => {
        const got = buildFrame(p, t).layers.map(sig);
        if (JSON.stringify(got) !== JSON.stringify(a.frames[i])) wrong.push(`${t.toFixed(3)} s: now [${got.join('; ')}], was [${a.frames[i].join('; ')}]`);
      });
      expect(wrong.slice(0, 3), `${wrong.length} of ${a.times.length} frames differ`).toEqual([]);
    });
  }
});
