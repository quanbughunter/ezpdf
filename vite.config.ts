import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { ezpdfPwa } from './build/pwa';

/** shown at the top of the app (src/app/app-version.tsx): the version in package.json */
const version: string = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8')).version;

/**
 * Modes:
 *   vite build                  web app (PWA, Content-Security-Policy in the page)
 *   vite build --mode desktop   frontend of the Tauri app (src-tauri sets the CSP)
 *   vite build --mode android   frontend of the Capacitor app
 */
export default defineConfig({
  base: './',
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [react(), tailwindcss(), ezpdfPwa()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  worker: { format: 'es' },
  build: { target: 'es2022', chunkSizeWarningLimit: 2000 },
  optimizeDeps: { exclude: ['@embedpdf/pdfium'] },
});
