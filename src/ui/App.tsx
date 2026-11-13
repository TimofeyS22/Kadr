import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, X } from 'lucide-react';
import { track } from '../lib/telemetry';
import { useEditor } from '../state/store';
import { Home } from './Home';
import { t, useLocale } from '../lib/i18n';
import { ErrorDetails } from './ErrorDetails';
import { Button } from './ck/controls';
import './stage.css';
import { keepError } from '../lib/errorLog';

// The editor (and the media engine) load on demand so the home screen starts fast.
const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));
// Diagnostics for a phone (docs/12 stage 0): only with `?diag` in the address.
const Diag = lazy(() => import('./Diag').then((m) => ({ default: m.Diag })));
const diag = new URLSearchParams(location.search).has('diag');
// Template check (v1.5): every caption and text template drawn by this device, only with `?styles` in the address.
const StylesCheck = lazy(() => import('./StylesCheck').then((m) => ({ default: m.StylesCheck })));
const styles = new URLSearchParams(location.search).has('styles');
// The gallery of the Chetko design system (docs/17 stage Ч2): tokens as this device draws them, only with `?ds`.
const DesignSystem = lazy(() => import('./DesignSystem').then((m) => ({ default: m.DesignSystem })));
const ds = new URLSearchParams(location.search).has('ds');

function useProjectRoute(): string | null {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    let shown = location.hash;
    const onHash = () => {
      // The system Back closes the open sheet first, as the Done button would, warning about work it would lose. Before,
      // it left the editor under the sheet: long jobs went on with nowhere to report (audit V-226).
      const s = useEditor.getState();
      if (s.project && s.sheet && !location.hash.startsWith('#/p/')) {
        history.pushState(null, '', shown);
        s.closeSheet();
        return;
      }
      shown = location.hash;
      setHash(shown);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return /^#\/p\/([\w-]+)$/.exec(hash)?.[1] ?? null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error) { track('crash', { message: error.message.slice(0, 120) }); keepError(error, 'screen'); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-msg ck-center" role="alert">
        <CircleAlert aria-hidden />
        <p>{t('Something went wrong. Your project is saved on this device.')}</p>
        <p className="ck-hint">{this.state.error.message}</p>
        <Button variant="primary" size="large" onClick={() => { location.hash = ''; location.reload(); }}>{t('Reload')}</Button>
      </div>
    );
  }
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismiss);
  const keep = useEditor((s) => s.keep);
  return (
    // Chetko (Ч4 release 8): a dark plate; a failure is a white ring and a sign, never red (DESIGN.md §2.3). Where they stand
    // and how long they stay is as before: nothing moves silently.
    <div className="toasts ck-apptoasts" role="status" aria-live="polite">
      {toasts.map((x) => (x.detail ? (
        <div key={x.id} className={`toast ${x.kind} with-detail ck-apptoast`} data-tone={x.kind}>
          <div className="ck-apptoast-row">
            <button type="button" className="toast-text ck-apptoast-text" onClick={() => dismiss(x.id)}>{x.kind === 'error' && <CircleAlert aria-hidden />}{x.text}</button>
            <button type="button" className="ck-apptoast-close" aria-label={t('Close')} onClick={() => dismiss(x.id)}><X aria-hidden /></button>
          </div>
          {/* Kept open by Details, it is closed by the same cross: one «Close», not two of one name (release 8). */}
          {x.kept ? <ErrorDetails entry={x.detail} /> : <button type="button" className="toast-more ck-apptoast-more" onClick={() => keep(x.id)}>{t('Details')}</button>}
        </div>
      ) : x.kind === 'error' ? (
        <div key={x.id} className={`toast ${x.kind} ck-apptoast`} data-tone={x.kind}>
          <div className="ck-apptoast-row">
            <button type="button" className="toast-text ck-apptoast-text" onClick={() => dismiss(x.id)}><CircleAlert aria-hidden />{x.text}</button>
            <button type="button" className="ck-apptoast-close" aria-label={t('Close')} onClick={() => dismiss(x.id)}><X aria-hidden /></button>
          </div>
        </div>
      ) : (
        // A plain toast is the plate itself (not `ck-apptoast-text`, which is the bare words inside a failure's row).
        <button type="button" key={x.id} className={`toast ${x.kind} ck-apptoast`} data-tone={x.kind} onClick={() => dismiss(x.id)}>{x.text}</button>
      )))}
    </div>
  );
}

export function App() {
  const id = useProjectRoute();
  const locale = useLocale((s) => s.locale);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return (
    <ErrorBoundary key={locale}>
      {diag ? (
        <Suspense fallback={<div className="center-msg ck-center"><p>{t('Opening…')}</p></div>}><Diag /></Suspense>
      ) : styles ? (
        <Suspense fallback={<div className="center-msg ck-center"><p>{t('Opening…')}</p></div>}><StylesCheck /></Suspense>
      ) : ds ? (
        <Suspense fallback={<div className="center-msg ck-center"><p>{t('Opening…')}</p></div>}><DesignSystem /></Suspense>
      ) : id ? (
        <Suspense fallback={<div className="center-msg ck-center"><p>{t('Opening…')}</p></div>}><Editor key={id} id={id} /></Suspense>
      ) : <Home />}
      <Toasts />
    </ErrorBoundary>
  );
}
