import { describe, expect, it } from 'vitest';
import { GIF_FPS, gifDelayMs } from './exportSizes';

describe('GIF timing', () => {
  it('each frame starts when the preview shows it, to the hundredth a GIF counts in; the GIF is as long as the video', () => {
    let at = 0;
    for (let i = 0; i < 12 * 30; i++) {
      expect(Math.abs(at - (i * 1000) / GIF_FPS), `frame ${i} starts at ${at} ms`).toBeLessThanOrEqual(5);
      const d = gifDelayMs(i);
      expect(d % 10, 'whole hundredths: a GIF keeps no finer time').toBe(0);
      at += d;
    }
    expect(at, '30 s of video, 360 frames').toBe(30_000);
  });
});
