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

/** The matrices of standard-definition (BT.601) video. */
const SD_MATRICES = new Set<string>(['smpte170m', 'bt470bg']);

/** Whether the track says its pixels are BT.601. */
export async function sdMatrix(track: InputVideoTrack): Promise<boolean> {
  return SD_MATRICES.has((await track.getColorSpace()).matrix ?? '');
}

/**
 * WebKit's decoder turns a BT.601 video into RGB with the BT.709 matrix and labels its frames bt709, though it was
 * configured with smpte170m (Mac WebKit, 2026-11-10; on iPhones, audit V-243): saturated colours shift by up to 20
 * levels (red 208,32,33 came out 223,49,30), in the preview and in every file made from it. A frame labelled bt709 from
 * a track that says BT.601 is such a frame; Chromium keeps the label and needs nothing. Asked of each frame, so a
 * WebKit that gets this right stops being corrected.
 */
export const decodedAs709 = (sdTrack: boolean, frameMatrix: string | null | undefined): boolean => sdTrack && frameMatrix === 'bt709';

/**
 * RGB decoded with the BT.709 matrix → RGB as BT.601 decodes the same YCbCr: A601 · A709⁻¹, row-major, on the
 * gamma-encoded values (range scaling is the same for both and cancels). Shared by the shader and the CPU paths.
 */
export const BT709_AS_601 = [0.9136, 0.07848, 0.00792, -0.10504, 1.17217, -0.06713, 0.00958, 0.03222, 0.9582] as const;

/** Corrects RGBA pixels decoded with the wrong matrix (see decodedAs709), in place. */
export function pixelsAs601(data: Uint8ClampedArray): void {
  const m = BT709_AS_601;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    data[i] = m[0] * r + m[1] * g + m[2] * b; // Uint8ClampedArray rounds and clamps
    data[i + 1] = m[3] * r + m[4] * g + m[5] * b;
    data[i + 2] = m[6] * r + m[7] * g + m[8] * b;
  }
}

/** What a picture made on a 2D canvas still needs before it is shown or stored: HDR to SDR, the BT.601 matrix. */
export function correctPixels(data: Uint8ClampedArray, fix: { hdr?: Hdr; as601?: boolean }): void {
  if (fix.hdr) pixelsToSdr(data, fix.hdr);
  else if (fix.as601) pixelsAs601(data);
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
