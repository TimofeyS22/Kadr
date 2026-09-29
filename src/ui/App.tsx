import { Component, Suspense, lazy, useEffect, useState, type ReactNode } from 'react';
import { track } from '../lib/telemetry';
import { useEditor } from '../state/store';
import { Home } from './Home';
import { t, useLocale } from '../lib/i18n';

// The editor (and the media engine) load on demand so the home screen starts fast.
const Editor = lazy(() => import('./Editor').then((m) => ({ default: m.Editor })));

function useProjectRoute(): string | null {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const onHash = () => setHash(location.hash);
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);
  return /^#\/p\/([\w-]+)$/.exec(hash)?.[1] ?? null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  override state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  override componentDidCatch(error: Error) { track('crash', { message: error.message.slice(0, 120) }); }
  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="center-msg">
        <p>{t('Something went wrong. Your project is saved on this device.')}</p>
        <p className="hint">{this.state.error.message}</p>
        <button className="btn primary" onClick={() => { location.hash = ''; location.reload(); }}>{t('Reload')}</button>
      </div>
    );
  }
}

function Toasts() {
  const toasts = useEditor((s) => s.toasts);
  const dismiss = useEditor((s) => s.dismiss);
  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <button key={t.id} className={`toast ${t.kind}`} onClick={() => dismiss(t.id)}>{t.text}</button>
      ))}
    </div>
  );
}

export function App() {
  const id = useProjectRoute();
  const locale = useLocale((s) => s.locale);
  useEffect(() => { document.documentElement.lang = locale; }, [locale]);
  return (
    <ErrorBoundary key={locale}>
      {id ? (
        <Suspense fallback={<div className="center-msg"><p>{t('Opening…')}</p></div>}><Editor key={id} id={id} /></Suspense>
      ) : <Home />}
      <Toasts />
    </ErrorBoundary>
  );
}
