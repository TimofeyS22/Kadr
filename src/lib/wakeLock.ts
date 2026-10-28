// Keeps the screen on while long work runs: an export, a reel, a speech model download (docs/12 stage 2). On a
// phone a dark screen suspends the page, and a 225 MB download or an encode would wait or start over. The browser
// drops the lock when the page is hidden, so it is asked for again when the page comes back.
type Sentinel = { release(): Promise<void> };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

let holds = 0;
let lock: Promise<Sentinel | null> | null = null;

const api = () => (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
const request = () => { lock = api()?.request('screen').catch(() => null) ?? null; };
const onVisible = () => { if (holds && document.visibilityState === 'visible') request(); };

/** Holds the screen on until the returned function is called (once is enough; holds nest). */
export function keepAwake(): () => void {
  if (holds++ === 0) {
    request();
    document.addEventListener('visibilitychange', onVisible);
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    if (--holds) return;
    document.removeEventListener('visibilitychange', onVisible);
    const held = lock;
    lock = null;
    void held?.then((s) => s?.release()).catch(() => undefined);
  };
}

/** How many holds are on (tests, diagnostics). */
export const awakeHolds = () => holds;
