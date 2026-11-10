// IndexedDB and Safari's back-forward cache. A page that goes into the cache is frozen with the transactions it has
// running, and a frozen transaction holds the store for every other page of the site until the frozen page is thrown
// away. On an iPhone an edit saved as the editor left (the save starts in pagehide) froze that way: the next Kadr page
// showed its list as "Loading…" and made no new project for as long as the old page stayed cached (L5, iPhone 15,
// 2026-11-10, 8 minutes and counting). So a page going into the cache aborts what it has running and starts nothing
// until it is back; what was aborted is done again then. The edits themselves are already in the synchronous journal.

/** What the gate needs of a transaction. */
export interface Tracked { abort(): void; addEventListener(type: 'complete' | 'abort' | 'error', fn: () => void): void }

export interface CacheGate {
  /** Set while the page is in the back-forward cache: resolves when it is shown again. */
  readonly away: Promise<void> | null;
  /** Watches a transaction until it ends, to abort it if the page goes into the cache first. */
  track(tx: Tracked): void;
}

/** `onLeave`: called as the page goes into the cache, after its transactions are aborted (to close the connection). */
export function cacheGate(page: EventTarget, onLeave: () => void = () => undefined): CacheGate {
  const running = new Set<Tracked>();
  let away: Promise<void> | null = null;
  let back = () => undefined as void;
  page.addEventListener('pagehide', (e) => {
    if (!(e as PageTransitionEvent).persisted) return; // an unloaded page takes its transactions with it
    away ??= new Promise<void>((ok) => { back = ok; });
    for (const tx of running) {
      try { tx.abort(); } catch { /* it ended meanwhile */ }
    }
    running.clear();
    onLeave();
  });
  page.addEventListener('pageshow', (e) => {
    if (!(e as PageTransitionEvent).persisted || !away) return;
    away = null;
    back();
  });
  return {
    get away() { return away; },
    track(tx) {
      running.add(tx);
      const end = () => running.delete(tx);
      tx.addEventListener('complete', end);
      tx.addEventListener('abort', end);
      tx.addEventListener('error', end);
    },
  };
}
