'use strict';

// Keep the active v2 cache outside the frozen production worker's historical
// `lexi-spend-v*` cleanup namespace. The legacy prefix below is v2-owned and is
// removed once during this cutover so old preview shells do not linger.
const CACHE_PREFIX = 'lexi-spend2-';
const LEGACY_CACHE_PREFIX = 'lexi-spend-v2-';
const CACHE_NAME = `${CACHE_PREFIX}shell-v44`;
const SHELL = [
  './',
  './index.html',
  './styles.css',
  './theme.css',
  './track.css',
  './api.js',
  './app.js',
  './track.js',
  './manifest.webmanifest'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(
      SHELL.map(path => new Request(new URL(path, self.location.href), { cache:'reload' }))
    ))
  );
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys
        .filter(key => (
          (key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME) ||
          key.startsWith(LEGACY_CACHE_PREFIX)
        ))
        .map(key => caches.delete(key))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (!url.pathname.startsWith('/lexi-spend/v2/')) return;

  event.respondWith((async () => {
    // The install step caches one complete release. Serve that release
    // immediately; a slow but connected network must not stall every launch.
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const shell = await cache.match('./index.html');
      if (shell) return shell;
    }
    try {
      const response = await fetch(request, { cache:'no-store' });
      if (response && response.ok) {
        cache.put(request, response.clone()).catch(() => {});
      }
      return response;
    } catch (_) {
      if (request.mode === 'navigate') {
        const fallback = await cache.match('./index.html');
        if (fallback) return fallback;
      }
      throw _;
    }
  })());
});
