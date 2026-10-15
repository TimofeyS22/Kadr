// "Install Kadr" (docs/08 B): on Android the share sheet lists only installed PWAs, so Kadr offers installing itself
// where the browser allows it (beforeinstallprompt; Chromium). Captured at startup: the event can fire before Home.
import { useEffect, useState } from 'react';
import { track } from '../lib/telemetry';

interface InstallEvent extends Event { prompt(): Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((f) => f());

window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); deferred = e as InstallEvent; notify(); });
window.addEventListener('appinstalled', () => { deferred = null; track('pwa_installed'); notify(); });

/** A function that shows the browser's install dialog, or null where installing is not offered. */
export function useInstall(): (() => Promise<void>) | null {
  const [, tick] = useState(0);
  useEffect(() => { const f = () => tick((n) => n + 1); listeners.add(f); return () => { listeners.delete(f); }; }, []);
  if (!deferred) return null;
  const e = deferred;
  return async () => {
    track('pwa_install_prompted');
    await e.prompt();
    const { outcome } = await e.userChoice;
    track('pwa_install_choice', { outcome });
    if (outcome === 'accepted') { deferred = null; notify(); }
  };
}
