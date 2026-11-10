/*
 * ezPDF service worker: makes the installed web app open with no network.
 *
 * It only ever answers same-origin GET requests from its own cache, filled
 * at install with every file of this build (the list below is written by
 * build/pwa.ts). It never sends anything anywhere: documents are opened and
 * saved by the page itself, on this device.
 *
 * A new version installs in the background and takes over at once (0.8.9;
 * before, it waited for every ezPDF tab to close, and reloading a page never
 * brought it). A page that is already open keeps running its own version:
 * the files of the version just replaced stay cached for it, and the page
 * offers "Cập nhật" at the foot of its start screen (src/app/web-update.ts),
 * which reloads it into the new one.
 */
const VERSION = '__EZPDF_VERSION__';
/** the version people see ("0.8.9"), told to a page that asks */
const APP_VERSION = '__EZPDF_APP__';
const FILES = __EZPDF_FILES__;
const CACHE = `ezpdf-${VERSION}`;
const scoped = (f) => new URL(f, self.registration.scope).href;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(FILES.map((f) => new Request(scoped(f), { cache: 'reload' })));
      // every file is here: take over now, without waiting for the open tabs to close
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // keep the version this one replaces (the newest other cache: tabs still open on it load
      // their code from there), drop anything older
      const older = (await caches.keys()).filter((key) => key.startsWith('ezpdf-') && key !== CACHE);
      for (const key of older.slice(0, -1)) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', (event) => {
  const type = event.data && event.data.type;
  if (type === 'version' && event.ports[0]) event.ports[0].postMessage(APP_VERSION);
  // a page asks a worker still waiting (one from before 0.8.9 never takes over by itself)
  else if (type === 'skip-waiting') self.skipWaiting();
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
      // ignoreVary: the build server may answer with "Vary: Origin", module scripts send an Origin.
      // Not in this version: a tab still running the previous version asks for its own files
      const opts = { ignoreSearch: true, ignoreVary: true };
      return (await cache.match(req, opts)) ?? (await caches.match(req, opts)) ?? fetch(req);
    })(),
  );
});
