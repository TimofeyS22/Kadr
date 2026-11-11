// Music library (docs/05 M1): manifest types and pure helpers.
import { clipEnd, mainTrack, r6 } from './timeline';
import type { AudioClip, Project, TextClip } from './types';

export const MOODS = ['lofi', 'energetic', 'phonk', 'cinematic', 'calm', 'happy', 'game', 'electronic'] as const;
export type Mood = (typeof MOODS)[number];

export interface LibraryTrack {
  id: string; title: string; artist: string; album: string; mood: Mood;
  duration: number; file: string; bytes: number;
  bpm?: number; beats?: number[];
  license: string; licenseUrl: string; source: string; verified: string;
}
export interface MusicManifest { version: number; tracks: LibraryTrack[] }

export const FADE_OUT_S = 2;

/** A library track under a video of `videoS` seconds: cut to the video's length with a fade, or whole if shorter. */
export function fitTrack(trackS: number, videoS: number): { duration: number; fadeOut: number } {
  if (videoS <= 0 || trackS <= videoS) return { duration: trackS, fadeOut: Math.min(FADE_OUT_S, trackS / 4) };
  return { duration: videoS, fadeOut: Math.min(FADE_OUT_S, videoS / 4) };
}

/** Less of the video than this left after the playhead: a clip put there keeps its own length (an end card, a last line). */
export const MIN_FIT_S = 1;

/**
 * A sound or a text put on top of a video ends with the video (S-1-4), as a library track does (`fitTrack`). Added at
 * the playhead at their full length, a 20 s song on a 4 s clip made a 20 s file of black, and a title near the end
 * added black after it. Nothing changes when the clip already ends in time, when less than MIN_FIT_S of video is left
 * after its start, or when the project has no video yet. A sound cut this way fades out like a fitted track. Returns
 * the seconds left out (0: unchanged); the clip's edge drags it longer again.
 */
export function endWithVideo(p: Project, c: AudioClip | TextClip): number {
  const videoEnd = mainTrack(p).clips.reduce((m, x) => Math.max(m, clipEnd(x)), 0);
  const room = videoEnd - c.start;
  if (room < MIN_FIT_S || clipEnd(c) <= videoEnd + 1e-6) return 0;
  const cut = r6(c.duration - room);
  c.duration = r6(room);
  if (c.kind === 'audio') c.fadeOut = Math.max(c.fadeOut, Math.min(FADE_OUT_S, room / 4));
  return cut;
}

/** Text a creator can paste into a Content ID dispute or a video description. */
export function licenseText(t: Pick<LibraryTrack, 'title' | 'artist' | 'license' | 'licenseUrl' | 'source'>): string {
  return `"${t.title}" by ${t.artist}. License: ${t.license} — ${t.licenseUrl}. Source: ${t.source}`;
}

/** The project without guide tracks: what gets exported (guides only play while editing). */
export function withoutGuides(p: Project): Project {
  if (!p.tracks.some((t) => t.clips.some((c) => (c.kind === 'audio' || c.kind === 'video') && c.guide))) return p;
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !((c.kind === 'audio' || c.kind === 'video') && c.guide)) })) };
}
