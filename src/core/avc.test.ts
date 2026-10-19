import { describe, expect, it } from 'vitest';
import { avcFullRange } from './avc';

const hex = (s: string) => Uint8Array.from(s.match(/../g)!.map((b) => parseInt(b, 16)));

describe('H.264 sample range from the SPS (v1.4.3)', () => {
  it('WebKit (VideoToolbox) export: no signal type in the VUI → video range', () => {
    expect(avcFullRange(hex('0164001fffe1000a2764001fac5680b40a1901000428ee3cb0fdf8f800'))).toBe(false);
  });

  it('Chromium export: VUI says full range', () => {
    expect(avcFullRange(hex('01640c1fffe1001367640c1fac18d01681434dc0434041e1108d4001000468ce3c80fdf8f800'))).toBe(true);
  });

  it('unreadable records give null, never a guess', () => {
    expect(avcFullRange(new Uint8Array())).toBeNull();
    expect(avcFullRange(hex('0164001fffe1'))).toBeNull(); // cut before the SPS
    expect(avcFullRange(hex('0164001fffe1000a27640000'))).toBeNull(); // SPS shorter than its length
  });
});
