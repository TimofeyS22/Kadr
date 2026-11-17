// Sound goes to an encoder in whole codec frames (SW-A-14, the cause of V-159). WebKit's encoders stamp the packets of
// each piece of sound from the piece's own start: a piece that is not whole frames leaves a packet of 896 or 1920
// samples at its seam, and the stamps drift off the sound by up to 19 ms. The export handed over 2 s windows (93.75 AAC
// frames) and processed sounds 10 s ones: a 30 s file's sound swung 13 ms against its picture from one second to the
// next on WebKit. Pieces of whole frames keep every packet one frame long and the stamps on the sound.

/** Samples in a whole number of frames of both AAC (1024) and 48 kHz Opus (960): 15 and 16 frames, 0.32 s. */
export const FRAME_GRAIN = 15 * 1024;

/**
 * The most frames of one piece handed to Mediabunny's AudioBufferSource: it cuts every buffer into AudioData of at most
 * 240 000 samples over all channels (5 s of mono, 117.19 AAC frames of stereo), which is not whole frames — a processed
 * mono sound kept a short packet every 5 s on WebKit. Under that, in whole grains: 230 400 mono, 107 520 stereo.
 */
export const pieceLimit = (channels: number, grain = FRAME_GRAIN) => Math.floor(240_000 / channels / grain) * grain;

/** A piece of whole frames in parts Mediabunny hands to the encoder as they are (see pieceLimit). */
export function* encoderPieces(chans: Float32Array[], grain = FRAME_GRAIN): Generator<Float32Array[]> {
  const limit = pieceLimit(chans.length, grain);
  for (let k = 0; k < (chans[0]?.length ?? 0); k += limit) yield chans.map((c) => c.subarray(k, k + limit));
}

/** Re-cuts a stream of sound into pieces of whole frames, holding the rest for the next piece; `flush` gives the tail. */
export class WholeFrames {
  private held: Float32Array[] = [];

  constructor(private readonly channels: number, private readonly grain = FRAME_GRAIN) {
    this.held = Array.from({ length: channels }, () => new Float32Array(0));
  }

  /** The next piece of whole frames (null while less than one grain is held). */
  push(chans: Float32Array[]): Float32Array[] | null {
    const len = this.held[0].length + (chans[0]?.length ?? 0);
    const joined = this.held.map((h, c) => {
      if (!chans[c]?.length) return h;
      const x = new Float32Array(len);
      x.set(h);
      x.set(chans[c], h.length);
      return x;
    });
    const n = Math.floor(len / this.grain) * this.grain;
    this.held = joined.map((x) => x.slice(n));
    return n ? joined.map((x) => x.subarray(0, n)) : null;
  }

  /** What is left at the end, under one grain (the last packet may be short), or null. */
  flush(): Float32Array[] | null {
    const rest = this.held;
    this.held = Array.from({ length: this.channels }, () => new Float32Array(0));
    return rest[0].length ? rest : null;
  }
}
