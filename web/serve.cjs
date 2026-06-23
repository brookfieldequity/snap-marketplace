// Minimal zero-dependency static server for the built SPA in dist/.
//
// Railway's default (Railpack) static serving sends no Cache-Control header, so
// browsers heuristically cache index.html and keep loading the OLD hashed
// bundle after every deploy — users only see new code after a hard refresh.
//
// This serves:
//   /assets/*  → Cache-Control: public, max-age=1y, immutable  (content-hashed)
//   everything else (index.html / SPA routes) → no-cache       (always revalidate)
// with SPA fallback to index.html.
//
// Uses ONLY Node built-ins so it can never fail on a missing dependency
// (vite is a devDependency and is pruned in production — that's what broke the
// earlier `vite preview` start command).

const http = require('http');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, 'dist');
const PORT = parseInt(process.env.PORT, 10) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer((req, res) => {
  try {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    const safe = path.normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const isAsset = safe.startsWith('/assets/');

    let filePath = path.join(DIST, safe);
    // Guard against path traversal outside dist/.
    if (!filePath.startsWith(DIST)) filePath = path.join(DIST, 'index.html');

    let stat = null;
    try { stat = fs.statSync(filePath); } catch { stat = null; }
    // SPA fallback: unknown path or directory → index.html.
    if (!stat || stat.isDirectory()) filePath = path.join(DIST, 'index.html');

    const ext = path.extname(filePath).toLowerCase();
    const data = fs.readFileSync(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': isAsset
        ? 'public, max-age=31536000, immutable'
        : 'no-cache, no-store, must-revalidate',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal error');
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[serve] SPA static server listening on :${PORT} (dist=${DIST})`);
});
