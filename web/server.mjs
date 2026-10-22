// Static server for the SDC Tracker frontend. No build step and no packages.
// It only serves files inside web/ that match an allowlist, never .env or data/.
import { createServer } from 'node:http';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const webRoot = dirname(fileURLToPath(import.meta.url));
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function collectFiles(root) {
  const files = new Map();
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue;
      const full = join(dir, name);
      const rel = relative(root, full).split(sep).join('/');
      if (statSync(full).isDirectory()) {
        if (rel === 'e2e') continue; // walkthrough scripts are not part of the site
        walk(full);
      } else if (TYPES[extname(name)] && name !== 'server.mjs') {
        files.set('/' + rel, full);
      }
    }
  };
  walk(root);
  files.set('/', join(root, 'index.html'));
  return files;
}

export function parseApiBase(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error(`API_BASE must be a plain origin like http://127.0.0.1:3000, got ${value}`);
  }
  return url.origin;
}

export function createWebServer({ apiBase = 'http://127.0.0.1:3000', devChinese = false, root = webRoot } = {}) {
  const origin = parseApiBase(apiBase);
  const files = collectFiles(root);
  const configJs = `window.SDC_CONFIG = Object.freeze(${JSON.stringify({ apiBase: origin, devChinese: Boolean(devChinese) })});\n`;
  const csp = [
    "default-src 'none'",
    "script-src 'self'",
    "style-src 'self' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com',
    "img-src 'self' data:",
    `connect-src ${origin}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');

  return createServer((req, res) => {
    const headers = {
      'Content-Security-Policy': csp,
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'X-Frame-Options': 'DENY',
      'Cache-Control': 'no-store',
    };
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { ...headers, Allow: 'GET, HEAD', 'Content-Type': 'text/plain' });
      res.end('Method not allowed');
      return;
    }
    let pathname;
    try { pathname = new URL(req.url, 'http://local').pathname; } catch { pathname = ''; }
    if (pathname === '/config.js') {
      res.writeHead(200, { ...headers, 'Content-Type': TYPES['.js'] });
      res.end(req.method === 'HEAD' ? undefined : configJs);
      return;
    }
    const file = files.get(pathname);
    if (!file) {
      res.writeHead(404, { ...headers, 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const body = readFileSync(file);
    res.writeHead(200, { ...headers, 'Content-Type': TYPES[extname(file)] });
    res.end(req.method === 'HEAD' ? undefined : body);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const host = process.env.WEB_HOST || '127.0.0.1';
  const port = Number(process.env.WEB_PORT || 5173);
  const apiBase = process.env.API_BASE || 'http://127.0.0.1:3000';
  const server = createWebServer({ apiBase, devChinese: process.env.DEV_CHINESE === '1' });
  server.listen(port, host, () => {
    const self = `http://${host.includes(':') ? `[${host}]` : host}:${port}`;
    console.log(`SDC Tracker web: ${self}`);
    console.log(`Backend API:     ${apiBase}`);
    console.log(`Start the backend with CORS_ORIGINS=${self} (add http://localhost:${port} too if you open that address).`);
  });
}
