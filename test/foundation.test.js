import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApplication } from '../src/server.js';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sdc-foundation-'));
  const dbPath = join(directory, 'test.sqlite');
  let application;
  let baseUrl;

  async function start() {
    application = await createApplication({ dbPath, ...options });
    await new Promise((resolve, reject) => {
      application.server.once('error', reject);
      application.server.listen(0, '127.0.0.1', resolve);
    });
    baseUrl = `http://127.0.0.1:${application.server.address().port}`;
  }

  await start();
  t.after(async () => {
    try {
      if (application) await application.close();
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  async function request(path, { actor, method = 'GET', body, csrf = true, headers = {} } = {}) {
    const requestHeaders = { ...headers };
    if (actor) {
      requestHeaders.Cookie = actor.cookie;
      if (method !== 'GET' && method !== 'HEAD' && csrf) {
        requestHeaders['X-CSRF-Token'] = actor.csrfToken;
      }
    }
    if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: requestHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    });
    const text = await response.text();
    return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
  }

  async function login(userId) {
    const response = await request('/api/demo/session', { method: 'POST', body: { userId } });
    assert.equal(response.status, 200);
    const cookies = response.headers.getSetCookie();
    assert.ok(cookies.length > 0, 'Demo login should issue a session cookie');
    assert.ok(response.body.data.csrfToken, 'Login should return a CSRF token');
    return {
      ...response.body.data,
      cookie: cookies.map((cookie) => cookie.split(';', 1)[0]).join('; '),
    };
  }

  return {
    request,
    login,
    rawRequest(path) {
      const { hostname, port } = new URL(baseUrl);
      return new Promise((resolve, reject) => {
        const request = httpRequest({ hostname, port, path, method: 'GET' }, (response) => {
          const chunks = [];
          response.on('data', (chunk) => chunks.push(chunk));
          response.on('error', reject);
          response.on('end', () => {
            try {
              resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
            } catch (error) {
              reject(error);
            }
          });
        });
        request.on('error', reject);
        request.setTimeout(5000, () => request.destroy(new Error('Raw request timed out')));
        request.end();
      });
    },
    async restart() {
      await application.close();
      application = undefined;
      await start();
    },
  };
}

function expectError(response, status) {
  assert.equal(response.status, status);
  assert.equal(typeof response.body.error?.code, 'string');
  assert.equal(typeof response.body.error?.message, 'string');
  assert.ok(response.body.error.requestId, 'Errors must include a traceable request ID');
  return response.body.error;
}

async function createOperation(app, operator, title = 'Synthetic approval check') {
  const response = await app.request('/api/operations', {
    actor: operator,
    method: 'POST',
    body: { title, payload: { note: 'Team-generated synthetic example only.' } },
  });
  assert.equal(response.status, 201);
  assert.equal(response.body.data.status, 'draft');
  assert.equal(response.body.data.kind, 'foundation_check');
  return response.body.data;
}

async function transition(app, actor, operationId, action, body = {}) {
  return app.request(`/api/operations/${operationId}/${action}`, { actor, method: 'POST', body });
}

test('authentication, CSRF and origin checks protect writes and logout', async (t) => {
  const app = await fixture(t);
  expectError(await app.request('/api/operations'), 401);
  expectError(await app.request('/api/operations', {
    method: 'POST', body: { title: 'Unauthenticated', payload: { note: 'Synthetic' } },
  }), 401);

  const operator = await app.login('operator-a');
  const session = await app.request('/api/session', { actor: operator });
  assert.equal(session.status, 200);
  assert.equal(session.body.data.user.id, 'operator-a');
  expectError(await app.request('/api/operations', {
    actor: operator, method: 'POST', csrf: false,
    body: { title: 'No CSRF', payload: { note: 'Synthetic' } },
  }), 403);
  expectError(await app.request('/api/operations', {
    actor: { ...operator, csrfToken: 'é'.repeat(operator.csrfToken.length) }, method: 'POST',
    body: { title: 'Malformed CSRF', payload: { note: 'Synthetic' } },
  }), 403);
  expectError(await app.request('/api/operations', {
    actor: operator, method: 'POST',
    headers: { Origin: 'https://untrusted.example' },
    body: { title: 'Wrong origin', payload: { note: 'Synthetic' } },
  }), 403);
  assert.deepEqual((await app.request('/api/operations', { actor: operator })).body.data, []);

  expectError(await app.request('/api/session', {
    actor: operator, method: 'DELETE', csrf: false,
  }), 403);
  const logout = await app.request('/api/session', { actor: operator, method: 'DELETE' });
  assert.ok([200, 204].includes(logout.status));
  expectError(await app.request('/api/session', { actor: operator }), 401);
});

