// The page going into Safari's back-forward cache aborts its IndexedDB transactions and starts none until it is back
// (bfcache.ts): a transaction frozen with the page held the store for every other Kadr page on an iPhone.
import { describe, expect, it, vi } from 'vitest';
import { cacheGate, type Tracked } from './bfcache';

/** A pagehide or pageshow; `persisted`: the page goes into (or comes out of) the back-forward cache. */
const transition = (type: 'pagehide' | 'pageshow', persisted: boolean) => Object.assign(new Event(type), { persisted });

/** A transaction that ends when told to, and counts its aborts. */
function fakeTx() {
  const on: Record<string, (() => void)[]> = {};
  const tx = {
    aborts: 0,
    abort() { tx.aborts++; for (const fn of on.abort ?? []) fn(); },
    addEventListener(type: string, fn: () => void) { (on[type] ??= []).push(fn); },
    complete() { for (const fn of on.complete ?? []) fn(); },
  };
  return tx satisfies Tracked & { aborts: number; complete(): void };
}

describe('the back-forward cache gate', () => {
  it('aborts the transactions running as the page goes into the cache', () => {
    const page = new EventTarget();
    const left = vi.fn();
    const gate = cacheGate(page, left);
    const running = fakeTx(), done = fakeTx();
    gate.track(running);
    gate.track(done);
    done.complete();
    page.dispatchEvent(transition('pagehide', true));
    expect(running.aborts, 'the transaction still running').toBe(1);
    expect(done.aborts, 'one that had ended is left alone').toBe(0);
    expect(left).toHaveBeenCalledOnce();
    expect(gate.away).not.toBeNull();
  });

  it('holds new work until the page is shown again, then lets it go', async () => {
    const page = new EventTarget();
    const gate = cacheGate(page);
    page.dispatchEvent(transition('pagehide', true));
    let through = false;
    const waiting = gate.away!.then(() => { through = true; });
    await Promise.resolve();
    expect(through, 'nothing starts while the page is in the cache').toBe(false);
    page.dispatchEvent(transition('pageshow', true));
    await waiting;
    expect(through).toBe(true);
    expect(gate.away).toBeNull();
  });

  it('does nothing for a page that is unloaded or shown for the first time', () => {
    const page = new EventTarget();
    const left = vi.fn();
    const gate = cacheGate(page, left);
    const tx = fakeTx();
    gate.track(tx);
    page.dispatchEvent(transition('pagehide', false)); // a reload or a closed tab: the browser ends its transactions
    page.dispatchEvent(transition('pageshow', false));
    expect(tx.aborts).toBe(0);
    expect(left).not.toHaveBeenCalled();
    expect(gate.away).toBeNull();
  });

  it('aborts again on a second trip into the cache, and only what runs then', () => {
    const page = new EventTarget();
    const gate = cacheGate(page);
    const first = fakeTx();
    gate.track(first);
    page.dispatchEvent(transition('pagehide', true));
    page.dispatchEvent(transition('pageshow', true));
    const second = fakeTx();
    gate.track(second);
    page.dispatchEvent(transition('pagehide', true));
    expect(first.aborts, 'the first was aborted once, on the first trip').toBe(1);
    expect(second.aborts).toBe(1);
  });
});
