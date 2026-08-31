/* ─────────────────────────────────────────────────────────────────────────
   Service worker for /academy.

   The programme has to work on a train, on a phone, in a data centre with no
   signal — so the entire application shell and the whole curriculum are
   precached on first visit. Progress lives in localStorage, which is already
   local, so nothing else needs to be online.

   Strategy:
     - Navigations: serve the cached shell immediately, refresh it in the
       background. The app is a single hash-routed page, so one shell serves
       every route.
     - Same-origin assets: cache-first, because every file is precached and the
       cache name changes whenever any of them does.
     - Cross-origin (fonts): left to the network. They are progressive
       enhancement; the CSS declares real fallback stacks.

   Bump CACHE whenever a precached file changes, or returning visitors keep the
   old copy until they clear site data.
   ───────────────────────────────────────────────────────────────────────── */
const CACHE = 'aicip-v1';

const SHELL = [
  './',
  './index.html',
  './app.css',
  './app.js',
  './curriculum.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      // addAll is atomic: one 404 would leave the app half-cached and broken
      // offline, so a failed install is the correct outcome.
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts and anything else: network only

  if (req.mode === 'navigate') {
    event.respondWith(
      caches.match('./index.html').then((cached) => {
        const fresh = fetch(req)
          .then((res) => {
            if (res && res.ok) caches.open(CACHE).then((c) => c.put('./index.html', res.clone()));
            return res;
          })
          .catch(() => cached);
        return cached || fresh;
      })
    );
    return;
  }

  event.respondWith(
    caches.match(req).then(
      (cached) =>
        cached ||
        fetch(req)
          .then((res) => {
            if (res && res.ok && res.type === 'basic') {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
          .catch(() => cached)
    )
  );
});
