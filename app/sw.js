/* Service worker: la app funciona sin conexión.
   Estrategia: recursos versionados y activación coordinada.
   Si cambias archivos, sube el número de versión de CACHE. */
const VERSION = '33';
const CACHE = 'kanbaya-pwa-v' + VERSION;
const ASSETS = [
  './', 'index.html', 'css/styles.css?v=33', 'scripts/boot.js?v=33', 'scripts/app.js?v=33',
  'scripts/storage.js?v=33', 'scripts/virtual.js?v=33', 'scripts/drive.js?v=33', 'vendor/dexie.min.js?v=33',
  'vendor/marked.umd.js?v=33', 'vendor/purify.min.js?v=33', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/apple-touch-icon.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});

self.addEventListener('message', e => {
  if (e.data?.type === 'VERSION') e.ports[0]?.postMessage({ version: VERSION });
  if (e.data?.type === 'ACTIVATE') e.waitUntil(self.skipWaiting());
});
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('kanbaya-pwa-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    if (req.mode === 'navigate') return (await cache.match('index.html')) || Response.error();
    const cached = await cache.match(req);
    if (cached) return cached;
    try { return await fetch(req); }
    catch (error) { console.warn('Kanbaya: resource unavailable offline', req.url, error); return Response.error(); }
  })());
});
