// Sound decoding that survives the browser refusing a track (v1.3.1).
// Chromium's AudioDecoder.isConfigSupported() does not look at the track's description, so a track can pass
// canDecode() and still fail in configure() ("Unsupported configuration…"): the owner's captions died on it.
// Every sound is decoded with WebCodecs first; when the browser refuses, the rest of it is decoded by the
// browser's own media stack (decodeAudioData) in short windows, so memory stays bounded on a phone.
import {
  AudioBufferSink, BufferTarget, EncodedAudioPacketSource, EncodedPacketSink, Mp3OutputFormat, Mp4OutputFormat,
  OggOutputFormat, Output, WavOutputFormat, WebMOutputFormat,
  type EncodedPacket, type InputAudioTrack, type Input, type OutputFormat, type WrappedAudioBuffer,
} from 'mediabunny';

export interface SoundSink {
  buffers(start?: number, end?: number): AsyncGenerator<WrappedAudioBuffer, void, unknown>;
}

const isAbort = (e: unknown) => (e as Error | undefined)?.name === 'AbortError';

/** Tracks whose WebCodecs decoder failed: decoded natively from then on (per opened file). */
const refused = new WeakSet<InputAudioTrack>();

/** Encoded window decoded at once: long enough to keep remuxing cheap, short enough for a phone's memory. */
const WINDOW_S = 10;
/** Packets before the window, so the decoder's overlap is warm at the window start. */
const PREROLL_S = 0.1;
/** Size of the buffers handed out (one AudioBufferSourceNode each in the preview). */
const SLICE_S = 2;

const CONTAINERS: (() => OutputFormat)[] = [
  () => new Mp4OutputFormat({ fastStart: 'in-memory' }), () => new WebMOutputFormat(), () => new OggOutputFormat(),
  () => new Mp3OutputFormat(), () => new WavOutputFormat(),
];

/** Decodes a track through decodeAudioData: its packets, window by window, are copied (not re-encoded) into a small file. */
export class NativeSink implements SoundSink {
  private packets: EncodedPacketSink;
  /** Index into CONTAINERS of the container this browser decodes for this codec (found on first use). */
  private container = -1;

  constructor(private track: InputAudioTrack) {
    this.packets = new EncodedPacketSink(track);
  }

  async *buffers(start = 0, end = Infinity): AsyncGenerator<WrappedAudioBuffer, void, unknown> {
    end = Math.min(end, await this.track.computeDuration());
    for (let w0 = start; w0 < end; w0 += WINDOW_S) {
      const w1 = Math.min(end, w0 + WINDOW_S);
      const got = await this.decode(w0 - PREROLL_S, w1);
      if (!got) continue;
      const { buffer: whole, timestamp } = got;
      const sr = whole.sampleRate;
      for (let t = Math.max(w0, timestamp); t < w1 - 1e-6; t += SLICE_S) {
        const i0 = Math.round((t - timestamp) * sr);
        const i1 = Math.min(whole.length, Math.round((Math.min(w1, t + SLICE_S) - timestamp) * sr));
        if (i1 <= i0) break;
        const buffer = new AudioBuffer({ length: i1 - i0, numberOfChannels: whole.numberOfChannels, sampleRate: sr });
        for (let c = 0; c < whole.numberOfChannels; c++) buffer.copyToChannel(whole.getChannelData(c).subarray(i0, i1), c);
        yield { buffer, timestamp: timestamp + i0 / sr, duration: (i1 - i0) / sr };
      }
    }
  }

  /** The sound from t0 to t1 and the source time of its first sample, or null when nothing decodes. */
  private async decode(t0: number, t1: number): Promise<{ buffer: AudioBuffer; timestamp: number } | null> {
    const list: EncodedPacket[] = [];
    let p = (await this.packets.getPacket(t0)) ?? (await this.packets.getFirstPacket());
    while (p && p.timestamp < t1) {
      if (p.timestamp + p.duration > t0) list.push(p);
      p = await this.packets.getNextPacket(p);
    }
    if (!list.length) return null;
    const codec = await this.track.getCodec();
    const decoderConfig = await this.track.getDecoderConfig();
    if (!codec || !decoderConfig) return null;
    const base = list[0].timestamp;
    const expected = list[list.length - 1].timestamp + list[list.length - 1].duration - base;
    const ctx = new OfflineAudioContext(1, 1, decoderConfig.sampleRate);
    const tries = this.container >= 0 ? [this.container] : CONTAINERS.map((_, i) => i);
    let lastError: unknown = null;
    for (const i of tries) {
      const format = CONTAINERS[i]();
      if (!format.getSupportedAudioCodecs().includes(codec)) continue;
      try {
        const output = new Output({ format, target: new BufferTarget() });
        const source = new EncodedAudioPacketSource(codec);
        output.addAudioTrack(source);
        await output.start();
        for (const [k, q] of list.entries()) await source.add(q.clone({ timestamp: q.timestamp - base }), k === 0 ? { decoderConfig } : undefined);
        source.close();
        await output.finalize();
        const buffer = await ctx.decodeAudioData(output.target.buffer!);
        this.container = i;
        // A decoder that trims its priming returns less than the packets hold: the cut is at the start.
        return { buffer, timestamp: base + Math.max(0, expected - buffer.duration) };
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError ?? new Error(`No container for ${codec}`);
  }
}

/** WebCodecs first; if the browser refuses the track, the rest of the range comes from NativeSink. */
export class ResilientSink implements SoundSink {
  constructor(private track: InputAudioTrack) {}

  async *buffers(start = 0, end = Infinity): AsyncGenerator<WrappedAudioBuffer, void, unknown> {
    let from = start;
    if (!refused.has(this.track)) {
      try {
        for await (const b of new AudioBufferSink(this.track).buffers(start, end)) {
          yield b;
          from = b.timestamp + b.duration;
        }
        return;
      } catch (e) {
        if (isAbort(e)) throw e;
        refused.add(this.track);
        console.warn('The browser refused to decode this sound with WebCodecs; decoding it natively', e);
      }
    }
    yield* new NativeSink(this.track).buffers(from, end);
  }
}

async function decodesFirst(sink: SoundSink, how: string, onFail?: (reason: string) => void): Promise<boolean> {
  try {
    for await (const b of sink.buffers()) { void b; return true; }
  } catch (e) {
    // Refused at configure or decode time: logged, and handed to the caller so the message can say why.
    console.warn(`An audio track does not decode with ${how}`, e);
    onFail?.(`${how}: ${e instanceof Error ? e.message : String(e)}`);
  }
  return false;
}

/**
 * The audio track this browser can really decode. iPhone 16+ videos carry a 4-channel spatial (APAC) track next to
 * the stereo AAC one, in either order and with one of them disabled. So: enabled tracks first, then stereo or mono,
 * then file order — and the first one whose first packet actually decodes, with WebCodecs or, failing that, natively.
 */
export async function playableAudioTrack(input: Input, onFail?: (reason: string) => void): Promise<InputAudioTrack | null> {
  const ranked = await input.getAudioTracks({
    sortBy: async (t) => [(await t.getDisposition()).default === false ? 1 : 0, (await t.getNumberOfChannels()) > 2 ? 1 : 0],
  });
  for (const track of ranked) {
    if (refused.has(track)) continue;
    if (await decodesFirst(new AudioBufferSink(track), 'WebCodecs', onFail)) return track;
    refused.add(track);
  }
  for (const track of ranked) if (await decodesFirst(new NativeSink(track), 'decodeAudioData', onFail)) return track;
  return null;
}
