const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..', '..');
http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const requestPath = url.pathname.startsWith('/project/') ? url.pathname.slice('/project'.length) : url.pathname;
  if (requestPath === '/tests/blank' || requestPath === '/app/tests/blank') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>Test</title>'); return; }
  const pathname = requestPath === '/app/sw.js' && url.searchParams.has('legacy') ? '/app/tests/legacy-sw.js'
    : requestPath === '/sw.js' && url.searchParams.has('legacy-root') ? '/app/tests/legacy-root-sw.js' : requestPath;
  const file = path.resolve(root, '.' + decodeURIComponent(pathname).replaceAll('/', path.sep));
  if (file !== root && !file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const target = url.pathname.endsWith('/') ? path.join(file, 'index.html') : file;
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404).end(); return; }
    res.setHeader('Content-Type', ({ '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png' })[path.extname(target)] || 'application/octet-stream');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Service-Worker-Allowed', '/');
    res.end(data);
  });
}).listen(8765, '127.0.0.1');
