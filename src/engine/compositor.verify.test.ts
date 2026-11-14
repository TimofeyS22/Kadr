// Sweep lane E2 (docs/21 §5): a reproducing test for audit V-156 — after a GPU reset the export's new WebGL context was
// refused for a moment and the export failed with "WebGL2 is not available in this browser", which is untrue on a page
// that had a context and is not an error the export starts again on. The export's retry is in e2e/qa-verify-media.spec.ts.
import { describe, expect, it, vi } from 'vitest';

vi.mock('./media', () => ({ MediaError: class extends Error {} }));
vi.mock('../lib/device', () => ({ WEBKIT: false }));
const { Compositor, GPU_LOST } = await import('./compositor');

/** A WebGL2 context that answers every call (the shaders compile, the program links): enough for the compositor to start. */
const fakeGl = () => new Proxy({}, { get: (_, k) => (typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : () => ({})) });
const canvas = (gl: unknown) => ({ addEventListener: () => undefined, getContext: () => gl }) as unknown as HTMLCanvasElement;

describe('a context refused after the page had one (audit V-156)', () => {
  it('the export is told the graphics were reset, which it starts again on; never "no WebGL"', () => {
    expect(() => new Compositor(canvas(fakeGl()))).not.toThrow(); // the preview had its context
    expect(() => new Compositor(canvas(null), true)).toThrow(GPU_LOST); // the export's new one is refused
  });
  it('a page that never had a context still says the browser has no WebGL2', async () => {
    vi.resetModules();
    const fresh = await import('./compositor');
    expect(() => new fresh.Compositor(canvas(null), true)).toThrow('WebGL2 is not available in this browser');
  });
});