test('viewer permissions and forged identity headers cannot authorize actions', async (t) => {
  const app = await fixture(t);
  const users = await app.request('/api/demo/users');
  assert.equal(users.status, 200);
  assert.equal(users.body.data.length, 6);
  for (const user of users.body.data) {
    assert.ok(user.id && user.name && user.role && user.workspaceId && user.workspaceName);
  }

  const viewer = await app.login('viewer-a');
  expectError(await app.request('/api/operations', {
    actor: viewer, method: 'POST',
    headers: { 'X-User-Id': 'operator-a', 'X-Role': 'operator', 'X-Workspace-Id': 'workspace-a' },
    body: { title: 'Forged operator', payload: { note: 'Synthetic' } },
  }), 403);

  const operator = await app.login('operator-a');
  const operation = await createOperation(app, operator);
  assert.equal((await transition(app, operator, operation.id, 'submit')).status, 200);
  expectError(await transition(app, operator, operation.id, 'approve'), 403);
  expectError(await transition(app, viewer, operation.id, 'approve'), 403);
  expectError(await transition(app, viewer, operation.id, 'execute'), 403);
});

test('draft, pending and rejected work cannot execute or produce a result', async (t) => {
  const app = await fixture(t);
  const operator = await app.login('operator-a');
  const reviewer = await app.login('reviewer-a');
  const operation = await createOperation(app, operator);

  expectError(await transition(app, reviewer, operation.id, 'execute'), 409);
  assert.equal((await transition(app, operator, operation.id, 'submit')).status, 200);
  expectError(await transition(app, reviewer, operation.id, 'execute'), 409);
  const rejected = await transition(app, reviewer, operation.id, 'reject', { reason: 'Needs correction' });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.data.status, 'rejected');
  expectError(await transition(app, reviewer, operation.id, 'execute'), 409);

  const stored = await app.request(`/api/operations/${operation.id}`, { actor: operator });
  assert.equal(stored.status, 200);
  assert.equal(stored.body.data.status, 'rejected');
  assert.equal(stored.body.data.result, null);
  assert.equal(stored.body.data.attempts, 0);
});

test('approval permits one execution and duplicate execution has no side effects', async (t) => {
  const app = await fixture(t);
  const operator = await app.login('operator-a');
  const reviewer = await app.login('reviewer-a');
  const operation = await createOperation(app, operator);

  assert.equal((await transition(app, operator, operation.id, 'submit')).status, 200);
  assert.equal((await transition(app, reviewer, operation.id, 'approve')).body.data.status, 'approved');
  const executed = await transition(app, reviewer, operation.id, 'execute', { simulateFailure: false });
  assert.equal(executed.status, 200);
  assert.equal(executed.body.data.status, 'executed');
  assert.ok(executed.body.data.result);
  assert.equal(executed.body.data.attempts, 1);
  expectError(await transition(app, reviewer, operation.id, 'execute'), 409);

  const stored = await app.request(`/api/operations/${operation.id}`, { actor: operator });
  assert.equal(stored.body.data.attempts, 1);
  assert.deepEqual(stored.body.data.result, executed.body.data.result);
  const logs = await app.request(`/api/logs?outcome=success&operationId=${operation.id}`, { actor: operator });
  assert.equal(logs.status, 200);
  assert.ok(logs.body.data.some((log) => log.action.includes('execute') && log.statusCode === 200));
});

test('interface failures are traceable and retry does not affect other operations', async (t) => {
  const app = await fixture(t);
  const operator = await app.login('operator-a');
  const reviewer = await app.login('reviewer-a');
  const operation = await createOperation(app, operator, 'Retry this operation');
  const untouched = await createOperation(app, operator, 'Leave this operation untouched');
  await transition(app, operator, operation.id, 'submit');
  await transition(app, reviewer, operation.id, 'approve');

  const failed = await transition(app, reviewer, operation.id, 'execute', { simulateFailure: true });
  const error = expectError(failed, 503);
  const afterFailure = await app.request(`/api/operations/${operation.id}`, { actor: operator });
  assert.equal(afterFailure.body.data.status, 'approved');
  assert.equal(afterFailure.body.data.result, null);
  assert.equal(afterFailure.body.data.attempts, 1);

  const logs = await app.request(`/api/logs?outcome=failure&operationId=${operation.id}`, { actor: operator });
  const failureLog = logs.body.data.find((log) => log.requestId === error.requestId);
  assert.ok(failureLog, 'The failed request must be discoverable in the activity log');
  assert.equal(failureLog.statusCode, 503);
  assert.equal(failureLog.operationId, operation.id);
  assert.ok(failureLog.actorName && failureLog.message && failureLog.createdAt);

  const retried = await transition(app, reviewer, operation.id, 'execute', { simulateFailure: false });
  assert.equal(retried.status, 200);
  assert.equal(retried.body.data.status, 'executed');
  assert.equal(retried.body.data.attempts, 2);
  const other = await app.request(`/api/operations/${untouched.id}`, { actor: operator });
  assert.equal(other.body.data.status, 'draft');
  assert.equal(other.body.data.attempts, 0);
});

