import { describe, expect, it } from 'vitest';
import { createImageClip, createProject } from './defaults';
import { punchScale, seedOf, shake } from './effects';
import { buildFrame } from './frame';
import { fromBase64, parseCube, toBase64 } from './lut';
import { placeClip } from './timeline';
import type { Asset, ImageClip } from './types';

const cube = (size: number, f: (r: number, g: number, b: number) => number[], head = '') => {
  const lines = [head, `LUT_3D_SIZE ${size}`];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    lines.push(f(r / (size - 1), g / (size - 1), b / (size - 1)).map((v) => v.toFixed(6)).join(' '));
  }
  return lines.join('\n');
};

describe('.cube LUT parser', () => {
  it('parses an identity LUT with title and comments', () => {
    const l = parseCube(cube(17, (r, g, b) => [r, g, b], '# comment\nTITLE "Identity"'));
    expect(l.title).toBe('Identity');
    expect(l.size).toBe(17);
    // Red is fastest: entry (r=16, g=0, b=0) is pure red.
    expect(Array.from(l.data.subarray(16 * 3, 16 * 3 + 3))).toEqual([255, 0, 0]);
  });
  it('resamples LUTs above 33 to 33 without changing an identity', () => {
    const l = parseCube(cube(65, (r, g, b) => [r, g, b]));
    expect(l.size).toBe(33);
    const i = ((20 * 33 + 10) * 33 + 5) * 3;
    expect(Array.from(l.data.subarray(i, i + 3))).toEqual([5, 10, 20].map((x) => Math.round((x / 32) * 255)));
  });
  it('rejects 1D LUTs, wrong counts and garbage', () => {
    expect(() => parseCube('LUT_1D_SIZE 4\n0 0 0')).toThrow(/1D/);
    expect(() => parseCube('LUT_3D_SIZE 2\n0 0 0')).toThrow(/not a valid/);
    expect(() => parseCube('hello world')).toThrow(/not a valid/);
    expect(() => parseCube(`LUT_3D_SIZE 2\n${'0 0 x\n'.repeat(8)}`)).toThrow(/not a valid/);
  });
  it('base64 round-trips binary data', () => {
    const b = Uint8Array.from({ length: 70000 }, (_, i) => (i * 31) % 256);
    expect(fromBase64(toBase64(b))).toEqual(b);
  });
});

describe('effects', () => {
  it('are deterministic and vanish at amount 0', () => {
    const s = seedOf('clip-1');
    expect(seedOf('clip-1')).toBe(s);
    expect(shake(1.23, 1, s)).toEqual(shake(1.23, 1, s));
    expect(Object.values(shake(1.23, 0, s)).every((v) => v === 0)).toBe(true);
    expect(punchScale(0, 0)).toBe(1);
    expect(punchScale(0, 1)).toBeCloseTo(1.18, 5);
    expect(punchScale(0.49, 1)).toBeLessThan(1.01);
  });
});

describe('frame layers for v0.6 looks', () => {
  const setup = (edit: (c: ImageClip) => void) => {
    const p = createProject('p', '9:16');
    const a: Asset = { id: 'a', kind: 'image', name: 'a.png', mime: 'image/png', size: 1, duration: 0, width: 100, height: 100, hasAudio: false };
    p.assets.a = a;
    const c = createImageClip(a, 0);
    edit(c);
    placeClip(p, c);
    p.luts = { L: { name: 'L', size: 2, data: toBase64(new Uint8Array(24)) } };
    return buildFrame(p, 0.5).layers.find((l) => l.id === c.id)!;
  };
  it('maps shader effects, LUTs and hidden areas; zero amounts are no-ops', () => {
    const l = setup((c) => {
      c.effect = { id: 'vhs', amount: 0.5 };
      c.lut = { id: 'L', intensity: 0.7 };
      c.privacy = { faces: true, style: 'pixelate', areas: [{ x: { v: 0.2 }, y: { v: 0.8 }, w: 0.1, h: 0.2 }] };
    });
    expect(l.fx).toMatchObject({ code: 2, amount: 0.5, time: 0.5 });
    expect(l.lut?.intensity).toBe(0.7);
    expect(l.privacy).toEqual({ faces: true, pixelate: true, areas: [[0.2, 0.8, 0.1, 0.2]] });
    const none = setup((c) => { c.effect = { id: 'glitch', amount: 0 }; c.lut = { id: 'missing', intensity: 1 }; });
    expect(none.fx).toBeNull();
    expect(none.lut).toBeNull();
    expect(none.privacy).toBeNull();
  });
  it('shake and zoom punch move the layer instead of using the shader', () => {
    const base = setup(() => undefined);
    const punch = setup((c) => { c.effect = { id: 'zoomPunch', amount: 1 }; });
    expect(punch.fx).toBeNull();
    expect(punch.scale).toBeCloseTo(base.scale * 1.18, 5); // 0.5 s is the start of a punch
  });
});
