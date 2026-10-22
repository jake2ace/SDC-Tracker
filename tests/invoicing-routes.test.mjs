import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { routeInvoicingRequest } from '../src/invoicing/routes.mjs';
import { createInvoicingService } from '../src/invoicing/service.mjs';

function recordingService(result = { status: 200, body: { invoices: [] } }) {
  const calls = [];
  const service = Object.fromEntries([
    'listProjects', 'listInvoices', 'getInvoice', 'completeMilestone', 'issueInvoice',
  ].map(name => [name, async (...args) => {
    calls.push([name, ...args]);
    return result;
  }]));
  return { service, calls, result };
}

test('five routes delegate exact inputs and preserve the service response', async t => {
  const cases = [
    [{ method: 'GET', pathname: '/api/projects' }, ['listProjects', 'trusted-user']],
    [{ method: 'GET', pathname: '/api/invoices' }, ['listInvoices', 'trusted-user', {}]],
    [{ method: 'GET', pathname: '/api/invoices', query: new URLSearchParams('status=approved') },
      ['listInvoices', 'trusted-user', { status: 'approved' }]],
    [{ method: 'GET', pathname: '/api/invoices/inv%5F1' }, ['getInvoice', 'trusted-user', 'inv_1']],
    [{ method: 'POST', pathname: '/api/milestones/ms_1/complete' },
      ['completeMilestone', 'trusted-user', 'ms_1', {}]],
    [{ method: 'POST', pathname: '/api/invoices/inv_1/issue', body: { userId: 'forged', amount: 1 } },
      ['issueInvoice', 'trusted-user', 'inv_1', { userId: 'forged', amount: 1 }]],
  ];
  for (const [request, expected] of cases) {
    await t.test(`${request.method} ${request.pathname} ${request.query || ''}`, async () => {
      const { service, calls, result } = recordingService();
      assert.equal(await routeInvoicingRequest(service, { ...request, userId: 'trusted-user' }), result);
      assert.deepEqual(calls, [expected]);
    });
  }
});

test('invalid query parameters and URI IDs return the contract error before delegation', async t => {
  const cases = [
    { method: 'GET', pathname: '/api/projects', query: new URLSearchParams('status=issued') },
    { method: 'GET', pathname: '/api/invoices', query: new URLSearchParams('status=issued&status=paid') },
    { method: 'GET', pathname: '/api/invoices', query: new URLSearchParams('companyId=co_other') },
    { method: 'GET', pathname: '/api/invoices', query: { status: 'issued' } },
    { method: 'GET', pathname: '/api/invoices/inv_1', query: new URLSearchParams('status=issued') },
    { method: 'POST', pathname: '/api/invoices/inv_1/issue', query: new URLSearchParams('userId=forged') },
    { method: 'POST', pathname: '/api/milestones/ms_1/complete', query: new URLSearchParams('x=1') },
    ...['', '%', '%E0%A4', '%2F', 'inv%2F1', 'inv%5C1', '%00', '%20', 'inv?x=1', 'inv#x']
      .map(id => ({ method: 'GET', pathname: `/api/invoices/${id}` })),
    { method: 'POST', pathname: '/api/milestones//complete' },
    { method: 'POST', pathname: '/api/invoices//issue' },
  ];
  for (const request of cases) {
    await t.test(`${request.method} ${request.pathname} ${request.query || ''}`, async () => {
      const { service, calls } = recordingService();
      const result = await routeInvoicingRequest(service, request);
      assert.equal(result.status, 400);
      assert.equal(result.body.error.code, 'VALIDATION_ERROR');
      assert.equal(typeof result.body.error.message, 'string');
      assert.deepEqual(result.body.error.details, {});
      assert.deepEqual(calls, []);
    });
  }
});

test('unowned methods, paths, and adjacent features remain available to the host router', async () => {
  const { service, calls } = recordingService();
  for (const [method, pathname] of [
    ['POST', '/api/projects'], ['POST', '/api/invoices'], ['GET', '/api/projects/'],
    ['GET', '/api/invoices/inv_1/issue'], ['POST', '/api/invoices/inv_1/approve'],
    ['POST', '/api/invoices/inv_1/reject'], ['POST', '/api/invoices/inv_1/payments'],
    ['POST', '/api/invoices/inv_1/reminders'], ['GET', '/api/demo/session'],
    ['GET', '/api/invoices/inv_1/logs'], ['POST', '/api/invoices/inv_1/issue/'],
    ['POST', '/api/milestones/ms_1/complete/extra'], ['HEAD', '/api/invoices'],
    ['POST', '/api/milestones/ms_1/complete\n'], ['POST', '/api/invoices/inv_1/issue\n'],
    ['GET', '/prefix/api/invoices'], ['GET', '/api/invoicesExtra'],
  ]) {
    assert.equal(await routeInvoicingRequest(service, { method, pathname, query: null }), null,
      `${method} ${pathname} should fall through`);
  }
  assert.deepEqual(calls, []);
});

test('service errors retain HTTP status/details and unexpected failures reach the host', async () => {
  for (const [status, code] of [[400, 'VALIDATION_ERROR'], [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'INVALID_STATE'], [502, 'UPSTREAM_FAILED']]) {
    const result = { status, body: { error: { code, message: 'test', details: { retryable: true } } } };
    assert.equal(await routeInvoicingRequest(recordingService(result).service,
      { method: 'GET', pathname: '/api/projects' }), result);
  }
  const failure = new Error('store unavailable');
  await assert.rejects(routeInvoicingRequest({ listProjects: async () => { throw failure; } },
    { method: 'GET', pathname: '/api/projects' }), error => error === failure);
});

