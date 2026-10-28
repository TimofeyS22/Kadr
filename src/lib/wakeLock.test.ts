import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A screen wake lock as the browser gives it: requests and releases are counted. */
function fakeBrowser() {
  const s = { requested: 0, held: 0, visible: 'visible' as 'visible' | 'hidden', onVisible: null as null | (() => void) };
  vi.stubGlobal('navigator', { wakeLock: { request: async () => { s.requested++; s.held++; let on = true; return { release: async () => { if (on) { on = false; s.held--; } } }; } } });
  vi.stubGlobal('document', {
    get visibilityState() { return s.visible; },
    addEventListener: (_: string, f: () => void) => { s.onVisible = f; },
    removeEventListener: () => { s.onVisible = null; },
  });
  return s;
}

describe('keepAwake (docs/12 stage 2)', () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => vi.unstubAllGlobals());

  it('holds one lock for nested work, lets it go when the last one ends, and a second release changes nothing', async () => {
    const s = fakeBrowser();
    const { keepAwake, awakeHolds } = await import('./wakeLock');
    const a = keepAwake(), b = keepAwake();
    await Promise.resolve();
    expect(s.requested).toBe(1);
    a(); a();
    expect(awakeHolds()).toBe(1);
    b();
    await vi.waitFor(() => expect(s.held).toBe(0));
    expect(awakeHolds()).toBe(0);
  });

  it('asks again when the page comes back: the browser dropped the lock while it was hidden', async () => {
    const s = fakeBrowser();
    const { keepAwake } = await import('./wakeLock');
    const release = keepAwake();
    await Promise.resolve();
    s.held = 0; // hidden: the browser let it go
    s.onVisible?.();
    await vi.waitFor(() => expect(s.requested).toBe(2));
    release();
    expect(s.onVisible).toBeNull();
  });

  it('works where there is no wake lock at all', async () => {
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: () => undefined, removeEventListener: () => undefined });
    const { keepAwake } = await import('./wakeLock');
    expect(() => keepAwake()()).not.toThrow();
  });
});
