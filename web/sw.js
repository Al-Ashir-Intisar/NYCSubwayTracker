// Offline shell for the web app. The build fills in the version and file list. Pages load
// network first so a deploy shows up on the next open; app files and GTFS tables load from
// the cache so the app starts fast on a weak signal. Live feeds (/api/) are never cached here.
const CACHE_NAME = 'nyc-transit-__BUILD_VERSION__';
const PRECACHE_FILES = __PRECACHE_FILES__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(PRECACHE_FILES))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names
      .filter((name) => name.startsWith('nyc-transit-') && name !== CACHE_NAME)
      .map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match('./')));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
