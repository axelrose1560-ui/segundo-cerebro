const CACHE_NAME = 'segundo-cerebro-v6';
const ASSETS = ['/', '/index.html', '/style.css', '/app.js', '/manifest.json'];

self.addEventListener('install', e => {
    e.waitUntil(caches.open(CACHE_NAME).then(c => c.addAll(ASSETS)));
    self.skipWaiting();
});

self.addEventListener('activate', e => {
    e.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', e => {
    if (e.request.url.includes('googleapis.com')) {
        e.respondWith(fetch(e.request));
        return;
    }
    e.respondWith(
        caches.match(e.request).then(cached => cached || fetch(e.request))
    );
});
