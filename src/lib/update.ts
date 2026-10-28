// Deploy skew (docs/12): a tab opened before a deploy runs the old code, and the files it loads later can be gone —
// on the owner's iPhone, "Importing a module script failed" in the middle of a reel. CI keeps the last deployments'
// files (scripts/keep-assets.mjs) and a new service worker waits for a safe moment (main.tsx), so this is rare; when
// it happens anyway, the page reloads into the new version once nothing is running, and says why. Projects are saved
// as they change, so a reload between jobs loses nothing.
import { useEffect } from 'react';
import { t } from './i18n';

const KEY = 'kadr.reloadedForUpdate';
const NOTICE = 'kadr.updateNotice';
const ONCE_MS = 60_000;

/** WebKit, Chromium and Firefox words for a lazy chunk that could not be loaded. */
const STALE_CODE = /Importing a module script failed|Failed to fetch dynamically imported module|error loading dynamically imported module|Unable to preload CSS/i;

export const isStaleCode = (e: unknown): boolean => STALE_CODE.test(e instanceof Error ? e.message : String(e));

// --- Work a reload would lose: an export, a reel, captions, a recording, an import ---

let holds = 0;
const onFree: (() => void)[] = [];
const onHeld: (() => void)[] = [];

/** While the returned release is not called, the page neither reloads nor lets a new version in. */
export function holdUpdates(): () => void {
  if (++holds === 1) onHeld.forEach((f) => f()); // other tabs learn of it (main.tsx: Web Lock)
  let held = true;
  return () => {
    if (!held) return;
    held = false;
    if (--holds === 0) setTimeout(() => { if (holds === 0) { reloadWhenFree(); onFree.forEach((f) => f()); } }); // after the job settles
  };
}

export const updatesHeld = (): boolean => holds > 0;
export const whenUpdatesFree = (f: () => void): void => { onFree.push(f); };
export const whenUpdatesHeld = (f: () => void): void => { onHeld.push(f); };

/** Holds updates while `on`: a sheet's running job, an import on the home screen. */
export function useHoldUpdates(on: boolean): void {
  useEffect(() => (on ? holdUpdates() : undefined), [on]);
}

// --- Other tabs (Web Locks, Safari 15.4+): a new version takes over every tab at once ---

const LOCK = 'kadr-working';
const mine = `${LOCK}:${Math.random().toString(36).slice(2)}`; // this tab's own lock: never mistaken for another tab's
let unlock: (() => void) | null = null;

/** Tells Kadr's other tabs whether this one is working (an editor open, a job running). */
export function shareWork(on: boolean): void {
  if (!('locks' in navigator)) return;
  if (on && !unlock) {
    let release!: () => void;
    const held = new Promise<void>((r) => { release = r; });
    unlock = release;
    void navigator.locks.request(mine, () => held).catch(() => undefined);
  } else if (!on && unlock) {
    unlock();
    unlock = null;
  }
}

/** Whether another tab of Kadr is working. */
export async function othersWorking(): Promise<boolean> {
  if (!('locks' in navigator)) return false;
  const { held = [] } = await navigator.locks.query().catch(() => ({ held: [] }));
  return held.some((l) => l.name !== mine && !!l.name?.startsWith(`${LOCK}:`));
}

// --- Reload into the new version after the code under this tab is gone ---

let pending = false;
let wanted = false;
let updated = false; // a newer version is known to be on the site (else a file just did not load)
let applier: (() => Promise<boolean>) | null = null;

/** A reload into a new version is on its way: error toasts say so instead of what failed on the way (store.toast). */
export const reloadPending = (): boolean => pending;

/**
 * How the page lets the waiting service worker in before it reloads (main.tsx). Without it a controlled tab would
 * reload into the old version again: the old worker answers the reload from its own cache.
 */
export const setUpdateApplier = (f: () => Promise<boolean>): void => { applier = f; };

/** What the person reads instead of the browser's words: the page reloads, or (the reload already tried) what to do. */
export function updatingMessage(): string {
  if (!pending) return t('Part of Kadr did not load. Check the connection and reload the page.');
  if (updated) return holds > 0 ? t('Kadr has been updated. The page reloads when the current job ends.') : t('Kadr has been updated. Reloading the page…');
  return holds > 0 ? t('Part of Kadr did not load. The page reloads when the current job ends.') : t('Part of Kadr did not load. Reloading the page…');
}

function reloadWhenFree() {
  if (!wanted || holds > 0) return;
  wanted = false;
  setTimeout(() => { // long enough to read the message
    if (holds > 0) { wanted = true; return; } // a job started meanwhile: after it (its release calls this again)
    try {
      sessionStorage.setItem(KEY, String(Date.now()));
      sessionStorage.setItem(NOTICE, updated ? 'updated' : 'reloaded');
    } catch { /* checked in reloadIntoUpdate */ }
    if (!applier) { location.reload(); return; }
    void applier().catch(() => false).then((applying) => { if (!applying) location.reload(); });
  }, 1200);
}

/**
 * Reloads into the new version once nothing is running, at most once a minute (a file that is gone for another
 * reason must not loop). `known`: a newer version is on the site. False: no reload is coming, the caller says what
 * failed. Safari never retries a module that failed to load in the same page, so a reload is the cure either way.
 */
export function reloadIntoUpdate(known = false): boolean {
  if (known) updated = true;
  if (pending) return true;
  if (!navigator.onLine) return false;
  try {
    if (Date.now() - Number(sessionStorage.getItem(KEY) ?? 0) < ONCE_MS) return false;
  } catch {
    return false; // without the guard a broken file could reload forever
  }
  pending = true;
  wanted = true;
  reloadWhenFree();
  return true;
}

/** Once, right after a reload into an update: the person is told to repeat what they tapped. */
export function takeUpdateNotice(): string | null {
  try {
    const why = sessionStorage.getItem(NOTICE);
    if (!why) return null;
    sessionStorage.removeItem(NOTICE);
    return why === 'updated' ? t('Kadr was updated. Please do that again.') : t('The page was reloaded. Please do that again.');
  } catch {
    return null;
  }
}

/**
 * Whether the site now serves another version than this tab runs: its index.html no longer names this tab's entry
 * script. For failures without a telling message (a worker script that is gone).
 */
export async function newerVersionDeployed(): Promise<boolean> {
  const entry = document.querySelector<HTMLScriptElement>('script[type="module"][src]')?.src.split('/').pop();
  if (!entry || !navigator.onLine) return false;
  try {
    // A query the service worker's precache does not know: the page from the network, not the one cached with this tab.
    const res = await fetch(`${import.meta.env.BASE_URL}index.html?version-check=${Date.now()}`, { cache: 'no-store', signal: AbortSignal.timeout(5000) });
    return res.ok && !(await res.text()).includes(entry);
  } catch {
    return false;
  }
}
