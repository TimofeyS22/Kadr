// A short file made of a sound's packets, copied as they are, for the browser's own decoder (sound.ts).
import {
  EncodedAudioPacketSource, Mp3OutputFormat, Mp4OutputFormat, OggOutputFormat, Output, WavOutputFormat, WebMOutputFormat,
  type AudioCodec, type EncodedPacket, type OutputFormat,
} from 'mediabunny';
import { MemoryTarget } from './memTarget';

export const CONTAINERS: (() => OutputFormat)[] = [
  () => new Mp4OutputFormat({ fastStart: 'in-memory' }), () => new WebMOutputFormat(), () => new OggOutputFormat(),
  () => new Mp3OutputFormat(), () => new WavOutputFormat(),
];

export async function packetsAsFile(format: OutputFormat, codec: AudioCodec, decoderConfig: AudioDecoderConfig, list: EncodedPacket[], base: number): Promise<ArrayBuffer> {
  const output = new Output({ format, target: new MemoryTarget() });
  const source = new EncodedAudioPacketSource(codec);
  output.addAudioTrack(source);
  await output.start();
  for (const [k, q] of list.entries()) await source.add(q.clone({ timestamp: q.timestamp - base }), k === 0 ? { decoderConfig } : undefined);
  source.close();
  await output.finalize();
  return output.target.buffer();
}