test('workspace isolation protects objects and logs even when headers are forged', async (t) => {
  const app = await fixture(t);
  const operatorA = await app.login('operator-a');
  const reviewerB = await app.login('reviewer-b');
  const operation = await createOperation(app, operatorA);
  await transition(app, operatorA, operation.id, 'submit');

  expectError(await app.request(`/api/operations/${operation.id}`, {
    actor: reviewerB,
    headers: { 'X-User-Id': 'reviewer-a', 'X-Role': 'reviewer', 'X-Workspace-Id': operation.workspaceId },
  }), 404);
  expectError(await transition(app, reviewerB, operation.id, 'approve'), 404);
  expectError(await transition(app, reviewerB, operation.id, 'execute'), 404);
  assert.deepEqual((await app.request('/api/operations', { actor: reviewerB })).body.data, []);
  const logsB = await app.request('/api/logs', { actor: reviewerB });
  assert.equal(logsB.status, 200);
  assert.ok(logsB.body.data.every((log) => log.operationId !== operation.id
    || (log.outcome !== 'success' && log.actorName === reviewerB.user.name)),
  'Workspace B may see its own failed access attempts, but not activity from workspace A');
  const stored = await app.request(`/api/operations/${operation.id}`, { actor: operatorA });
  assert.equal(stored.body.data.status, 'pending_approval');
});

test('validation failures and denied actions remain queryable without creating work', async (t) => {
  const app = await fixture(t);
  const operator = await app.login('operator-a');
  const invalid = await app.request('/api/operations', {
    actor: operator, method: 'POST', body: { title: '', payload: { note: 'Synthetic' } },
  });
  const error = expectError(invalid, 400);
  const operation = await createOperation(app, operator);
  await transition(app, operator, operation.id, 'submit');
  const denial = expectError(await transition(app, operator, operation.id, 'approve'), 403);

  const logs = await app.request('/api/logs', { actor: operator });
  assert.ok(logs.body.data.some((log) => log.requestId === error.requestId && log.statusCode === 400));
  const deniedLogs = await app.request('/api/logs?outcome=denied', { actor: operator });
  assert.ok(deniedLogs.body.data.some((log) => log.requestId === denial.requestId && log.statusCode === 403));
  assert.ok(deniedLogs.body.data.every((log) => log.outcome === 'denied'));
  const listed = await app.request('/api/operations', { actor: operator });
  assert.equal(listed.body.data.length, 1);
});

test('operations, logs and sessions survive refresh and a SQLite-backed server restart', async (t) => {
  const app = await fixture(t);
  const operator = await app.login('operator-a');
  const operation = await createOperation(app, operator, 'Persisted synthetic operation');
  await transition(app, operator, operation.id, 'submit');
  const before = await app.request('/api/logs', { actor: operator });
  const operationLog = before.body.data.find((log) => log.operationId === operation.id);
  assert.ok(operationLog);

  const refreshed = await app.request('/api/operations', { actor: operator });
  assert.equal(refreshed.body.data.find((item) => item.id === operation.id).status, 'pending_approval');
  await app.restart();

  const session = await app.request('/api/session', { actor: operator });
  assert.equal(session.status, 200, 'Restart should preserve an unexpired demo session');
  assert.equal(session.body.data.user.id, operator.user.id);
  const restored = await app.request(`/api/operations/${operation.id}`, { actor: operator });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.title, operation.title);
  assert.equal(restored.body.data.status, 'pending_approval');
  const logs = await app.request('/api/logs', { actor: operator });
  assert.ok(logs.body.data.some((log) => log.id === operationLog.id && log.requestId === operationLog.requestId));
});

test('disabling demo mode removes the identity-switching entry points', async (t) => {
  const app = await fixture(t, { demoMode: false });
  const users = await app.request('/api/demo/users');
  assert.ok([403, 404].includes(users.status));
  const login = await app.request('/api/demo/session', {
    method: 'POST', body: { userId: 'reviewer-a' },
  });
  assert.ok([403, 404].includes(login.status));
  assert.equal(login.headers.get('set-cookie'), null);
  expectError(await app.request('/api/operations', {
    headers: { 'X-User-Id': 'reviewer-a', 'X-Role': 'reviewer', 'X-Workspace-Id': 'workspace-a' },
  }), 401);
});

test('a malformed raw URL returns a JSON error and leaves the server healthy', async (t) => {
  const app = await fixture(t);
  const error = expectError(await app.rawRequest('//'), 400);
  assert.equal(error.code, 'INVALID_URL');
  assert.equal((await app.request('/api/health')).status, 200);
});

test('an oversized JSON request returns a traceable 413 without creating work', async (t) => {
  const app = await fixture(t);
  const operator = await app.login('operator-a');
  const response = await app.request('/api/operations', {
    actor: operator, method: 'POST',
    body: { title: 'Oversized synthetic example', payload: { note: 'x'.repeat(16 * 1024) } },
  });
  const error = expectError(response, 413);
  assert.equal(error.code, 'BODY_TOO_LARGE');
  const logs = await app.request('/api/logs', { actor: operator });
  assert.ok(logs.body.data.some((log) => log.requestId === error.requestId && log.statusCode === 413));
  assert.deepEqual((await app.request('/api/operations', { actor: operator })).body.data, []);
  assert.equal((await app.request('/api/health')).status, 200);
});
