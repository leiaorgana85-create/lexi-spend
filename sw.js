const CACHE = 'lexi-spend-v16';
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './bridge-state.js',
  './bridge-auth.js',
  './bridge-call.js',
  './bridge-runtime.js',
  './bridge-settings.js',
  './spend-ui.css',
  './spend-ui.js',
  './payload/part1a.txt',
  './payload/part1b.txt',
  './payload/part2a.txt',
  './payload/part2b.txt',
  './payload/part3aa.txt',
  './payload/part3ab.txt',
  './payload/part3b.txt',
  './payload/part4a.txt',
  './payload/part4b.txt',
  './payload/part5a.txt',
  './payload/part5b.txt'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)));
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then(response => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then(cache => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
