import './fonts';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { loadFonts } from './engine/text';
import { errorMessage, track } from './lib/telemetry';
import { holdUpdates, newerVersionDeployed, othersWorking, reloadIntoUpdate, setUpdateApplier, shareWork, takeUpdateNotice, updatesHeld, whenUpdatesFree, whenUpdatesHeld } from './lib/update';
import { useEditor } from './state/store';
import { App } from './ui/App';
import { keepError } from './lib/errorLog';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Text is rasterized on canvas, so re-render once the bundled fonts are ready.
void loadFonts().then(async () => {
  const { player } = await import('./engine/player');
  player.text.clear();
  player.requestRender();
});

// A lazy chunk this tab's code needs did not load — usually a deploy replaced the site (docs/12, deploy skew). Safari
// never retries a failed module in the same page, so the page reloads once nothing is running; the failing action
// says so (errorMessage), and "Kadr has been updated" once the site is seen to have a newer version.
window.addEventListener('vite:preloadError', () => {
  if (reloadIntoUpdate()) void newerVersionDeployed().then((updated) => { if (updated) reloadIntoUpdate(true); });
});
const notice = takeUpdateNotice();
if (notice) useEditor.getState().toast(notice, 'info', 8000);

// The editor's busy overlay (import, reverse, sound sync…) is work a reload would lose.
let busyHold: (() => void) | null = null;
useEditor.subscribe((s) => {
  if (s.busy && !busyHold) busyHold = holdUpdates();
  else if (!s.busy && busyHold) { busyHold(); busyHold = null; }
});

window.addEventListener('unhandledrejection', (e) => {
  track('unhandled_rejection', { message: errorMessage(e.reason).slice(0, 120) });
  keepError(e.reason, 'page'); // kept on this device for "Details" and ?diag (lib/errorLog.ts)
  console.error(e.reason);
});
window.addEventListener('error', (e) => { if (e.error) keepError(e.error, 'page'); });

// A new version never replaces the running one under the person's hands (docs/12): 'autoUpdate' reloaded the page
// the moment a new service worker took over, mid-export included, and the new worker deleted the old files from the
// cache under every open tab. The new worker waits. It takes over once no tab of Kadr is working (an editor open, a
// job running); a tab that is working when it does reloads into it later, at its own safe moment.
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  let waiting = false; // a new version is installed and waits
  let reload = false; // it took over, from this tab or another one: this page reloads into it
  let force = false; // the code under this tab is gone (lib/update.ts): the new version comes in even in the editor
  let retry: ReturnType<typeof setTimeout> | undefined;
  const controlled = !!navigator.serviceWorker.controller;
  const working = () => updatesHeld() || (!force && /^#\/(p\/|share$)/.test(location.hash));
  const sync = async () => {
    const here = working();
    shareWork(here);
    if (here) return;
    if (reload) { reload = false; location.reload(); return; }
    if (!waiting) return;
    if (!force && await othersWorking()) { clearTimeout(retry); retry = setTimeout(() => void sync(), 30_000); return; }
    if (!waiting || working()) return;
    waiting = false;
    void updateSW(true);
  };
  const updateSW = registerSW({
    immediate: true,
    onNeedRefresh() { waiting = true; void sync(); },
    // Instead of vite-plugin-pwa's immediate reload.
    onNeedReload() { reload = true; void sync(); },
    onRegisteredSW(_url, reg) {
      if (!reg) return;
      // Long-lived tabs (a PWA kept open for days) look for a new version when they come back and every hour. A
      // worker that finished installing before workbox-window listened (a slow start) is found here too.
      const check = () => {
        if (reg.waiting && navigator.serviceWorker.controller) { waiting = true; void sync(); }
        else if (navigator.onLine) void reg.update().catch(() => undefined);
      };
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') check(); });
      setInterval(check, 3_600_000);
      // The code under this tab is gone: a plain reload would get the old version again from the old worker's cache,
      // so the new worker is found (or waited for) and let in first; the page reloads when it takes over.
      setUpdateApplier(async () => {
        if (!navigator.serviceWorker.controller) return false; // not controlled: a plain reload loads the new version
        if (!reg.waiting) {
          await reg.update().catch(() => undefined);
          await new Promise<void>((resolve) => {
            const poll = setInterval(() => { if (reg.waiting) end(); }, 250);
            const limit = setTimeout(() => end(), 15_000); // its files download first
            const end = () => { clearInterval(poll); clearTimeout(limit); resolve(); };
          });
        }
        if (!reg.waiting) return false;
        force = true;
        reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        setTimeout(() => location.reload(), 5000); // it never took over: reload anyway
        return true;
      });
    },
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (controlled) { reload = true; void sync(); } });
  window.addEventListener('hashchange', () => void sync());
  whenUpdatesFree(() => void sync());
  whenUpdatesHeld(() => void sync());
  void sync();
}
