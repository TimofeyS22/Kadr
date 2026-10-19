// The MP4 colour tag must say the sample range the encoder really wrote (v1.4.3, docs/11 QA). WebKit's encoder
// (VideoToolbox) writes video-range H.264 but reports a full-range colour space, which the muxer copies into the
// file: QuickTime, Photos and ffmpeg then lift every black to grey (a dark frame measured 26 → 38 of 255).
import type { EncodedPacket } from 'mediabunny';
import { avcFullRange } from '../core/avc';

/** `onEncodedPacket` for every video source: the tag follows the stream's SPS before the muxer sees it. */
export function matchStreamRange(_packet: EncodedPacket, meta?: EncodedVideoChunkMetadata): void {
  const d = meta?.decoderConfig;
  if (!d?.codec.startsWith('avc') || !d.description || !d.colorSpace) return;
  const desc = d.description;
  const bytes = ArrayBuffer.isView(desc) ? new Uint8Array(desc.buffer, desc.byteOffset, desc.byteLength) : new Uint8Array(desc);
  const full = avcFullRange(bytes);
  if (full !== null && d.colorSpace.fullRange !== full) d.colorSpace = { ...d.colorSpace, fullRange: full };
}
