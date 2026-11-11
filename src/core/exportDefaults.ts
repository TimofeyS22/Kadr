// What an export starts with, before anything is picked in the sheet (audit V-216). The start used to be two constants,
// 30 fps and 1080p: a 60 fps video lost every second frame and a 720p one was blown up to 1080p, both without a word.
// Now the file has what the video has, as far as this device's encoder goes; less or more only by a choice in the sheet,
// and the sheet says what such a choice costs (`exportCost`).
import type { Project } from './types';

/** Videos from this rate up are exported at 60: 50 fps cameras too, 60 being the nearest rate the sheet offers. */
const FAST_FPS = 50;
/** A video whose frame rate nobody measured (a project from before it was) is exported as this, as it always was. */
const UNKNOWN_FPS = 30;
/** The frame rate a new project is given: untouched, it is nobody's choice and the videos decide. */
const PROJECT_FPS = 30;
/**
 * The largest size an export starts at, unless a larger one was picked at an earlier export (owner, 2026-11-11). On an
 * iPhone 15 30 s of 4K60 took 48 s and 154 MB, against 22 s and 31 MB at 1080p60, and Reels, TikTok and Shorts show
 * 1080p anyway. 4K is a tap away in the sheet. A project without video (photos, text) starts here too.
 */
const START_MOST = 1080;

export interface ExportSource {
  /** The highest frame rate among the videos, as the timeline plays them; null when none of them has a measured one. */
  fps: number | null;
  /** The largest short side the file can have before the biggest of the videos is enlarged. */
  side: number;
}

/**
 * The videos of the main track as an export sees them; null without any. Overlays and photos do not count: an overlay
 * covers a part of the picture, and a photo has many times the pixels of any size offered.
 *
 * A video fits inside the canvas (scale 1), so a landscape 720p video in a 9:16 project is 1280 wide only in a file
 * 1280 wide: its size is measured along the side it touches, not by its own short side. Zoom and crop are not
 * followed. A slowed video shows fewer of its frames a second and counts as that; a sped up one drops frames by
 * design and counts as it was shot.
 */
export function exportSource(p: Project): ExportSource | null {
  const { width, height } = p.settings;
  let fps: number | null = null, side = 0;
  for (const c of p.tracks.find((t) => t.kind === 'main')?.clips ?? []) {
    const a = c.kind === 'video' ? p.assets[c.assetId] : undefined;
    if (c.kind !== 'video' || !a) continue;
    side = Math.max(side, Math.min(width, height) * Math.max(a.width / width, a.height / height));
    if (typeof a.fps !== 'number' || !(a.fps > 0) || !Number.isFinite(a.fps)) continue;
    const speed = c.speed * (c.curve?.length ? Math.max(...c.curve) : 1); // the fastest stretch of a speed ramp
    fps = Math.max(fps ?? 0, a.fps * Math.min(1, speed));
  }
  return side > 0 ? { fps, side: Math.round(side) } : null;
}

/** A video of the project has 50 fps or more: 60 is worth asking the encoder about. */
export const isFast = (source: ExportSource | null): boolean => (source?.fps ?? UNKNOWN_FPS) >= FAST_FPS;

/** The frame rate somebody set for the project: any but the one it was created with, or that one picked on purpose. */
const projectFps = (p: Project): number | null => (p.settings.fpsSet === true || p.settings.fps !== PROJECT_FPS ? p.settings.fps : null);

/**
 * The size and frame rate an export starts with. `sizes` are the short sides this device encodes, smallest first;
 * `sizes60` those of them it encodes at 60 fps (asked, not assumed: see `supportedResolutions`).
 *
 * Size: the largest that does not enlarge the video, up to 1080p (`START_MOST`); when every size would enlarge it, the
 * smallest.
 *
 * `picked` is a size chosen by hand at an earlier export, and it differs from a choice made in the open sheet. In the
 * sheet any size can be taken, a larger one too, and the sheet says what it costs. Remembered, it takes the place of
 * 1080p as the most an export starts at, but never enlarges a video: 1080p picked for one video does not blow up a 720p
 * one exported in one tap, where nobody sees the sheet, and 4K picked once is where the next 4K video starts.
 *
 * Frame rate: the project's own when somebody set it. Otherwise 60 when a video has 50 or more and the encoder takes
 * the size at 60; else 30. Several videos: the fastest decides, so that none of them loses frames.
 */
export function exportDefaults<R extends number>(p: Project, sizes: readonly R[], sizes60: readonly R[], picked?: R): { resolution: R | undefined; fps: number } {
  const source = exportSource(p);
  const most = Math.min(picked ?? START_MOST, source?.side ?? Infinity);
  const resolution = sizes.filter((r) => r <= most).at(-1) ?? sizes[0];
  const fast = isFast(source) && resolution !== undefined && sizes60.includes(resolution);
  return { resolution, fps: projectFps(p) ?? (fast ? 60 : PROJECT_FPS) };
}

export interface ExportCost {
  /** Frames of the video are dropped: its rate, and whether it is every second one. */
  frames?: { from: number; half: boolean };
  /** The video can be 60 fps in the file, but not at this size on this device. */
  no60: boolean;
  /** The file is larger than the video: more bytes, no more detail. */
  larger: boolean;
}

/** What the chosen size and frame rate cost against the videos. A rate nobody measured is not talked about. */
export function exportCost(source: ExportSource | null, resolution: number, fps: number, sizes60: readonly number[] | null): ExportCost {
  const from = source?.fps ?? null;
  const lost = from !== null && fps < from - 0.5; // 29.97 at 30 loses nothing
  return {
    ...(lost ? { frames: { from: Math.round(from), half: Math.abs(from / fps - 2) < 0.05 } } : {}),
    no60: lost && from >= FAST_FPS && fps < FAST_FPS && sizes60 !== null && !sizes60.includes(resolution),
    larger: !!source && resolution > source.side,
  };
}

/** Megabits a second of a video file at each size, standard quality; high quality ×1.5, more than 30 fps ×1.4. */
export const QUALITY_MBPS: Record<number, number> = { 720: 5, 1080: 10, 1440: 18, 2160: 35 };

/** The file's size in MB, as the sheet says it before the export. */
export function estimateMb(resolution: number, fps: number, quality: 'standard' | 'high', durationS: number): number {
  return ((QUALITY_MBPS[resolution] ?? QUALITY_MBPS[1080]) * (quality === 'high' ? 1.5 : 1) * (fps > 30 ? 1.4 : 1) * durationS) / 8;
}

/** Longer than this, one tap does not start the export: the sheet first says how big the file is and how long it takes (S-1-5). */
export const LONG_EXPORT_S = 20 * 60;

/**
 * Before an export: what the person is told first (S-1-5). A ten-hour video started by one tap with no word of its size
 * or time; on a phone it would end with no file. `long`: past LONG_EXPORT_S. `room`: the file may not fit in what the
 * browser says is free (`freeMb` null: it does not say). Either way the export waits for the person's tap; nothing is
 * refused on an estimate.
 */
export function exportNotes(durationS: number, mb: number, freeMb: number | null): { long: boolean; room: boolean } {
  return { long: durationS > LONG_EXPORT_S, room: freeMb !== null && mb > freeMb };
}
