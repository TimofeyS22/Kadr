// Auto-reframe: find where the person is in a wide clip (MediaPipe mask centroid) every few frames.
import { maskCentroid, type SubjectSample } from '../core/reframe';
import { sourceTime } from '../core/timeline';
import type { VideoClip } from '../core/types';
import { MediaPool } from './media';
import { personMask } from './segment';

const STEP_S = 0.4;

export async function trackSubject(clip: VideoClip, onProgress: (f: number) => void, signal: AbortSignal): Promise<SubjectSample[]> {
  const pool = new MediaPool(384); // small frames are plenty for finding a person, and fast
  const out: SubjectSample[] = [];
  try {
    const n = Math.max(1, Math.ceil(clip.duration / STEP_S));
    for (let i = 0; i <= n; i++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const t = Math.min(clip.duration - 0.01, i * STEP_S);
      const f = await pool.frame('__reframe', clip.assetId, sourceTime(clip, clip.start + t));
      const mask = f ? await personMask(`reframe:${clip.assetId}:${f.timestamp}`, f.canvas) : null;
      out.push({ t, u: mask ? maskCentroid(mask.data, mask.w, mask.h) : null });
      onProgress(i / n);
    }
  } finally {
    pool.dispose();
  }
  return out;
}
