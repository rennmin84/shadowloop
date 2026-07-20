/* =========================================================
   Shadowloop service worker — network-first
   Keeps the phone up to date automatically: whenever it's
   online it fetches the latest files (bypassing the HTTP
   cache), and only falls back to the cache when offline.
   No version bumping needed — pushes show up on next open.
   ========================================================= */

const CACHE = 'shadowloop';

const ASSETS = [
  './',
  './index.html',
  './app.js',
  './style.css',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

// Install: pre-cache the shell, take over immediately.
self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(ASSETS)).catch(() => {})
  );
});

// Activate: drop any stale caches, start controlling open pages.
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Fetch: same-origin GETs go network-first (fresh when online,
// cache when offline). Everything else (YouTube, fonts) is left
// untouched so it hits the network directly.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  if (new URL(req.url).origin !== self.location.origin) return;

  e.respondWith((async () => {
    try {
      // cache:'reload' bypasses the browser HTTP cache so we always
      // get the freshest bytes from the server.
      const fresh = await fetch(req, { cache: 'reload' });
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch {
      const cached = await caches.match(req);
      return cached || caches.match('./index.html');
    }
  })());
});
