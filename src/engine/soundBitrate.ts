// How many bits a second the sound of a file gets (Q-31, lead's decision). The exports and processed sounds asked the
// encoder for its "high" quality: WebKit's AAC then wrote ~76 kbit/s of stereo whatever rate it was asked for
// (64k, 128k, 160k and 192k all came out the same), Chromium's 149 for 192 asked. Thin for music, and the coarser the
// encoding the higher it lifts the peaks a limiter held (and mono came out at 65). Now 128 kbit/s for mono and 160 for
// stereo at a constant rate, which WebKit keeps to the kbit; Chromium (macOS) takes the mode and ignores it, writing by
// the sound: 129 for live speech under music, 163 for dense noise. Its own "high" where the encoder takes no such rate.
import { QUALITY_HIGH, Quality, canEncodeAudio, type AudioCodec } from 'mediabunny';

/** The rate asked for first: mono, stereo. */
export const SOUND_BPS = { mono: 128_000, stereo: 160_000 } as const;

const chosen = new Map<string, Promise<Quality>>();

/** The quality a sound of this codec and shape is encoded at; the same for every encode, the encoder-delay probe too. */
export function soundQuality(codec: AudioCodec, numberOfChannels: number, sampleRate: number): Promise<Quality> {
  const key = `${codec}:${numberOfChannels}:${sampleRate}`;
  let q = chosen.get(key);
  if (!q) chosen.set(key, (q = choose(codec, numberOfChannels, sampleRate)));
  return q;
}

async function choose(codec: AudioCodec, numberOfChannels: number, sampleRate: number): Promise<Quality> {
  const want = numberOfChannels > 1 ? SOUND_BPS.stereo : SOUND_BPS.mono;
  for (const bitrateMode of ['constant', 'variable'] as const) {
    for (const bitrate of [want, want + 32_000, want - 32_000]) {
      const quality = new Quality({ bitrate, bitrateMode });
      if (await canEncodeAudio(codec, { numberOfChannels, sampleRate, quality }).catch(() => false)) return quality;
    }
  }
  return QUALITY_HIGH;
}