// Test-only HTTP fixture. Production session, JSON parsing, and store ownership
// belong to Issue #2; the routing module creates no server or authentication mode.
async function httpFixture(t) {
  let state = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
  const service = createInvoicingService({
    now: () => new Date('2026-10-22T14:00:00.000Z'),
    store: {
      read: () => structuredClone(state),
      transaction(fn) {
        const draft = structuredClone(state);
        const result = fn(draft);
        state = draft;
        return result;
      },
    },
  });
  const sessions = new Map([
    ['test-pm-session', 'u_lumen_pm'], ['test-finance-session', 'u_lumen_fin'],
  ]);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : {};
      const sessionToken = request.headers.authorization?.replace(/^Bearer /, '');
      const result = await routeInvoicingRequest(service, {
        method: request.method, pathname: url.pathname, query: url.searchParams, body,
        userId: sessions.get(sessionToken),
      }) || { status: 404, body: { hostFallback: true } };
      response.writeHead(result.status, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result.body));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ testFixtureError: true }));
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  return {
    state: () => state,
    async request(path, { method = 'GET', body, session = 'test-finance-session' } = {}) {
      const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
        method,
        headers: { ...(session ? { authorization: `Bearer ${session}` } : {}), 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      assert.match(response.headers.get('content-type'), /^application\/json/);
      return { status: response.status, body: await response.json() };
    },
  };
}

test('actual HTTP boundary exposes direct JSON and domain error status without identity override', async t => {
  const fixture = await httpFixture(t);
  const projects = await fixture.request('/api/projects');
  assert.equal(projects.status, 200);
  assert.ok(Array.isArray(projects.body.projects));
  assert.equal(Object.hasOwn(projects.body, 'data'), false);

  for (const [path, options, status, code] of [
    ['/api/invoices?status=unknown', {}, 400, 'VALIDATION_ERROR'],
    ['/api/invoices?status=issued&status=paid', {}, 400, 'VALIDATION_ERROR'],
    ['/api/invoices/%E0%A4', {}, 400, 'VALIDATION_ERROR'],
    ['/api/invoices/inv%2F1', {}, 400, 'VALIDATION_ERROR'],
    ['/api/projects', { session: null }, 401, 'UNAUTHENTICATED'],
    ['/api/invoices/inv_bd_1', {}, 404, 'NOT_FOUND'],
    ['/api/milestones/ms_kt_2/complete', { method: 'POST', body: {} }, 403, 'FORBIDDEN'],
    ['/api/milestones/ms_kt_2/complete', { method: 'POST', body: { userId: 'u_lumen_pm' } }, 400, 'VALIDATION_ERROR'],
    ['/api/milestones/ms_kt_2/complete', { method: 'POST', body: { userId: 'u_lumen_pm' }, session: null }, 401, 'UNAUTHENTICATED'],
  ]) {
    const result = await fixture.request(path, options);
    assert.equal(result.status, status, path);
    assert.equal(result.body.error.code, code, path);
    assert.equal(typeof result.body.error.details, 'object');
    assert.equal(Object.hasOwn(result.body, 'data'), false);
  }

  const completePath = '/api/milestones/ms_kt_2/complete';
  const create = await fixture.request(completePath, { method: 'POST', body: {}, session: 'test-pm-session' });
  assert.equal(create.status, 201);
  assert.equal(create.body.created, true);
  assert.equal(create.body.invoice.amount, 1800000);
  const repeat = await fixture.request(completePath, { method: 'POST', body: {}, session: 'test-pm-session' });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.created, false);
  assert.equal(repeat.body.invoice.id, create.body.invoice.id);

  const issuePath = `/api/invoices/${create.body.invoice.id}/issue`;
  const unapproved = await fixture.request(issuePath, { method: 'POST', body: {} });
  assert.equal(unapproved.status, 409);
  assert.equal(unapproved.body.error.code, 'INVALID_STATE');

  // Approval is provided by Issue #2. Prepare that committed state in the fixture.
  const state = fixture.state();
  const invoice = state.invoices.find(row => row.id === create.body.invoice.id);
  invoice.status = 'approved';
  invoice.approval = { by: 'Daniel Tan', role: 'owner', at: '2026-10-22T14:01:00.000Z' };
  state.settings.failNext.accounting = true;
  const failed = await fixture.request(issuePath, { method: 'POST', body: {} });
  assert.equal(failed.status, 502);
  assert.equal(failed.body.error.code, 'UPSTREAM_FAILED');
  assert.equal(failed.body.error.details.retryable, true);
  const issued = await fixture.request(issuePath, { method: 'POST', body: {} });
  assert.equal(issued.status, 200);
  assert.equal(issued.body.invoice.status, 'issued');
  assert.equal(issued.body.receipt.simulation, true);
  assert.equal(issued.body.invoice.dueDate, '2026-11-05');
  assert.equal(Object.hasOwn(issued.body, 'data'), false);
  assert.deepEqual(await fixture.request('/api/invoices/inv_1/approve', { method: 'POST', body: {} }),
    { status: 404, body: { hostFallback: true } });
});
