// Effects are sized as a share of the picture, not in texels (audit V-145): the preview draws at most 1280 px and the
// file up to 4K, so a radius in texels came out up to three times smaller in the file than on the screen.

/** The picture size (long side, px) the effects' numbers were tuned at: the preview's. */
const REFERENCE = 1280;
/** How many of this picture's texels one texel of the reference picture covers. */
export const fxScale = (longSide: number): number => longSide / REFERENCE;
/** The blur's mip level: its radius (2^level texels) is the same share of the picture at any size. */
export const fxLod = (amount: number, longSide: number): number =>
  amount > 0 ? Math.max(0, amount * Math.log2(REFERENCE / 24) + Math.log2(longSide / REFERENCE)) : 0;
