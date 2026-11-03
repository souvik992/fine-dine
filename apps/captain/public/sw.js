/* global self, caches */
// DinePOS Captain service worker (P3-01): keeps the app itself available when the shop Wi-Fi blips. Data (orders,
// menu) always comes from the outlet server; the offline outbox arrives in P3-03.
const CACHE = 'dinepos-captain-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(['/captain/', '/captain/manifest.webmanifest', '/captain/icon.svg'])));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || !url.pathname.startsWith('/captain/')) return; // never the API
  // Pages: network first (new versions show at once), the cached shell when offline. Assets: cache first.
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/captain/')));
    return;
  }
  event.respondWith(
    caches.match(event.request).then(
      (hit) =>
        hit ??
        fetch(event.request).then((res) => {
          if (res.ok && url.pathname.startsWith('/captain/assets/')) {
            const copy = res.clone(); // before the page reads the body
            caches.open(CACHE).then((c) => c.put(event.request, copy));
          }
          return res;
        }),
    ),
  );
});
