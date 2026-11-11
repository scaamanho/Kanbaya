const CACHE = 'kanbaya-pwa-v23';
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const response = await fetch('/app/index.html');
    const html = (await response.text()).replaceAll('v=27', 'v=23');
    await cache.put('/index.html', new Response(html, { headers: { 'Content-Type': 'text/html' } }));
    await self.skipWaiting();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'VERSION') event.ports[0]?.postMessage({ version: '23' });
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  if (event.request.mode === 'navigate') event.respondWith(caches.match('/index.html'));
});
