// Kadr opened inside another app (audit V-203): the built-in browser of Instagram, TikTok and the like cannot save a
// file, so the person hears it before making anything and gets the link to open in the phone's own browser. Only the
// link is copied: an Android "open in browser" link (intent://) depends on the app passing it on, and the one that
// does not shows an error page instead of Kadr.
import { useEffect, useRef, useState } from 'react';
import { IN_APP } from '../lib/device';
import { t } from '../lib/i18n';
import { track } from '../lib/telemetry';

const SEEN_KEY = 'kadr.inAppNotice';

/** Kadr's address without the project (a project made here is not in the other browser); a task link keeps its task. */
const siteLink = (): string => location.origin + location.pathname + (location.hash.startsWith('#/start/') ? location.hash : '');

/** Home hides the notice once dismissed, until the app's browser is closed. */
export function useInAppNotice(): { shown: boolean; dismiss(): void } {
  const [seen, setSeen] = useState(() => { try { return !!sessionStorage.getItem(SEEN_KEY); } catch { return false; } });
  return {
    shown: !!IN_APP && !seen,
    dismiss() {
      try { sessionStorage.setItem(SEEN_KEY, '1'); } catch { /* shown again after a reload */ }
      setSeen(true);
      track('in_app_notice_dismissed');
    },
  };
}

/** The notice itself; with `onDismiss` it gets a "Got it" button (Home), without it stays (the export sheet). */
export function InAppNotice({ onDismiss }: { onDismiss?: () => void }) {
  const [copied, setCopied] = useState(false);
  const [manual, setManual] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const link = siteLink();

  // The clipboard is missing or refused: the link is shown selected, and the old way of copying gets one try.
  useEffect(() => {
    const el = field.current;
    if (!manual || !el) return;
    el.focus();
    el.setSelectionRange(0, el.value.length);
    try { if (document.execCommand('copy')) setCopied(true); } catch { /* the person copies the selected link */ }
  }, [manual]);

  if (!IN_APP) return null;
  const copy = async () => {
    track('in_app_link_copy', { app: IN_APP?.app ?? 'web view' });
    try { await navigator.clipboard.writeText(link); setCopied(true); } catch { setManual(true); }
  };
  return (
    <div className="banner in-app" role="note">
      <p>
        {IN_APP.app ? t('This is the built-in browser of {app}: it cannot save videos.', { app: IN_APP.app }) : t('This is an app’s built-in browser: it cannot save videos.')}
        {' '}{IN_APP.browser === 'Safari' ? t('Open Kadr in Safari.') : IN_APP.browser === 'Chrome' ? t('Open Kadr in Chrome.') : t('Open Kadr in your browser.')}
      </p>
      {manual && <input ref={field} className="in-app-link" readOnly value={link} aria-label={t('Link to Kadr')} onFocus={(e) => e.currentTarget.setSelectionRange(0, link.length)} />}
      {manual && !copied && <p className="hint">{t('Press and hold the link to copy it.')}</p>}
      <div className="in-app-actions">
        <button className="btn primary" aria-live="polite" onClick={() => void copy()}>{copied ? t('Link copied') : t('Copy link')}</button>
        {onDismiss && <button className="btn" onClick={onDismiss}>{t('Got it')}</button>}
      </div>
    </div>
  );
}
