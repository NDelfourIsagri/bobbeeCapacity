const CACHE = 'bobbee-v1';
const SHELL = [
  '/bobbeeCapacity/',
  '/bobbeeCapacity/assets/css/app.css',
  '/bobbeeCapacity/assets/js/app.js',
  '/bobbeeCapacity/assets/img/favicon.svg',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
