const CACHE = 'kanbaya-pwa-v4';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await cache.add('/app/index.html');
    await cache.put('/app/app.js', new Response('throw new Error("Mixed legacy app must not execute");', { headers: { 'Content-Type': 'text/javascript' } }));
    await self.skipWaiting();
  })());
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    return await cache.match(event.request, { ignoreSearch: true }) || fetch(event.request);
  })());
});
