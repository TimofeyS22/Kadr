// Why a video does not go in, said truthfully (S-1-8, S-1-9). WebKit refused an 8K H.264 file and an H.264 4:4:4 one
// with "This browser cannot decode avc video. Try Chrome or Safari.": the codec was fine (it plays ordinary H.264), the
// size or the profile was not, and on an iPhone every browser is Safari's engine. A 2×2 video went in, then every frame
// failed with "the device's decoder stopped, close other apps", which no closing of apps would change.

/** Ordinary settings of each codec: a browser that cannot decode these cannot decode the codec at all. */
export const PLAIN_CONFIG: Record<string, string> = { avc: 'avc1.42E01E', hevc: 'hvc1.1.6.L93.B0', vp9: 'vp09.00.10.08', av1: 'av01.0.04M.08', vp8: 'vp8' };

/** Smaller than this on a side, a video is refused: below one 16×16 macroblock a phone's decoder may give no frame. */
export const MIN_VIDEO_SIDE = 16;

export interface Refusal { message: string; vars?: Record<string, string | number> }

/** A video too small to decode on a phone, or nothing to say. */
export function tooSmall(width: number, height: number): Refusal | null {
  if (width >= MIN_VIDEO_SIDE && height >= MIN_VIDEO_SIDE) return null;
  return { message: 'This video is too small to play: {width}×{height} pixels. Kadr plays videos from {min}×{min} pixels.', vars: { width, height, min: MIN_VIDEO_SIDE } };
}

/**
 * What a video the decoder says no to is told. `codecWorks`: the same codec in its ordinary settings decodes here, so
 * it is this file's size or profile. `ios`: every browser on the device is Safari's engine, another one would not help.
 */
export function cannotDecode(v: { codec: string; width: number; height: number; codecWorks: boolean; ios: boolean }): Refusal {
  if (v.codecWorks) return { message: 'This device cannot play this video: {width}×{height}, {codec}, is beyond what it decodes. Videos from a phone camera play, up to 4K.', vars: { width: v.width, height: v.height, codec: v.codec } };
  // The advice is about HEVC: for a file that is already H.264 it sent people to a setting that changes nothing (audit V-199).
  if (v.codec === 'hevc') return { message: 'This browser cannot decode {codec} video. On iPhone, set Camera → Formats → Most Compatible.', vars: { codec: v.codec } };
  return v.ios ? { message: 'This iPhone cannot decode {codec} video.', vars: { codec: v.codec } } : { message: 'This browser cannot decode {codec} video. Try Chrome or Safari.', vars: { codec: v.codec } };
}
