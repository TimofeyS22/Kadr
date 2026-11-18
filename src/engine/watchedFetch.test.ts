// SW-L-3: a slow download is not a dead one, and the words say what happened.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CONNECTION_BROKE, NOT_ANSWERING, OFFLINE, QUIET_MS, SITE_ERROR, watchedBlob, type Got } from './watchedFetch';
import { modelLoad } from './modelLoad';

/** A server that sends `chunks` pieces of `piece` bytes, one every `everyMs`, then stops (or stays quiet, or breaks). */
function server(o: { chunks: number; piece: number; everyMs: number; after?: 'end' | 'quiet' | 'break'; status?: number; headers?: Record<string, string>; noHeaders?: boolean }) {
  return vi.fn((_url: string, init?: RequestInit) => new Promise<Response>((resolve, reject) => {
    const signal = init?.signal;
    signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
    if (o.noHeaders) return; // the server never answers
    let sent = 0, timer: ReturnType<typeof setTimeout> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(ctrl) {
        signal?.addEventListener('abort', () => { clearTimeout(timer); try { ctrl.error(new DOMException('The operation was aborted.', 'AbortError')); } catch { /* closed */ } });
        const next = () => {
          if (sent === o.chunks) {
            if ((o.after ?? 'end') === 'end') ctrl.close();
            else if (o.after === 'break') ctrl.error(new TypeError('The network connection was lost.'));
            return; // 'quiet': nothing more, ever
          }
          timer = setTimeout(() => { ctrl.enqueue(new Uint8Array(o.piece)); sent++; next(); }, o.everyMs);
        };
        next();
      },
    });
    resolve(new Response(body, { status: o.status ?? 200, headers: o.headers }));
  }));
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('navigator', { onLine: true });
  vi.stubGlobal('self', globalThis);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Runs the timers until `p` settles (at most `maxMs`), and gives its outcome. */
async function settle<T>(p: Promise<T>, maxMs: number): Promise<{ value?: T; error?: Error }> {
  const out: { value?: T; error?: Error; done?: boolean } = {};
  p.then((value) => { out.value = value; out.done = true; }, (error: Error) => { out.error = error; out.done = true; });
  for (let t = 0; t < maxMs && !out.done; t += 100) await vi.advanceTimersByTimeAsync(100);
  await vi.advanceTimersByTimeAsync(0);
  return out;
}

