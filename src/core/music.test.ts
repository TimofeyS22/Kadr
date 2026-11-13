import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createAudioClip, createProject, createTextClip, createVideoClip } from './defaults';
import { FADE_OUT_S, MIN_FIT_S, MOODS, endWithVideo, fitTrack, licenseText, withoutGuides, type MusicManifest } from './music';
import { projectDuration } from './timeline';
import type { Asset } from './types';

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
      // As a person writes it: «Orchid (LoFi, Nostalgic)», not «Orchid ( LoFi , Nostalgic )» (L5, 2026-11-13).
      expect(t.title, t.id).toBe(t.title.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+([),])/g, '$1').trim());
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

describe('a sound or a text put on a video ends with it (S-1-4)', () => {
  const video: Asset = { id: 'v', kind: 'video', name: 'v.mp4', mime: 'video/mp4', size: 1, duration: 4.2, width: 720, height: 1280, hasAudio: true };
  const song: Asset = { id: 's', kind: 'audio', name: 's.mp3', mime: 'audio/mpeg', size: 1, duration: 20, width: 0, height: 0, hasAudio: true };
  const withVideo = () => { const p = createProject('P', '9:16'); p.tracks[0].clips.push(createVideoClip(video, 0)); return p; };

  it('a 20 s song on a 4.2 s video ends with the video and fades out; the file is as long as the video', () => {
    const p = withVideo();
    const c = createAudioClip(song, 0);
    expect(endWithVideo(p, c)).toBeCloseTo(15.8, 6);
    expect(c.duration).toBeCloseTo(4.2, 6);
    expect(c.fadeOut).toBeCloseTo(Math.min(FADE_OUT_S, 4.2 / 4), 6);
    p.tracks.push({ id: 'a', kind: 'audio', clips: [c] });
    expect(projectDuration(p)).toBeCloseTo(4.2, 6);
  });

  it('from the playhead: what is left of the video', () => {
    const p = withVideo();
    const c = createAudioClip(song, 1.5);
    endWithVideo(p, c);
    expect(c.start + c.duration).toBeCloseTo(4.2, 6);
  });

  it('a title near the end ends with the video; with less than MIN_FIT_S left it keeps its length', () => {
    const p = withVideo();
    const t = createTextClip(2);
    endWithVideo(p, t);
    expect(t.start + t.duration).toBeCloseTo(4.2, 6);
    const end = createTextClip(4.2 - MIN_FIT_S / 2);
    expect(endWithVideo(p, end)).toBe(0);
    expect(end.duration).toBe(3);
  });

  it('changes nothing that already ends in time, or where there is no video yet', () => {
    const p = withVideo();
    const short = createAudioClip({ ...song, duration: 3 }, 0);
    expect(endWithVideo(p, short)).toBe(0);
    expect([short.duration, short.fadeOut]).toEqual([3, 0]);
    const empty = createProject('E', '9:16');
    const c = createAudioClip(song, 0);
    expect(endWithVideo(empty, c)).toBe(0);
    expect(c.duration).toBe(20);
  });
});
