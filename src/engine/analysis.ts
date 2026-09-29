// Sound analysis on device: beat grid of a music asset.
import { estimateBeats, onsetEnvelope, type BeatGrid } from '../core/beats';
import type { AudioClip, Project } from '../core/types';
import { renderAudioWindow } from './audio';
import { MediaError, MediaPool } from './media';

const SR = 48000;
const HOP_S = 0.01;

export async function detectBeats(p: Project, assetId: string, onProgress: (f: number) => void, signal: AbortSignal): Promise<BeatGrid | null> {
  const src = p.assets[assetId];
  if (!src?.hasAudio) throw new MediaError('This clip has no sound');
  const clip: AudioClip = { kind: 'audio', id: '__beats', assetId, start: 0, duration: src.duration, in: 0, speed: 1, volume: 1, muted: false, fadeIn: 0, fadeOut: 0 };
  const solo: Project = { ...p, tracks: [{ id: '__t', kind: 'audio', clips: [clip] }] };
  const pool = new MediaPool(16);
  const hop = Math.round(SR * HOP_S);
  const energy = new Float32Array(Math.ceil(src.duration / HOP_S));
  try {
    const total = Math.round(src.duration * SR);
    for (let i = 0; i < total; i += SR * 20) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const j = Math.min(total, i + SR * 20);
      const buf = await renderAudioWindow(solo, pool, i / SR, j / SR, SR);
      const l = buf.getChannelData(0), r = buf.getChannelData(1);
      for (let k = 0; k + hop <= l.length; k += hop) {
        let e = 0;
        for (let m = k; m < k + hop; m++) { const v = (l[m] + r[m]) / 2; e += v * v; }
        const idx = Math.round((i + k) / hop);
        if (idx < energy.length) energy[idx] = e / hop;
      }
      onProgress(j / total);
    }
  } finally {
    pool.dispose();
  }
  return estimateBeats(onsetEnvelope(energy), HOP_S, src.duration);
}