describe('a model download (SW-L-3)', () => {
  it('a slow one — 75 s, a piece every second — comes whole, telling how far it is all the way', async () => {
    vi.stubGlobal('fetch', server({ chunks: 75, piece: 1000, everyMs: 1000, headers: { 'content-length': '75000' } }));
    const told: Got[] = [];
    const out = await settle(watchedBlob('/runtime.wasm', 75_000, 'application/wasm', (g) => told.push(g)), 120_000);
    expect(out.error).toBeUndefined();
    expect(out.value?.size).toBe(75_000);
    expect(out.value?.type).toBe('application/wasm');
    expect(told.length).toBeGreaterThan(60);
    const shares = told.map((g) => g.share);
    expect(shares).toEqual(shares.toSorted((a, b) => a - b));
    expect(told.at(-1)).toEqual({ share: 1, mb: { done: 0.075, total: 0.075 } });
    expect(told[30].mb?.total).toBe(0.075);
  });

  it('compressed on the way: the share is counted against the file\'s own size, the megabytes against what the wire carries', async () => {
    vi.stubGlobal('fetch', server({ chunks: 10, piece: 1000, everyMs: 300, headers: { 'content-length': '3000', 'content-encoding': 'gzip' } }));
    const told: Got[] = [];
    const out = await settle(watchedBlob('/runtime.wasm', 10_000, 'application/wasm', (g) => told.push(g)), 10_000);
    expect(out.value?.size).toBe(10_000);
    const mid = told.find((g) => g.share >= 0.5 && g.share < 1)!;
    expect(mid.mb!.total).toBe(0.003);
    expect(mid.mb!.done).toBeCloseTo(mid.share * 0.003, 9);
  });

  it(`a server that answers and then goes quiet: «did not answer» after ${QUIET_MS / 1000} s of quiet, not before`, async () => {
    vi.stubGlobal('fetch', server({ chunks: 5, piece: 1000, everyMs: 1000, after: 'quiet', headers: { 'content-length': '75000' } }));
    const t0 = Date.now();
    const out = await settle(watchedBlob('/runtime.wasm', 75_000, 'application/wasm', () => undefined), 120_000);
    expect(out.error?.message).toBe(NOT_ANSWERING);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(5000 + QUIET_MS);
    expect(Date.now() - t0).toBeLessThan(5000 + QUIET_MS + 1000);
  });

  it('a server that never answers: «did not answer»', async () => {
    vi.stubGlobal('fetch', server({ chunks: 0, piece: 0, everyMs: 0, noHeaders: true }));
    const out = await settle(watchedBlob('/runtime.wasm', 1000, 'application/wasm', () => undefined), 60_000);
    expect(out.error?.message).toBe(NOT_ANSWERING);
  });

  it('a connection that breaks: «the connection broke», not «did not answer»', async () => {
    vi.stubGlobal('fetch', server({ chunks: 5, piece: 1000, everyMs: 1000, after: 'break' }));
    const out = await settle(watchedBlob('/runtime.wasm', 75_000, 'application/wasm', () => undefined), 60_000);
    expect(out.error?.message).toBe(CONNECTION_BROKE);
  });

  it('an error status: «the site answered with an error»', async () => {
    vi.stubGlobal('fetch', server({ chunks: 1, piece: 10, everyMs: 10, status: 503 }));
    const out = await settle(watchedBlob('/runtime.wasm', 75_000, 'application/wasm', () => undefined), 10_000);
    expect(out.error?.message).toBe(SITE_ERROR);
  });

  it('a try after a failed one goes past the HTTP cache, the first one does not', async () => {
    const fetch = server({ chunks: 1, piece: 10, everyMs: 10 });
    vi.stubGlobal('fetch', fetch);
    await settle(watchedBlob('/runtime.wasm', 10, 'application/wasm', () => undefined), 1000);
    await settle(watchedBlob('/runtime.wasm', 10, 'application/wasm', () => undefined, { fresh: true }), 1000);
    expect(fetch.mock.calls.map((c) => c[1]?.cache)).toEqual([undefined, 'no-store']);
  });

  it('offline: «no internet», whatever broke', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Load failed'); }));
    vi.stubGlobal('navigator', { onLine: false });
    const out = await settle(watchedBlob('/runtime.wasm', 75_000, 'application/wasm', () => undefined), 10_000);
    expect(out.error?.message).toBe(OFFLINE);
  });
});

describe('the time limit of a model load (SW-L-3)', () => {
  /** A load that moves every `everyS` seconds, `times` times, then resolves. */
  const moving = (everyS: number, times: number) => (alive: () => void) => new Promise<string>((resolve) => {
    let n = 0;
    const tick = () => { if (++n > times) { resolve('model'); return; } alive(); setTimeout(tick, everyS * 1000); };
    setTimeout(tick, everyS * 1000);
  });

  it('a load that keeps moving for 100 s is not cut at 60 s', async () => {
    const out = await settle(modelLoad(moving(10, 10), () => undefined), 150_000);
    expect(out.error).toBeUndefined();
    expect(out.value).toBe('model');
  });

  it('a load that says nothing fails after 60 s with «did not answer», and a model coming later is let go', async () => {
    let resolveLate: (v: string) => void = () => undefined;
    const released: string[] = [];
    const out = await settle(modelLoad(() => new Promise<string>((r) => { resolveLate = r; }), (late) => released.push(late)), 70_000);
    expect(out.error?.message).toBe(NOT_ANSWERING);
    resolveLate('late model');
    await vi.advanceTimersByTimeAsync(0);
    expect(released).toEqual(['late model']);
  });

  it('a load that moved and then went quiet for 60 s fails then', async () => {
    const t0 = Date.now();
    const out = await settle(modelLoad((alive) => new Promise<string>(() => { setTimeout(alive, 30_000); }), () => undefined), 120_000);
    expect(out.error?.message).toBe(NOT_ANSWERING);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(90_000);
  });
});
