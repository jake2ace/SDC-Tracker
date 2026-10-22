import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openStore } from './store.mjs';
import { ApiError, requireCondition, requireObject } from './errors.mjs';
import { findInvoice } from './guards.mjs';
import { appendActivity, activityFor, decideInvoice, sessionFor, updateSettings } from './service.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const INVOICE_STATUSES = ['pending_approval', 'approved', 'rejected', 'issued', 'paid'];

async function readBody(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    requireCondition(size <= 16384, 'VALIDATION_ERROR', 'Request body exceeds the 16 KB limit.');
    chunks.push(chunk);
  }
  if (size === 0) return {};
  requireCondition((req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() === 'application/json',
    'VALIDATION_ERROR', 'Use application/json for a non-empty request body.');
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('VALIDATION_ERROR', 'The request contains invalid JSON.'); }
  requireCondition(body && typeof body === 'object' && !Array.isArray(body), 'VALIDATION_ERROR', 'The request body must be an object.');
  return body;
}

function validateQuery(url, names) {
  const seen = new Set();
  for (const [name] of url.searchParams) {
    requireCondition(names.includes(name) && !seen.has(name), 'VALIDATION_ERROR', 'The query contains an unknown or duplicate parameter.');
    seen.add(name);
  }
}

function validOrigin(origin, host, allowedOrigins) {
  try {
    const parsed = new URL(origin);
    return ['http:', 'https:'].includes(parsed.protocol) && parsed.origin === origin &&
      (parsed.host === host || allowedOrigins.includes(origin));
  } catch { return false; }
}

