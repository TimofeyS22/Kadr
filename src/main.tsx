import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/900.css';
import '@fontsource/anton/400.css';
import '@fontsource/bebas-neue/400.css';
import '@fontsource/pacifico/400.css';
import '@fontsource/playfair-display/400.css';
import '@fontsource/playfair-display/700.css';
import './ui/styles.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import { loadFonts } from './engine/text';
import { errorMessage, track } from './lib/telemetry';
import { App } from './ui/App';

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

window.addEventListener('unhandledrejection', (e) => {
  track('unhandled_rejection', { message: errorMessage(e.reason).slice(0, 120) });
  console.error(e.reason);
});

if (import.meta.env.PROD) registerSW({ immediate: true });
