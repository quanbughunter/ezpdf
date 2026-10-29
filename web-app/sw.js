/*
 * ezPDF service worker: makes the installed web app open with no network.
 *
 * It only ever answers same-origin GET requests from its own cache, filled
 * at install with every file of this build (the list below is written by
 * build/pwa.ts). It never sends anything anywhere: documents are opened and
 * saved by the page itself, on this device.
 *
 * A new version installs in the background and takes over once every ezPDF
 * tab or window has been closed, so a page never mixes two versions.
 */
const VERSION = '204a7c901223e9f0';
const FILES = [
  "assets/android-HpP7qE78.js",
  "assets/direct-engine-xMK6Xe8C.js",
  "assets/export.worker-DGPctb6k.js",
  "assets/file-tree-BEBBYhcE.js",
  "assets/index-BIUyk9vv.js",
  "assets/index-DrSHXdoe.css",
  "assets/pdfium-BJ2Yip8Q.wasm",
  "assets/tauri-CYMu92Hx.js",
  "assets/web-ULomFwBS.js",
  "fonts/ezSansVN-Bold.ttf",
  "fonts/ezSansVN-Regular.ttf",
  "icons/apple-touch-180.png",
  "icons/favicon-32.png",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/maskable-512.png",
  "index.html",
  "manifest.webmanifest"
];
const CACHE = `ezpdf-${VERSION}`;
const scoped = (f) => new URL(f, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(FILES.map((f) => new Request(scoped(f), { cache: 'reload' })))),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith('ezpdf-') && key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || !url.href.startsWith(self.registration.scope)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      if (req.mode === 'navigate') {
        // Every page of the app is the same shell.
        return (await cache.match(scoped('index.html'), { ignoreVary: true })) ?? fetch(req);
      }
      // ignoreVary: the build server may answer with "Vary: Origin", module scripts send an Origin
      return (await cache.match(req, { ignoreSearch: true, ignoreVary: true })) ?? fetch(req);
    })(),
  );
});