export function createApplication({
  databasePath = process.env.DB_PATH || join(root, '.local', 'sdc-tracker.sqlite'),
  seed = JSON.parse(readFileSync(join(root, 'data', 'demo.json'), 'utf8')),
  demoMode = process.env.DEMO_MODE === 'true',
  allowedOrigins = (process.env.CORS_ORIGINS || '').split(',').map(value => value.trim()).filter(Boolean)
} = {}) {
  const store = openStore({ databasePath, seed });
  const server = createServer(async (req, res) => {
    const requestId = randomUUID();
    let pathname = '[invalid-url]'; let actor = null;
    res.setHeader('X-Request-Id', requestId);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Origin');
    const send = (status, value) => {
      res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify(value));
    };
    try {
      let url;
      try { url = new URL(req.url, 'http://localhost'); }
      catch { throw new ApiError('VALIDATION_ERROR', 'The request URL is invalid.'); }
      pathname = url.pathname;
      const state = store.read();
      const identity = req.headers['x-demo-user'];
      if (demoMode && typeof identity === 'string') actor = state.users.find(user => user.id === identity) ?? null;
      if (req.headers.origin) {
        requireCondition(validOrigin(req.headers.origin, req.headers.host, allowedOrigins),
          'FORBIDDEN', 'This frontend origin is not allowed.');
        res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
        res.setHeader('Access-Control-Expose-Headers', 'X-Request-Id');
      }
      if (req.method === 'OPTIONS') {
        requireCondition(req.headers.origin && pathname.startsWith('/api/'), 'NOT_FOUND', 'Preflight endpoint not found.');
        res.writeHead(204, {
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-Demo-User',
          'Access-Control-Max-Age': '600'
        }); res.end(); return;
      }
      if (pathname === '/health' && req.method === 'GET') {
        validateQuery(url, []);
        send(200, { status: 'ok', service: 'sdc-tracker-backend', demoMode, frontend: false }); return;
      }
      requireCondition(pathname.startsWith('/api/'), 'NOT_FOUND', 'This service provides backend APIs only.');
      if (pathname.startsWith('/api/demo/')) requireCondition(demoMode, 'NOT_FOUND', 'Demo controls are disabled.');
      requireCondition(actor, 'UNAUTHENTICATED', 'Provide a known X-Demo-User identity in explicitly enabled demo mode.');

      if (pathname === '/api/demo/session' && req.method === 'GET') {
        validateQuery(url, []); send(200, sessionFor(state, actor)); return;
      }
      if (pathname === '/api/demo/settings' && req.method === 'PUT') {
        validateQuery(url, []); const body = await readBody(req);
        send(200, store.transaction(current => updateSettings(current, actor, body))); return;
      }
      if (pathname === '/api/demo/reset' && req.method === 'POST') {
        validateQuery(url, []); requireObject(await readBody(req), []);
        send(200, { settings: store.reset() }); return;
      }
      if (pathname === '/api/projects' && req.method === 'GET') {
        validateQuery(url, []);
        const projects = state.projects.filter(project => project.companyId === actor.companyId).map(project => ({
          ...project, client: state.clients.find(client => client.id === project.clientId && client.companyId === actor.companyId),
          milestones: state.milestones.filter(milestone => milestone.projectId === project.id),
          invoices: state.invoices.filter(invoice => invoice.projectId === project.id && invoice.companyId === actor.companyId)
        }));
        send(200, { projects }); return;
      }
      if (pathname === '/api/invoices' && req.method === 'GET') {
        validateQuery(url, ['status']); const status = url.searchParams.get('status');
        requireCondition(status === null || INVOICE_STATUSES.includes(status), 'VALIDATION_ERROR', 'Unknown invoice status.');
        send(200, { invoices: state.invoices.filter(invoice => invoice.companyId === actor.companyId && (!status || invoice.status === status)) }); return;
      }
      const match = /^\/api\/invoices\/([^/]+)(?:\/(approve|reject))?$/.exec(pathname);
      if (match) {
        validateQuery(url, []);
        if (!match[2] && req.method === 'GET') {
          const invoice = findInvoice(state, actor, match[1]);
          send(200, { invoice, logs: activityFor(state, actor, state.logs.length).filter(log => log.entityType === 'invoice' && log.entityId === invoice.id) }); return;
        }
        if (match[2] && req.method === 'POST') {
          const body = await readBody(req);
          send(200, store.transaction(current => decideInvoice(current, actor, match[1], match[2], body))); return;
        }
      }
      if (pathname === '/api/activity' && req.method === 'GET') {
        validateQuery(url, ['limit']); const raw = url.searchParams.get('limit');
        requireCondition(raw === null || /^[1-9]\d*$/.test(raw), 'VALIDATION_ERROR', 'limit must be an integer from 1 to 200.');
        const limit = raw === null ? 50 : Number(raw);
        requireCondition(Number.isSafeInteger(limit) && limit >= 1 && limit <= 200, 'VALIDATION_ERROR', 'limit must be an integer from 1 to 200.');
        send(200, { logs: activityFor(state, actor, limit) }); return;
      }
      throw new ApiError('NOT_FOUND', 'This route is not implemented in the backend foundation.');
    } catch (error) {
      const known = error instanceof ApiError;
      const code = known ? error.code : 'UPSTREAM_FAILED';
      const status = known ? error.status : 502;
      const message = known ? error.message : 'The backend request could not be completed.';
      try {
        store.recordRequestError({ requestId, at: new Date().toISOString(), method: req.method, path: pathname, status, code, message, actor });
        if (actor) store.transaction(current => appendActivity(current, actor, {
          action: 'api.error', result: [401, 403].includes(status) ? 'denied' : 'failure',
          // A system event avoids attaching a foreign or nonexistent entity to this company.
          message: `${req.method} request failed: ${message} Request ID: ${requestId}`
        }));
      } catch (logError) { console.error('Request logging failed', requestId, logError.message); }
      if (!known) console.error('Backend request failed', requestId, error.message);
      if (!res.headersSent && !res.destroyed) send(status, { error: { code, message, details: { ...(known ? error.details : {}), requestId } } });
    }
  });
  server.requestTimeout = 15000;
  server.headersTimeout = 10000;
  let closed = false;
  return {
    server,
    store,
    async close() {
      if (closed) return;
      closed = true;
      if (server.listening) await new Promise((done, fail) => server.close(error => error ? fail(error) : done()));
      store.close();
    }
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const app = createApplication();
  const host = process.env.HOST || '127.0.0.1'; const port = Number(process.env.PORT || 3000);
  app.server.listen(port, host, () => console.log(`SDC Tracker backend: http://${host}:${port} — no frontend is served.`));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => app.close().then(() => process.exit(0)));
}
