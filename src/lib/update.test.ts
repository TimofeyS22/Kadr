import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  store.clear();
  reload = vi.fn();
  vi.stubGlobal('navigator', { onLine: true, language: 'en' });
  vi.stubGlobal('location', { reload });
  vi.stubGlobal('sessionStorage', { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v), removeItem: (k: string) => store.delete(k) });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('stale code (deploy skew, docs/12)', () => {
  it('recognises a lazy chunk that is gone in WebKit, Chromium and Firefox words', async () => {
    const { isStaleCode } = await import('./update');
    expect(isStaleCode(new TypeError('Importing a module script failed.'))).toBe(true);
    expect(isStaleCode(new TypeError('Failed to fetch dynamically imported module: https://x/assets/a-1.js'))).toBe(true);
    expect(isStaleCode(new TypeError('error loading dynamically imported module: https://x/assets/a-1.js'))).toBe(true);
    expect(isStaleCode(new TypeError('Load failed'))).toBe(false);
  });

  it('turns the browser\'s words into what a person can act on', async () => {
    const { errorMessage } = await import('./telemetry');
    expect(errorMessage(new TypeError('Importing a module script failed.'))).toBe('Part of Kadr did not load. Check the connection and reload the page.');
    expect(errorMessage(new DOMException('The quota has been exceeded.', 'QuotaExceededError'))).toMatch(/^Not enough storage/);
    expect(errorMessage(new TypeError('Load failed'))).toBe('Could not reach the network. Check the connection and try again.');
    vi.stubGlobal('navigator', { onLine: false, language: 'en' });
    expect(errorMessage(new TypeError('Failed to fetch'))).toBe('No internet connection.');
  });

  it('reloads into the new version, but only once nothing is running', async () => {
    const { holdUpdates, reloadIntoUpdate, updatingMessage } = await import('./update');
    const release = holdUpdates(); // an export
    expect(reloadIntoUpdate()).toBe(true);
    expect(updatingMessage()).toBe('Part of Kadr did not load. The page reloads when the current job ends.');
    reloadIntoUpdate(true); // the site turned out to have a newer version
    expect(updatingMessage()).toBe('Kadr has been updated. The page reloads when the current job ends.');
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    release();
    vi.advanceTimersByTime(2000);
    expect(reload).toHaveBeenCalledOnce();
    expect(store.get('kadr.updateNotice')).toBe('updated'); // the next page says Kadr was updated, repeat the action
  });

  it('waits for a job that starts in the moment before the reload', async () => {
    const { holdUpdates, reloadIntoUpdate } = await import('./update');
    expect(reloadIntoUpdate()).toBe(true);
    vi.advanceTimersByTime(500);
    const release = holdUpdates(); // "Make reel" tapped again before the reload
    vi.advanceTimersByTime(60_000);
    expect(reload).not.toHaveBeenCalled();
    release();
    vi.advanceTimersByTime(2000);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('lets the waiting service worker in instead of a plain reload when the page has one (main.tsx)', async () => {
    const { reloadIntoUpdate, setUpdateApplier } = await import('./update');
    const apply = vi.fn(async () => true);
    setUpdateApplier(apply);
    reloadIntoUpdate(true);
    await vi.advanceTimersByTimeAsync(2000);
    expect(apply).toHaveBeenCalledOnce();
    expect(reload).not.toHaveBeenCalled(); // the page reloads when the new worker takes over
    expect(store.get('kadr.updateNotice')).toBe('updated');
  });

  it('does not reload again within a minute of the last reload (a file gone for another reason must not loop)', async () => {
    store.set('kadr.reloadedForUpdate', String(Date.now() - 10_000));
    const { reloadIntoUpdate, updatingMessage } = await import('./update');
    expect(reloadIntoUpdate()).toBe(false);
    expect(updatingMessage()).toBe('Part of Kadr did not load. Check the connection and reload the page.');
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload offline: the new version could not load either', async () => {
    vi.stubGlobal('navigator', { onLine: false, language: 'en' });
    const { reloadIntoUpdate } = await import('./update');
    expect(reloadIntoUpdate()).toBe(false);
  });
});
