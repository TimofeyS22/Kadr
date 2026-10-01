// Music library (docs/05 M1): manifest types and pure helpers.
import type { Project } from './types';

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

/** Text a creator can paste into a Content ID dispute or a video description. */
export function licenseText(t: Pick<LibraryTrack, 'title' | 'artist' | 'license' | 'licenseUrl' | 'source'>): string {
  return `"${t.title}" by ${t.artist}. License: ${t.license} — ${t.licenseUrl}. Source: ${t.source}`;
}

/** The project without guide tracks: what gets exported (guides only play while editing). */
export function withoutGuides(p: Project): Project {
  if (!p.tracks.some((t) => t.clips.some((c) => (c.kind === 'audio' || c.kind === 'video') && c.guide))) return p;
  return { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !((c.kind === 'audio' || c.kind === 'video') && c.guide)) })) };
}
