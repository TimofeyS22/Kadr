// Reverse: re-encodes the used part of a clip backwards (frames and sound) into a new asset.
// Frames are decoded in short windows from the end so memory stays bounded on phones.
import {
  ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, CanvasSink, CanvasSource, Input,
  Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, getFirstEncodableAudioCodec, getFirstEncodableVideoCodec,
  type WrappedCanvas,
} from 'mediabunny';
import type { Asset, Project, VideoClip } from '../core/types';
import { getBlob } from '../storage/db';
import { importFile } from './importer';
import { MediaError } from './media';

export const MAX_REVERSE_S = 60;
const WINDOW_S = 0.5;
const MAX_DIM = 1280;

export async function reverseClipSource(p: Project, clip: VideoClip, onProgress: (f: number) => void, signal: AbortSignal): Promise<Asset> {
  const asset = p.assets[clip.assetId];
  const blob = await getBlob(clip.assetId);
  if (!asset || !blob) throw new MediaError('Media file is missing from this device');
  const s0 = clip.in;
  const s1 = Math.min(asset.duration, clip.in + clip.duration * clip.speed);
  if (s1 - s0 > MAX_REVERSE_S) throw new MediaError('Reverse works on clips up to {n} s. Split the clip first.', { n: MAX_REVERSE_S });
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(blob) });
  try {
    const video = await input.getPrimaryVideoTrack();
    if (!video) throw new MediaError('No video in this clip');
    const audio = asset.hasAudio ? await input.getPrimaryAudioTrack() : null;
    const dw = await video.getDisplayWidth(), dh = await video.getDisplayHeight();
    const k = Math.min(1, MAX_DIM / Math.max(dw, dh));
    const width = Math.round((dw * k) / 2) * 2, height = Math.round((dh * k) / 2) * 2;
    const fps = Math.min(60, Math.max(1, Math.round((await video.computePacketStats(60)).averagePacketRate) || 30));
    const vCodec = await getFirstEncodableVideoCodec(['avc', 'vp9'], { width, height });
    if (!vCodec) throw new MediaError('This browser cannot encode video');
    const mp4 = vCodec === 'avc';
    const aCodec = audio ? await getFirstEncodableAudioCodec(mp4 ? ['aac', 'opus'] : ['opus']) : null;
    const output = new Output({ format: mp4 ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    const vSource = new CanvasSource(canvas, { codec: vCodec, bitrate: QUALITY_HIGH });
    output.addVideoTrack(vSource, { frameRate: fps });
    const aSource = aCodec ? new AudioBufferSource({ codec: aCodec, bitrate: QUALITY_HIGH }) : null;
    if (aSource) output.addAudioTrack(aSource);
    await output.start();

    if (audio && aSource) {
      // Sound: collect the range (≤ 60 s), reverse it, add it in one-second chunks.
      const parts = [];
      for await (const wb of new AudioBufferSink(audio).buffers(s0, s1)) parts.push(wb);
      if (parts.length) {
        const sr = parts[0].buffer.sampleRate, ch = Math.min(2, parts[0].buffer.numberOfChannels);
        const len = Math.round((s1 - s0) * sr);
        const data = Array.from({ length: ch }, () => new Float32Array(len));
        for (const { buffer: b, timestamp } of parts) {
          const pos = Math.round((timestamp - s0) * sr); // buffers may start before the range
          for (let c = 0; c < ch; c++) {
            const src = b.getChannelData(Math.min(c, b.numberOfChannels - 1));
            const from = Math.max(0, -pos), to = Math.min(src.length, len - pos);
            if (to > from) data[c].set(src.subarray(from, to), pos + from);
          }
        }
        for (const d of data) d.reverse();
        for (let i = 0; i < len; i += sr) {
          const n = Math.min(sr, len - i);
          const chunk = new AudioBuffer({ length: n, numberOfChannels: ch, sampleRate: sr });
          data.forEach((d, c) => chunk.copyToChannel(d.subarray(i, i + n), c));
          await aSource.add(chunk);
        }
      }
    }

    const sink = new CanvasSink(video, { width, height, fit: 'contain' });
    const frameDur = 1 / fps;
    for (let end = s1; end > s0 + 1e-6; end -= WINDOW_S) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const start = Math.max(s0, end - WINDOW_S);
      const frames: WrappedCanvas[] = [];
      for await (const f of sink.canvases(start, end)) if (f.timestamp < end - 1e-6 && (f.timestamp >= start - 1e-6 || start <= s0)) frames.push(f);
      for (const f of frames.reverse()) {
        const t = Math.max(0, s1 - Math.max(s0, f.timestamp) - frameDur);
        ctx.drawImage(f.canvas, 0, 0);
        await vSource.add(t, frameDur);
      }
      onProgress((s1 - start) / (s1 - s0));
    }
    vSource.close();
    aSource?.close();
    await output.finalize();
    const type = mp4 ? 'video/mp4' : 'video/webm';
    return await importFile(new Blob([output.target.buffer!], { type }), `${asset.name.replace(/\.[^.]+$/, '')} (reversed).${mp4 ? 'mp4' : 'webm'}`);
  } finally {
    input.dispose();
  }
}
