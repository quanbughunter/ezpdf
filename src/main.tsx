import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { App } from './app/App';
import { detectPlatform } from './platform';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Installed web app: keep every file of this version on the device so ezPDF
// opens without a network (build/sw-template.js). Not used inside the
// desktop and Android apps, which ship their files.
if (import.meta.env.PROD && import.meta.env.MODE !== 'shots' && detectPlatform() === 'web' && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`, { scope: import.meta.env.BASE_URL }).catch((e) => {
      console.warn('ezPDF: offline mode unavailable', e);
    });
  });
}

// Device screenshots on GitHub's iPhone simulator (vite build --mode shots,
// scripts/device-shots.cjs): never part of the app's own builds.
if (import.meta.env.MODE === 'shots') void import('./shots');
