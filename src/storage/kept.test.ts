// V-223: the browser is asked to keep the projects for good once a page, when there is one to keep; a refusal or a
// browser that cannot be asked changes nothing; whether the data is kept is read without asking.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => { (globalThis as { window?: EventTarget }).window ??= new EventTarget(); });
vi.mock('idb-keyval', () => ({ get: async () => undefined, set: async () => undefined, del: async () => undefined, keys: async () => [], promisifyRequest: async () => undefined }));

/** The rest of a navigator the modules db.ts imports read. */
const NAV = { userAgent: 'test', platform: 'test', language: 'en', onLine: true, maxTouchPoints: 0 };

/** A browser's storage manager: kept or not, and what it answers when asked. */
function storage(o: { kept: boolean; answer: boolean | 'throw' }) {
  let kept = o.kept;
  const persist = vi.fn(async () => { if (o.answer === 'throw') throw new DOMException('refused', 'NotAllowedError'); kept = o.answer; return kept; });
  const persisted = vi.fn(async () => kept);
  vi.stubGlobal('navigator', { ...NAV, storage: { persist, persisted } });
  return { persist, persisted };
}

/** db.ts afresh: its «once a page» is the module's. */
const db = async () => { vi.resetModules(); return import('./db'); };

beforeEach(() => { vi.spyOn(console, 'warn').mockImplementation(() => undefined); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('keeping the projects for good (V-223)', () => {
  it('asks once a page, however many times it is called, and says what the browser answered', async () => {
    const s = storage({ kept: false, answer: true });
    const { keepProjects } = await db();
    expect(await Promise.all([keepProjects(), keepProjects()])).toEqual([true, true]);
    expect(await keepProjects()).toBe(true);
    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it('a refusal is a refusal: false, asked once', async () => {
    const s = storage({ kept: false, answer: false });
    const { keepProjects } = await db();
    expect(await keepProjects()).toBe(false);
    expect(await keepProjects()).toBe(false);
    expect(s.persist).toHaveBeenCalledTimes(1);
  });

  it('data kept already: not asked again', async () => {
    const s = storage({ kept: true, answer: true });
    const { keepProjects } = await db();
    expect(await keepProjects()).toBe(true);
    expect(s.persist).not.toHaveBeenCalled();
  });

  it('a browser that throws, or cannot be asked, breaks nothing: false', async () => {
    storage({ kept: false, answer: 'throw' });
    expect(await (await db()).keepProjects()).toBe(false);
    vi.stubGlobal('navigator', NAV);
    expect(await (await db()).keepProjects()).toBe(false);
  });

  it('whether the data is kept is read without asking; null where the browser cannot say', async () => {
    const s = storage({ kept: false, answer: true });
    const { storageKept } = await db();
    expect(await storageKept()).toBe(false);
    expect(s.persist).not.toHaveBeenCalled();
    vi.stubGlobal('navigator', NAV);
    expect(await storageKept()).toBeNull();
    vi.stubGlobal('navigator', { ...NAV, storage: { persisted: async () => { throw new Error('no'); } } });
    expect(await storageKept()).toBeNull();
  });
});
