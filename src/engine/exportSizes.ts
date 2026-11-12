// What the export sheet shows before anything is encoded. Apart from exporter.ts, so the editor opens without the code that
// writes files (audit V-143).
import { canEncodeVideo } from 'mediabunny';
import type { ProjectSettings } from '../core/types';

export type Resolution = 720 | 1080 | 1440 | 2160;
export const MAX_GIF_S = 30;
/** A GIF's frame rate: smooth enough to read as motion, small enough to share. */
export const GIF_FPS = 12;
/**
 * How long GIF frame `i` stays, in ms. A GIF counts in hundredths of a second: one delay for all, 1000 / 12 ms, was
 * written as 8 hundredths, 12.5 frames a second, and the GIF ran 4% faster than the preview (6 s of video in 5.76 s).
 * Delays of 8, 9, 8 … start frame i at i / GIF_FPS to the hundredth.
 */
export const gifDelayMs = (i: number): number => (Math.round(((i + 1) * 100) / GIF_FPS) - Math.round((i * 100) / GIF_FPS)) * 10;
const GIF_SIDE = 480;

const even = (x: number) => Math.max(2, Math.round(x / 2) * 2);

export function outputSize(s: ProjectSettings, resolution: Resolution): [number, number] {
  const k = resolution / Math.min(s.width, s.height);
  return [even(s.width * k), even(s.height * k)];
}

/**
 * Resolutions this device can encode for the project (checked once per export sheet open). With `frameRate`, those it
 * can encode at that rate: an encoder has a ceiling of pixels a second, so a size it takes at 30 fps is not promised
 * at 60, and a 60 fps export is offered by default only where the encoder said yes (audit V-216).
 */
export async function supportedResolutions(s: ProjectSettings, frameRate?: number): Promise<Resolution[]> {
  const all: Resolution[] = [720, 1080, 1440, 2160];
  const ok = await Promise.all(all.map(async (r) => {
    const [width, height] = outputSize(s, r);
    return (await canEncodeVideo('avc', { width, height, frameRate })) || (await canEncodeVideo('vp9', { width, height, frameRate }));
  }));
  return all.filter((_, i) => ok[i]);
}

export const gifSize = (s: ProjectSettings): [number, number] => {
  const k = GIF_SIDE / Math.max(s.width, s.height);
  return [even(s.width * k), even(s.height * k)];
};
