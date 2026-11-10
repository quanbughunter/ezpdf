/**
 * The web app's "Có bản mới · Cập nhật" (0.8.9). The service worker
 * (build/sw-template.js) installs a new version in the background and takes
 * over at once, but a page that is already open keeps running its own
 * version. This tells the page when a newer one is there, and reloads it
 * into that version when the user taps "Cập nhật" at the foot of the start
 * screen. The desktop app and the Android app have no service worker and
 * never show it: they update with a new installer.
 */
import { useSyncExternalStore } from 'react';

export type WebUpdate =
  | { kind: 'none' }
  /** a newer version is there; `version` as the worker tells it ("0.8.9"), null if it does not say */
  | { kind: 'ready'; version: string | null }
  | { kind: 'reloading' };

let state: WebUpdate = { kind: 'none' };
const listeners = new Set<() => void>();
const set = (next: WebUpdate) => {
  state = next;
  for (const l of listeners) l();
};

export function useWebUpdate(): WebUpdate {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
  );
}

/** a worker that has not taken over yet (one from before 0.8.9 waits for every tab to close) */
let waiting: ServiceWorker | null = null;
let reloading = false;

/** what version a worker carries ("0.8.9"); null when it does not answer (older workers) */
function askVersion(worker: ServiceWorker | null): Promise<string | null> {
  return new Promise((resolve) => {
    if (!worker) return resolve(null);
    const channel = new MessageChannel();
    const timer = setTimeout(() => resolve(null), 3000);
    channel.port1.onmessage = (e) => {
      clearTimeout(timer);
      resolve(typeof e.data === 'string' ? e.data : null);
    };
    try {
      worker.postMessage({ type: 'version' }, [channel.port2]);
    } catch {
      clearTimeout(timer);
      resolve(null);
    }
  });
}

async function offer(worker: ServiceWorker | null, stillWaiting: boolean) {
  waiting = stillWaiting ? worker : null;
  const version = await askVersion(worker);
  if (state.kind === 'reloading') return;
  set({ kind: 'ready', version });
}

/** how often a page that stays open (a phone keeps the app for days) looks for a new version */
const LOOK_EVERY = 10 * 60 * 1000;

/** Called once on the web, with the page's service worker registration. */
export function watchForUpdates(reg: ServiceWorkerRegistration) {
  const sw = navigator.serviceWorker;
  // on a first visit the page is already the newest: the worker taking it over is no update
  const hadWorker = !!sw.controller;
  if (reg.waiting && hadWorker) void offer(reg.waiting, true);
  reg.addEventListener('updatefound', () => {
    const w = reg.installing;
    w?.addEventListener('statechange', () => {
      if (w.state === 'installed' && sw.controller) void offer(w, true);
    });
  });
  sw.addEventListener('controllerchange', () => {
    if (reloading) return location.reload();
    if (hadWorker) void offer(sw.controller, false);
  });
  let last = Date.now();
  const look = () => {
    if (document.visibilityState !== 'visible' || Date.now() - last < LOOK_EVERY) return;
    last = Date.now();
    reg.update().catch(() => {});
  };
  document.addEventListener('visibilitychange', look);
  setInterval(look, LOOK_EVERY);
}

/** "Cập nhật": this page into the new version, without closing it */
export function applyUpdate() {
  set({ kind: 'reloading' });
  if (waiting && waiting.state === 'installed') {
    // the reload comes with the worker taking over (controllerchange above)
    reloading = true;
    waiting.postMessage({ type: 'skip-waiting' });
    setTimeout(() => location.reload(), 5000);
  } else {
    location.reload();
  }
}
