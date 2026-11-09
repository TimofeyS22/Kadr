import { describe, expect, it } from 'vitest';
import { avcBaseline, avcFullRange } from './avc';

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

describe('the Baseline twin of an H.264 codec string (audit V-259)', () => {
  it('High and Main become Constrained Baseline at the same level', () => {
    expect(avcBaseline('avc1.64001f')).toBe('avc1.42401f'); // 720p
    expect(avcBaseline('avc1.640028')).toBe('avc1.424028'); // 1080p
    expect(avcBaseline('avc1.4D0033')).toBe('avc1.424033'); // Main, 4K
    expect(avcBaseline('avc3.640c1f')).toBe('avc1.42401f');
  });

  it('nothing for Baseline itself or another codec: there is no simpler profile to fall back to', () => {
    expect(avcBaseline('avc1.42401f')).toBeNull();
    expect(avcBaseline('avc1.42E01E')).toBeNull();
    expect(avcBaseline('vp09.00.31.08')).toBeNull();
    expect(avcBaseline('avc1')).toBeNull();
    expect(avcBaseline('')).toBeNull();
  });
});
