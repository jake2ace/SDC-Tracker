import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import { openDatabase } from './database.js';
import { HttpError, requireCondition } from './errors.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assets = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/styles.css', ['styles.css', 'text/css; charset=utf-8']],
  ['/app.js', ['app.js', 'text/javascript; charset=utf-8']]
]);
const SESSION_COOKIE = 'sdc_session';

function sessionToken(req) {
  const cookie = (req.headers.cookie ?? '').split(';').map(item => item.trim())
    .find(item => item.startsWith(`${SESSION_COOKIE}=`));
  return cookie ? cookie.slice(SESSION_COOKIE.length + 1) : null;
}

async function readBody(req) {
  requireCondition((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() === 'application/json',
    415, 'JSON_REQUIRED', 'Use Content-Type: application/json.');
  let size = 0; const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    requireCondition(size <= 8192, 413, 'BODY_TOO_LARGE', 'Request body exceeds 8 KB.');
    chunks.push(chunk);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpError(400, 'INVALID_JSON', 'Request body must contain valid JSON.'); }
  requireCondition(body && typeof body === 'object' && !Array.isArray(body), 400, 'INVALID_BODY', 'Request body must be an object.');
  return body;
}

function validCsrf(expected, supplied) {
  return typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied) && supplied.length === expected.length &&
    timingSafeEqual(Buffer.from(expected), Buffer.from(supplied));
}

export function createApplication({
  dbPath = process.env.DB_PATH || join(root, 'data', 'sdc-tracker.sqlite'),
  demoMode = process.env.DEMO_MODE !== 'false',
  secureCookies = process.env.COOKIE_SECURE === '1'
} = {}) {
  const database = openDatabase(dbPath);
  const cookie = (token, maxAge = 28800) => `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secureCookies ? '; Secure' : ''}`;

  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    let url = { pathname: '[invalid-url]' };
    let actor = null; let operationId = null; let alreadyLogged = false;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    res.setHeader('Cache-Control', 'no-store');
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      try { url = new URL(req.url, 'http://localhost'); }
      catch { throw new HttpError(400, 'INVALID_URL', 'Request URL is not valid.'); }
      if (!url.pathname.startsWith('/api/')) {
        requireCondition(req.method === 'GET' || req.method === 'HEAD', 405, 'METHOD_NOT_ALLOWED', 'Use GET to read this page.');
        const asset = assets.get(url.pathname);
        requireCondition(asset, 404, 'NOT_FOUND', 'Page not found.');
        const bytes = await readFile(join(root, 'public', asset[0]));
        res.writeHead(200, { 'Content-Type': asset[1] }); res.end(req.method === 'HEAD' ? undefined : bytes); return;
      }
      const token = sessionToken(req);
      // A deployment with demo identities disabled must not accept old demo sessions.
      const session = demoMode ? database.session(token) : null;
      actor = session?.user ?? null;
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        if (req.headers.origin) {
          let origin;
          try { origin = new URL(req.headers.origin); } catch { throw new HttpError(403, 'CROSS_ORIGIN', 'Origin is not allowed.'); }
          requireCondition(['http:', 'https:'].includes(origin.protocol) && origin.host === req.headers.host,
            403, 'CROSS_ORIGIN', 'Cross-origin writes are not allowed.');
        }
      }
      if (req.method === 'GET' && url.pathname === '/api/health') {
        send(200, { data: { status: 'ok', demoMode } }); return;
      }
      if (url.pathname === '/api/demo/users' && req.method === 'GET') {
        requireCondition(demoMode, 404, 'DEMO_DISABLED', 'Demo identities are disabled.');
        send(200, { data: database.users() }); return;
      }
      if (url.pathname === '/api/demo/session' && req.method === 'POST') {
        requireCondition(demoMode, 404, 'DEMO_DISABLED', 'Demo identities are disabled.');
        const body = await readBody(req);
        requireCondition(typeof body.userId === 'string', 400, 'INVALID_USER', 'Choose a provided demo user.');
        requireCondition(Object.keys(body).length === 1, 400, 'UNKNOWN_FIELD', 'Only userId is accepted.');
        const created = database.createSession(body.userId, requestId, token);
        res.setHeader('Set-Cookie', cookie(created.token));
        send(200, { data: { user: created.user, csrfToken: created.csrfToken } }); return;
      }
      requireCondition(session && actor, 401, 'UNAUTHENTICATED', 'Select a demo identity to continue.');
      if (req.method !== 'GET' && req.method !== 'HEAD') requireCondition(validCsrf(session.csrfToken, req.headers['x-csrf-token']),
        403, 'INVALID_CSRF', 'Missing or invalid CSRF token. Refresh the session.');
      if (url.pathname === '/api/session') {
        if (req.method === 'GET') { send(200, { data: session }); return; }
        if (req.method === 'DELETE') {
          database.logout(token, actor, requestId); res.setHeader('Set-Cookie', cookie('', 0)); send(200, { data: { loggedOut: true } }); return;
        }
      }
      if (url.pathname === '/api/operations') {
        if (req.method === 'GET') { send(200, { data: database.operations(actor) }); return; }
        if (req.method === 'POST') { send(201, { data: database.createOperation(actor, await readBody(req), requestId) }); return; }
      }
      const match = /^\/api\/operations\/([a-f0-9-]{36})(?:\/(submit|approve|reject|execute))?$/.exec(url.pathname);
      if (match) {
        operationId = match[1];
        if (!match[2] && req.method === 'GET') { send(200, { data: database.operation(operationId, actor) }); return; }
        if (match[2] && req.method === 'POST') {
          const body = await readBody(req);
          if (match[2] === 'execute') {
            const result = database.execute(actor, operationId, body, requestId);
            if (result.error) { alreadyLogged = result.logged; throw result.error; }
            send(200, { data: result.operation }); return;
          }
          send(200, { data: database.transition(actor, operationId, match[2], body, requestId) }); return;
        }
      }
      if (url.pathname === '/api/logs' && req.method === 'GET') { send(200, { data: database.logs(actor, url.searchParams) }); return; }
      throw new HttpError(404, 'NOT_FOUND', 'API endpoint not found.');
    } catch (error) {
      const status = error instanceof HttpError ? error.status : 500;
      const code = error instanceof HttpError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof HttpError ? error.message : 'Unexpected server error. Use the request ID to investigate.';
      if (!alreadyLogged) {
        try { database.audit({ actor, action: 'api.failed', outcome: [401,403].includes(status) ? 'denied' : 'failure',
          operationId, requestId, statusCode: status, message: `${req.method} ${url.pathname}: ${message}` }); }
        catch (auditError) { console.error('Audit write failed', requestId, auditError.message); }
      }
      if (status === 500) console.error('Request failed', requestId, error);
      if (!res.headersSent && !res.destroyed) send(status, { error: { code, message, requestId } });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  server.keepAliveTimeout = 5000;
  return {
    server,
    async close() {
      if (server.listening) await new Promise((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
      database.close();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApplication();
  const host = process.env.HOST || '127.0.0.1';
  const port = Number(process.env.PORT || 3000);
  app.server.listen(port, host, () => console.log(`SDC Tracker foundation: http://${host}:${port} (synthetic demo only)`));
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}
