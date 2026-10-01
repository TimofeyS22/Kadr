import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createProject } from './defaults';
import { MOODS, fitTrack, licenseText, withoutGuides, type MusicManifest } from './music';

const dir = join(import.meta.dirname, '..', '..', 'public', 'music');
const lib = JSON.parse(readFileSync(join(dir, 'music.json'), 'utf8')) as MusicManifest;

describe('music library manifest', () => {
  it('every track is CC0 with proof, present on disk and sane', () => {
    expect(lib.tracks.length).toBeGreaterThanOrEqual(40);
    expect(new Set(lib.tracks.map((t) => t.id)).size).toBe(lib.tracks.length);
    for (const t of lib.tracks) {
      expect(t.license, t.id).toMatch(/^CC0 1\.0/);
      expect(t.licenseUrl).toBe('https://creativecommons.org/publicdomain/zero/1.0/');
      expect(t.source, t.id).toMatch(/^https:\/\/freemusicarchive\.org\/music\//);
      expect(MOODS).toContain(t.mood);
      expect(t.duration).toBeGreaterThanOrEqual(90);
      expect(t.duration).toBeLessThanOrEqual(300);
      const file = join(dir, t.file);
      expect(existsSync(file), t.file).toBe(true);
      expect(statSync(file).size).toBe(t.bytes);
      if (t.bpm !== undefined) {
        expect(t.bpm).toBeGreaterThan(50);
        expect(t.bpm).toBeLessThan(220);
        expect(t.beats!.every((b, i) => b >= 0 && b <= t.duration && (i === 0 || b > t.beats![i - 1]))).toBe(true);
      }
    }
  });
  it('covers every mood evenly', () => {
    for (const m of MOODS) expect(lib.tracks.filter((t) => t.mood === m).length, m).toBeGreaterThanOrEqual(5);
  });
});

describe('music helpers', () => {
  it('fits a track under the video with a fade, or keeps a shorter track whole', () => {
    expect(fitTrack(180, 30)).toEqual({ duration: 30, fadeOut: 2 });
    expect(fitTrack(120, 0)).toEqual({ duration: 120, fadeOut: 2 });
    expect(fitTrack(4, 30)).toEqual({ duration: 4, fadeOut: 1 });
  });
  it('removes only guide clips from what gets exported', () => {
    const p = createProject('m', '9:16');
    const base = { start: 0, duration: 5, in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0, assetId: 'a' };
    p.tracks.push({ id: 'au', kind: 'audio', clips: [{ ...base, kind: 'audio', id: 'g', guide: true }, { ...base, kind: 'audio', id: 'k', start: 6 }] });
    const out = withoutGuides(p);
    expect(out.tracks.find((t) => t.id === 'au')!.clips.map((c) => c.id)).toEqual(['k']);
    expect(p.tracks.find((t) => t.id === 'au')!.clips).toHaveLength(2); // pure
    expect(withoutGuides(out)).toBe(out);
  });
  it('license text names the work, the license and the proof', () => {
    expect(licenseText({ title: 'T', artist: 'A', license: 'CC0 1.0 Universal', licenseUrl: 'L', source: 'S' })).toBe('"T" by A. License: CC0 1.0 Universal — L. Source: S');
  });
});
