// HDR sources (an iPhone records HLG by default). The picture path turns them into SDR in the compositor's shader
// (`toSdr` in compositor.ts); thumbnails come from a worker's 2D canvas and use the same formulas here.
import type { InputVideoTrack } from 'mediabunny';

export type Hdr = 'hlg' | 'pq';

/**
 * Which HDR transfer the track uses, if any. Chromium squeezes HLG towards SDR on its own and WebKit passes the signal
 * through, so the decoder is told the signal is plain video: every browser then hands over the same values.
 */
export async function hdrTransfer(track: InputVideoTrack): Promise<Hdr | undefined> {
  const space = await track.getColorSpace();
  const transfer: string | null | undefined = space.transfer; // TypeScript's list stops short of the HDR ones
  const hdr = transfer === 'hlg' ? 'hlg' : transfer === 'pq' ? 'pq' : undefined;
  if (!hdr) return undefined;
  const config = track.getDecoderConfig.bind(track);
  track.getDecoderConfig = async () => {
    const c = await config();
    return c && { ...c, colorSpace: { primaries: 'bt709', transfer: 'bt709', matrix: space.matrix ?? 'bt2020-ncl', fullRange: space.fullRange ?? false } as VideoColorSpaceInit };
  };
  return hdr;
}

const hlgToScene = (e: number) => (e <= 0.5 ? (e * e) / 3 : (Math.exp((e - 0.55991073) / 0.17883277) + 0.28466892) / 12);
const pqToNits = (e: number) => {
  const p = Math.max(e, 0) ** (1 / 78.84375);
  return 10000 * (Math.max(p - 0.8359375, 0) / (18.8515625 - 18.6875 * p)) ** (1 / 0.1593017578125);
};
const encode = (v: number) => {
  const o = Math.min(1, Math.max(0, v));
  return Math.round(255 * (o < 0.0031308 ? o * 12.92 : 1.055 * o ** (1 / 2.4) - 0.055));
};

/** Turns RGBA pixels holding an HDR signal (BT.2020) into SDR, in place. The same steps as the shader. */
export function pixelsToSdr(data: Uint8ClampedArray, hdr: Hdr): void {
  // Thumbnails repeat colours and each channel only has 256 values: a table saves most of the powers.
  const table = new Float64Array(256);
  for (let i = 0; i < 256; i++) table[i] = hdr === 'hlg' ? hlgToScene(i / 255) : pqToNits(i / 255) / 203;
  for (let i = 0; i < data.length; i += 4) {
    let r = table[data[i]], g = table[data[i + 1]], b = table[data[i + 2]];
    if (hdr === 'hlg') {
      const gain = (Math.max(0.2627 * r + 0.678 * g + 0.0593 * b, 1e-6) ** 0.2 * 1000) / 203;
      r *= gain; g *= gain; b *= gain;
    }
    const m = Math.max(r, g, b);
    if (m > 0.85) {
      const k = (0.85 + 0.15 * (1 - Math.exp((-1.5 * (m - 0.85)) / 0.15))) / m;
      r *= k; g *= k; b *= k;
    }
    data[i] = encode(1.6605 * r - 0.5876 * g - 0.0728 * b);
    data[i + 1] = encode(-0.1246 * r + 1.1329 * g - 0.0083 * b);
    data[i + 2] = encode(-0.0182 * r - 0.1006 * g + 1.1187 * b);
  }
}
