// H.264 sequence parameter set, read just far enough for the VUI's video_full_range_flag (v1.4.3, docs/11 QA).
// WebKit's encoder (VideoToolbox) writes video-range samples (16–235) with no range in the stream, while it reports a
// full-range colour space that the muxer copies into the MP4: players then lift every black to grey. The stream is
// the truth, so the container tag is set from it.

class Bits {
  private pos = 0;
  constructor(private readonly b: Uint8Array) {}
  bit(): number {
    if (this.pos >> 3 >= this.b.length) throw new RangeError('SPS ended early');
    const v = (this.b[this.pos >> 3] >> (7 - (this.pos & 7))) & 1;
    this.pos++;
    return v;
  }
  bits(n: number): number { let v = 0; for (let i = 0; i < n; i++) v = v * 2 + this.bit(); return v; }
  ue(): number {
    let zeros = 0;
    while (this.bit() === 0) if (++zeros > 31) throw new RangeError('Bad Exp-Golomb code');
    return 2 ** zeros - 1 + this.bits(zeros);
  }
  se(): number { const k = this.ue(); return k % 2 ? (k + 1) / 2 : -k / 2; }
}

/** Removes emulation prevention bytes (00 00 03 → 00 00). */
function unescape(nal: Uint8Array): Uint8Array {
  const out: number[] = [];
  for (let i = 0; i < nal.length; i++) {
    if (i >= 2 && nal[i] === 3 && nal[i - 1] === 0 && nal[i - 2] === 0) continue;
    out.push(nal[i]);
  }
  return Uint8Array.from(out);
}

function skipScalingList(r: Bits, size: number): void {
  let last = 8, next = 8;
  for (let j = 0; j < size; j++) {
    if (next !== 0) next = (last + r.se() + 256) % 256;
    if (next !== 0) last = next;
  }
}

const HIGH_PROFILES = [100, 110, 122, 244, 44, 83, 86, 118, 128, 138, 139, 134, 135];

/** Whether an SPS NAL unit declares full-range samples; without a VUI signal type H.264 means video range. */
export function spsFullRange(sps: Uint8Array): boolean {
  const r = new Bits(unescape(sps));
  r.bits(8); // NAL header
  const profile = r.bits(8);
  r.bits(16); // constraint flags, level
  r.ue(); // seq_parameter_set_id
  if (HIGH_PROFILES.includes(profile)) {
    const chroma = r.ue();
    if (chroma === 3) r.bit(); // separate_colour_plane_flag
    r.ue(); r.ue(); r.bit(); // bit depths, qpprime_y_zero_transform_bypass_flag
    if (r.bit()) for (let i = 0; i < (chroma !== 3 ? 8 : 12); i++) if (r.bit()) skipScalingList(r, i < 6 ? 16 : 64);
  }
  r.ue(); // log2_max_frame_num_minus4
  const poc = r.ue();
  if (poc === 0) r.ue();
  else if (poc === 1) { r.bit(); r.se(); r.se(); const n = r.ue(); for (let i = 0; i < n; i++) r.se(); }
  r.ue(); r.bit(); // max_num_ref_frames, gaps_in_frame_num_allowed_flag
  r.ue(); r.ue(); // picture size in macroblocks
  if (!r.bit()) r.bit(); // frame_mbs_only_flag, else mb_adaptive_frame_field_flag
  r.bit(); // direct_8x8_inference_flag
  if (r.bit()) { r.ue(); r.ue(); r.ue(); r.ue(); } // frame cropping
  if (!r.bit()) return false; // no VUI
  if (r.bit() && r.bits(8) === 255) r.bits(32); // aspect ratio, extended SAR
  if (r.bit()) r.bit(); // overscan
  if (!r.bit()) return false; // no video_signal_type
  r.bits(3); // video_format
  return r.bit() === 1;
}

/** The full-range flag of the first SPS in an avcC record (a decoder config description); null if unreadable. */
export function avcFullRange(avcc: Uint8Array): boolean | null {
  if (avcc.length < 8 || avcc[0] !== 1 || (avcc[5] & 0x1f) === 0) return null;
  const len = (avcc[6] << 8) | avcc[7];
  if (8 + len > avcc.length) return null;
  try { return spsFullRange(avcc.subarray(8, 8 + len)); } catch { return null; }
}
