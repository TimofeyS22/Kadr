// Encoder delay (found in v1.2 by the A/V sync e2e): AAC encoders put "priming" samples ahead of the sound — 2112 on
// Apple's, about 44 ms — and our MP4s carry no edit list, so every decoder plays them. Every export ran ~44 ms behind
// its picture, and every processed sound (noise reduction, natural pitch, voice effects) added another 44 ms.
// The delay is measured once per codec and channel count: a burst is encoded and decoded the way the app plays
// sound (AudioBufferSink, by timestamp), and that many samples are then dropped before encoding.
import { ALL_FORMATS, AudioBufferSink, AudioBufferSource, BlobSource, BufferTarget, Input, Mp4OutputFormat, Output, QUALITY_HIGH, WebMOutputFormat, type AudioCodec } from 'mediabunny';

const measured = new Map<string, Promise<number>>();

/** Samples an encode with this codec puts ahead of the sound (0 when it puts none, or the measure fails). */
export function encoderDelay(codec: AudioCodec, channels: number, sampleRate: number): Promise<number> {
  const key = `${codec}:${channels}:${sampleRate}`;
  let d = measured.get(key);
  if (!d) {
    d = measure(codec, channels, sampleRate).catch((e: unknown) => { console.warn('encoder delay not measured, assuming 0', e); return 0; });
    measured.set(key, d);
  }
  return d;
}

async function measure(codec: AudioCodec, channels: number, sr: number): Promise<number> {
  const len = sr, on = Math.round(0.3 * sr), f = 1000;
  const x = new Float32Array(len);
  for (let i = on; i < on + 0.1 * sr; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * f * (i - on)) / sr);
  const output = new Output({ format: codec === 'aac' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat(), target: new BufferTarget() });
  const source = new AudioBufferSource({ codec, bitrate: QUALITY_HIGH });
  output.addAudioTrack(source);
  await output.start();
  const buf = new AudioBuffer({ length: len, numberOfChannels: channels, sampleRate: sr });
  for (let c = 0; c < channels; c++) buf.copyToChannel(x, c);
  await source.add(buf);
  source.close();
  await output.finalize();
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(new Blob([output.target.buffer!])) });
  try {
    const track = await input.getPrimaryAudioTrack();
    if (!track) return 0;
    const heard = new Float32Array(2 * len);
    for await (const { buffer, timestamp } of new AudioBufferSink(track).buffers()) {
      const at = Math.round(timestamp * sr), d = buffer.getChannelData(0);
      for (let k = 0; k < d.length; k++) if (at + k >= 0 && at + k < heard.length) heard[at + k] = d[k];
    }
    const found = heard.findIndex((v) => Math.abs(v) > 0.05);
    const crossing = Math.ceil(Math.asin(0.1) / ((2 * Math.PI * f) / sr)); // where the burst itself passes 0.05
    return found < 0 ? 0 : Math.max(0, found - (on + crossing));
  } finally {
    input.dispose();
  }
}
