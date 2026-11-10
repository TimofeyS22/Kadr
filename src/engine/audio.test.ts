// The preview follows the sound that is heard, not the sound being computed (audit V-157): in Bluetooth headphones the
// two are 150–300 ms apart, and the picture ran ahead of its sound.
import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { AudioEngine as Engine } from './audio';

// The engine's imports reach code that makes canvases at load; Node has none.
let AudioEngine: typeof Engine;
beforeAll(async () => {
  vi.stubGlobal('OffscreenCanvas', class { getContext() { return null; } });
  vi.stubGlobal('self', globalThis);
  ({ AudioEngine } = await import('./audio'));
});

type Clock = { currentTime: number; outputLatency?: number; baseLatency?: number; getOutputTimestamp?: () => AudioTimestamp };
/** An engine playing from timeline second 2, started when the context was at 5 s, now at `ctx.currentTime`. */
function playing(ctx: Clock, startCtx = 5): Engine {
  const e = new AudioEngine();
  Object.assign(e as unknown as { ctx: Clock; startTl: number; startCtx: number }, { ctx, startTl: 2, startCtx });
  return e;
}

describe('the audible clock', () => {
  it('Bluetooth headphones: the output timestamp says what is heard, 250 ms behind what is computed', () => {
    const e = playing({ currentTime: 10, outputLatency: 0.25, getOutputTimestamp: () => ({ contextTime: 9.75, performanceTime: performance.now() }) });
    expect(e.now()).toBeCloseTo(7, 3);
    expect(e.heard()).toBeCloseTo(6.75, 2);
  });

  it("the timestamp is moved on to this moment on the page's clock", () => {
    const e = playing({ currentTime: 10, getOutputTimestamp: () => ({ contextTime: 9.5, performanceTime: performance.now() - 200 }) });
    expect(e.heard()).toBeCloseTo(6.7, 1);
  });

  it('without a timestamp (or before the device played anything) the reported latencies are taken off', () => {
    expect(playing({ currentTime: 10, outputLatency: 0.2, baseLatency: 0.01 }).heard()).toBeCloseTo(6.79, 3);
    expect(playing({ currentTime: 10, outputLatency: 0.2, getOutputTimestamp: () => ({ contextTime: 0, performanceTime: 0 }) }).heard()).toBeCloseTo(6.8, 3);
  });

  it('never ahead of what is computed, never before the start, and held while the sound is primed', () => {
    expect(playing({ currentTime: 10, getOutputTimestamp: () => ({ contextTime: 12, performanceTime: performance.now() }) }).heard()).toBeCloseTo(7, 3);
    expect(playing({ currentTime: 5.1, outputLatency: 0.3 }).heard()).toBe(2);
    expect(playing({ currentTime: 10, outputLatency: 0.3 }, Infinity).heard()).toBe(2);
  });

  it('a stamp on a broken clock is not believed: the picture does not freeze, the reported latency is used', () => {
    const ahead = { contextTime: 9.8, performanceTime: performance.now() + 5000 };
    expect(playing({ currentTime: 10, outputLatency: 0.2, getOutputTimestamp: () => ahead }).heard()).toBeCloseTo(6.8, 3);
  });

  it('a wired speaker barely moves: 20 ms', () => {
    expect(playing({ currentTime: 10, outputLatency: 0.02 }).heard()).toBeCloseTo(6.98, 3);
  });
});
