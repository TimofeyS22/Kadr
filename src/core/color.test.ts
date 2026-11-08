import { describe, expect, it } from 'vitest';
import { hexToHsl, hexToHsv, hslToHex, hsvToHex } from './color';

describe('colour spectrum (v1.6.2): HSV and hex', () => {
  it('maps the corners of the spectrum', () => {
    expect(hsvToHex(0, 1, 1)).toBe('#ff0000');
    expect(hsvToHex(120, 1, 1)).toBe('#00ff00');
    expect(hsvToHex(240, 1, 1)).toBe('#0000ff');
    expect(hsvToHex(60, 0, 1)).toBe('#ffffff');
    expect(hsvToHex(200, 0.7, 0)).toBe('#000000');
  });

  it('goes there and back for any colour', () => {
    for (const hex of ['#ffc53d', '#1b2a49', '#7a1f2b', '#2ad4c8', '#9e9e9e', '#000000', '#ffffff']) {
      const c = hexToHsv(hex)!;
      expect(hsvToHex(c.h, c.s, c.v)).toBe(hex);
    }
  });

  it('reads short hex and refuses what is not a colour', () => {
    expect(hsvToHex(...(Object.values(hexToHsv('#f80')!) as [number, number, number]))).toBe('#ff8800');
    expect(hexToHsv('red')).toBeNull();
    expect(hexToHsv('#12345')).toBeNull();
  });
});

describe('colour spectrum (v1.6.4): HSL and hex', () => {
  it('maps the middle of the field to the pure colours, its edges to white and black', () => {
    expect(hslToHex(0, 1, 0.5)).toBe('#ff0000');
    expect(hslToHex(60, 1, 0.5)).toBe('#ffff00');
    expect(hslToHex(120, 1, 0.5)).toBe('#00ff00');
    expect(hslToHex(240, 1, 0.5)).toBe('#0000ff');
    expect(hslToHex(200, 1, 1)).toBe('#ffffff');
    expect(hslToHex(200, 1, 0)).toBe('#000000');
    expect(hslToHex(200, 0, 0.5)).toBe('#808080');
  });
  it('goes there and back for any colour', () => {
    for (const hex of ['#ffc53d', '#1b2a49', '#7a1f2b', '#2ad4c8', '#9e9e9e', '#000000', '#ffffff']) {
      const c = hexToHsl(hex)!;
      expect(hslToHex(c.h, c.s, c.l)).toBe(hex);
    }
    expect(hexToHsl('red')).toBeNull();
  });
});
