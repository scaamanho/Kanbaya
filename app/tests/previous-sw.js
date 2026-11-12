const VERSION = '27';
const CACHE = 'kanbaya-pwa-v' + VERSION;
const SCRIPTS = ['vendor/dexie.min.js', 'vendor/marked.umd.js', 'vendor/purify.min.js', 'scripts/storage.js', 'scripts/virtual.js', 'scripts/drive.js', 'scripts/app.js'];
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const html = await fetch('/app/index.html');
    await cache.put('/app/index.html', new Response((await html.text()).replace(/v=\d+/g, 'v=' + VERSION), {
      headers: { 'Content-Type': 'text/html' }
    }));
    const boot = await fetch('/app/scripts/boot.js');
    await cache.put('/app/scripts/boot.js?v=' + VERSION, new Response((await boot.text()).replace(/const VERSION = '\d+';/, `const VERSION = '${VERSION}';`), {
      headers: { 'Content-Type': 'text/javascript' }
    }));
    for (const asset of ['css/styles.css', ...SCRIPTS]) {
      const response = await fetch('/app/' + asset);
      if (!response.ok) throw new Error('Could not cache previous asset: ' + asset);
      await cache.put('/app/' + asset + '?v=' + VERSION, response);
    }
    await self.skipWaiting();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'VERSION') event.ports[0]?.postMessage({ version: VERSION });
});
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => {
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (event.request.mode === 'navigate') return cache.match('/app/index.html');
    return await cache.match(event.request) || fetch(event.request);
  })());
});
