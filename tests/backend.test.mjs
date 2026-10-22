import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApplication } from '../src/server.mjs';
import { findInvoice, requireApprovedInvoice, requireRole } from '../src/guards.mjs';
import { addDays } from '../contracts/validate.mjs';
import { materializeFixture, readJson } from './helpers.mjs';

const seed = await readJson('../data/demo.json');
const golden = await readJson('../data/expected-results.json');
const fixture = () => materializeFixture(seed, golden.stateFixtures, 'lumen_draft');
const companyId = seed.settings.companyId;
const userFor = (role, company = companyId) => seed.users.find(user => user.companyId === company && user.role === role);
const owner = userFor('owner');
const pm = userFor('pm');
const finance = userFor('finance');
const otherOwner = seed.users.find(user => user.role === 'owner' && user.companyId !== companyId);
const draft = fixture().invoices.find(invoice => invoice.companyId === companyId && invoice.status === 'pending_approval');
const invoiceUrl = `/api/invoices/${draft.id}`;

async function start(t, options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'sdc-backend-test-'));
  const configuration = {
    databasePath: path.join(directory, 'test.sqlite'),
    seed: fixture(),
    demoMode: true,
    ...options,
  };
  let application;
  let base;
  async function open() {
    application = await createApplication(configuration);
    application.server.listen(0, '127.0.0.1');
    await once(application.server, 'listening');
    base = `http://127.0.0.1:${application.server.address().port}`;
  }
  await open();
  t.after(async () => {
    await application.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get base() { return base; },
    async restart() {
      await application.close();
      await open();
    },
    async request(url, { actor = owner, method = 'GET', body, rawBody, headers = {} } = {}) {
      const requestHeaders = { ...headers };
      if (actor) requestHeaders['X-Demo-User'] = typeof actor === 'string' ? actor : actor.id;
      if (body !== undefined) requestHeaders['Content-Type'] = 'application/json';
      const response = await fetch(base + url, {
        method,
        headers: requestHeaders,
        body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      });
      const text = await response.text();
      return { status: response.status, headers: response.headers, body: text ? JSON.parse(text) : null };
    },
  };
}

function expectError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.body.error.code, code);
  assert.equal(typeof response.body.error.message, 'string');
  assert.ok(response.body.error.message.length > 0);
  assert.equal(typeof response.body.error.details.requestId, 'string');
  assert.ok(response.body.error.details.requestId.length > 0);
  assert.equal(Object.hasOwn(response.body, 'data'), false);
}

function expectLog(log) {
  for (const key of ['id', 'companyId', 'at', 'demoDate', 'actor', 'role', 'action', 'entityType', 'entityId', 'result', 'message']) {
    assert.ok(Object.hasOwn(log, key), `Activity log is missing ${key}`);
  }
  assert.ok(Number.isFinite(Date.parse(log.at)));
  assert.ok(['pm', 'owner', 'finance', 'system'].includes(log.role));
  assert.ok(['success', 'failure', 'denied', 'info'].includes(log.result));
  assert.ok(['milestone', 'invoice', 'reminder', 'payment', 'system'].includes(log.entityType));
  assert.equal(/[\u3400-\u9fff]/u.test(log.message), false, 'New activity messages must be in English');
}

test('health is public; demo identity is available only in explicitly enabled demo mode', async t => {
  const app = await start(t, { demoMode: false });
  const health = await app.request('/health', { actor: null });
  assert.equal(health.status, 200);
  assert.equal(typeof health.body, 'object');
  assert.ok(Object.keys(health.body).length > 0);
  expectError(await app.request('/api/demo/session'), 404, 'NOT_FOUND');
  expectError(await app.request('/api/demo/reset', { method: 'POST', body: {} }), 404, 'NOT_FOUND');
  expectError(await app.request('/api/invoices'), 401, 'UNAUTHENTICATED');
});

test('missing or unknown demo identities cannot inherit another request or generate company-visible logs', async t => {
  const app = await start(t);
  const before = await app.request('/api/activity');
  expectError(await app.request('/api/invoices', { actor: null }), 401, 'UNAUTHENTICATED');
  expectError(await app.request('/api/demo/session', { actor: 'unknown-user' }), 401, 'UNAUTHENTICATED');
  expectError(await app.request(`${invoiceUrl}/approve`, { actor: null, method: 'POST', body: {} }), 401, 'UNAUTHENTICATED');
  const after = await app.request('/api/activity');
  assert.deepEqual(after.body, before.body);
  assert.equal((await app.request(invoiceUrl)).body.invoice.status, 'pending_approval');
});

test('session identity, project joins, invoices and invoice logs are scoped to the request company', async t => {
  const app = await start(t);
  for (const actor of [owner, otherOwner]) {
    const session = await app.request('/api/demo/session', { actor });
    assert.equal(session.status, 200);
    assert.deepEqual(Object.keys(session.body).sort(), ['companies', 'company', 'settings', 'user', 'users']);
    assert.deepEqual(session.body.user, actor);
    assert.equal(session.body.company.id, actor.companyId);
    assert.equal(session.body.settings.userId, actor.id);
    assert.equal(session.body.settings.companyId, actor.companyId);
    assert.ok(session.body.users.some(user => user.id === actor.id));
    const projects = await app.request('/api/projects', { actor });
    assert.equal(projects.status, 200);
    assert.equal(Object.hasOwn(projects.body, 'data'), false);
    assert.equal(projects.body.projects.length, fixture().projects.filter(row => row.companyId === actor.companyId).length);
    for (const project of projects.body.projects) {
      assert.equal(project.companyId, actor.companyId);
      assert.equal(project.client.id, project.clientId);
      assert.equal(project.client.companyId, actor.companyId);
      assert.ok(Array.isArray(project.milestones));
      assert.ok(Array.isArray(project.invoices));
      assert.ok(project.milestones.every(row => row.projectId === project.id));
      assert.ok(project.invoices.every(row => row.projectId === project.id && row.companyId === actor.companyId));
    }
    const invoices = await app.request('/api/invoices', { actor });
    assert.equal(invoices.status, 200);
    assert.ok(invoices.body.invoices.every(row => row.companyId === actor.companyId));
  }
  const pending = await app.request('/api/invoices?status=pending_approval');
  assert.deepEqual(pending.body.invoices.map(row => row.id), [draft.id]);
  expectError(await app.request('/api/invoices?status=made-up'), 400, 'VALIDATION_ERROR');
  const detail = await app.request(invoiceUrl);
  assert.deepEqual(detail.body.invoice, draft);
  assert.ok(detail.body.logs.every(log => log.companyId === companyId && log.entityId === draft.id));
});

test('settings are validated atomically and cannot override the identity established by the header', async t => {
  const app = await start(t);
  const original = (await app.request('/api/demo/session')).body.settings;
  const invalidChanges = [
    { unexpected: true },
    { failNext: { accounting: true } },
    { failNext: { accounting: true, outbox: false, unknown: false } },
    { failNext: { accounting: 'true', outbox: false } },
    { demoDate: 'not-a-date' },
    { demoDate: `${original.demoDate.slice(0, 4)}-02-30` },
    { demoDate: addDays(seed.invoices[0].draftedAt, -1) },
    { companyId: otherOwner.companyId },
    { userId: otherOwner.id },
    { companyId, userId: otherOwner.id },
    { demoDate: addDays(original.demoDate, 1), failNext: { accounting: null, outbox: false } },
  ];
  for (const body of invalidChanges) {
    expectError(await app.request('/api/demo/settings', { method: 'PUT', body }), 400, 'VALIDATION_ERROR');
    assert.deepEqual((await app.request('/api/demo/session')).body.settings, original);
  }
  const nextDate = addDays(original.demoDate, 1);
  const update = await app.request('/api/demo/settings', {
    method: 'PUT',
    body: { demoDate: nextDate, companyId: otherOwner.companyId, userId: otherOwner.id, failNext: { accounting: true, outbox: false } },
  });
  assert.equal(update.status, 200);
  assert.equal(update.body.settings.companyId, otherOwner.companyId);
  assert.equal(update.body.settings.userId, otherOwner.id);
  const session = (await app.request('/api/demo/session', { actor: pm })).body;
  assert.equal(session.user.id, pm.id);
  assert.equal(session.company.id, pm.companyId);
  assert.equal(session.settings.userId, pm.id);
  assert.equal(session.settings.companyId, pm.companyId);
  assert.equal(session.settings.demoDate, nextDate);
  assert.deepEqual(session.settings.failNext, { accounting: true, outbox: false });
});

test('approval is owner-only, preserves the invoice basis, is idempotent and cannot issue an invoice', async t => {
  const app = await start(t);
  expectError(await app.request(`${invoiceUrl}/approve`, { actor: pm, method: 'POST', body: {} }), 403, 'FORBIDDEN');
  const approved = await app.request(`${invoiceUrl}/approve`, { method: 'POST', body: {} });
  assert.equal(approved.status, 200);
  assert.equal(approved.body.invoice.status, 'approved');
  assert.equal(approved.body.invoice.approval.by, owner.name);
  assert.equal(approved.body.invoice.approval.role, 'owner');
  assert.ok(Number.isFinite(Date.parse(approved.body.invoice.approval.at)));
  for (const key of ['amount', 'currency', 'netDays', 'basis', 'issueRequestId', 'invoiceNo', 'issuedAt', 'dueDate', 'paidAt']) {
    assert.deepEqual(approved.body.invoice[key], draft[key]);
  }
  const repeated = await app.request(`${invoiceUrl}/approve`, { method: 'POST', body: {} });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body.invoice, approved.body.invoice);
  expectError(await app.request(`${invoiceUrl}/approve`, { actor: finance, method: 'POST', body: {} }), 403, 'FORBIDDEN');
  expectError(await app.request(`${invoiceUrl}/issue`, { actor: finance, method: 'POST', body: {} }), 404, 'NOT_FOUND');
  const detail = await app.request(invoiceUrl);
  assert.equal(detail.body.invoice.invoiceNo, null);
  const success = detail.body.logs.filter(log => log.result === 'success' && log.action.includes('approve'));
  assert.equal(success.length, 1, 'Retrying approval must not create another successful decision');
  const activity = (await app.request('/api/activity')).body.logs;
  assert.ok(activity.some(log => log.result === 'denied' && log.actor === pm.name));
  activity.forEach(expectLog);
  detail.body.logs.forEach(expectLog);
});

test('rejection trims and retains its reason; terminal decisions cannot be changed by retrying', async t => {
  const app = await start(t);
  for (const body of [{}, { reason: '' }, { reason: '   ' }, { reason: 42 }]) {
    expectError(await app.request(`${invoiceUrl}/reject`, { method: 'POST', body }), 400, 'VALIDATION_ERROR');
  }
  const rejected = await app.request(`${invoiceUrl}/reject`, { method: 'POST', body: { reason: '  Review the payment basis  ' } });
  assert.equal(rejected.status, 200);
  assert.equal(rejected.body.invoice.status, 'rejected');
  assert.equal(rejected.body.invoice.approval.reason, 'Review the payment basis');
  assert.equal(rejected.body.invoice.approval.by, owner.name);
  const repeated = await app.request(`${invoiceUrl}/reject`, { method: 'POST', body: { reason: 'Review the payment basis' } });
  assert.equal(repeated.status, 200);
  assert.deepEqual(repeated.body.invoice, rejected.body.invoice);
  expectError(await app.request(`${invoiceUrl}/reject`, { actor: finance, method: 'POST', body: { reason: 'Review the payment basis' } }), 403, 'FORBIDDEN');
  expectError(await app.request(`${invoiceUrl}/reject`, { method: 'POST', body: { reason: 'A different reason' } }), 409, 'INVALID_STATE');
  expectError(await app.request(`${invoiceUrl}/approve`, { method: 'POST', body: {} }), 409, 'INVALID_STATE');
  const detail = await app.request(invoiceUrl);
  assert.deepEqual(detail.body.invoice, rejected.body.invoice);
  assert.equal(detail.body.logs.filter(log => log.result === 'success' && log.action.includes('reject')).length, 1);
});

test('cross-company and nonexistent invoices are indistinguishable and failed attempts do not leak foreign entities into logs', async t => {
  const app = await start(t);
  const foreign = seed.invoices.find(invoice => invoice.companyId !== companyId);
  for (const id of [foreign.id, 'invoice-that-does-not-exist']) {
    expectError(await app.request(`/api/invoices/${id}`), 404, 'NOT_FOUND');
    expectError(await app.request(`/api/invoices/${id}/approve`, { method: 'POST', body: {} }), 404, 'NOT_FOUND');
  }
  const activity = await app.request('/api/activity');
  assert.equal(activity.status, 200);
  assert.ok(activity.body.logs.length >= 4);
  for (const log of activity.body.logs) {
    expectLog(log);
    assert.equal(log.companyId, companyId);
    assert.notEqual(log.entityId, foreign.id);
    assert.equal(log.message.includes(foreign.id), false);
    if (log.result === 'failure') {
      assert.equal(log.entityType, 'system');
      assert.equal(log.entityId, null);
    }
  }
  assert.deepEqual((await app.request(`/api/invoices/${foreign.id}`, { actor: otherOwner })).body.invoice, foreign);
});

test('concurrent conflicting decisions have one winner and one matching successful activity log', async t => {
  const app = await start(t);
  const decisions = await Promise.all([
    app.request(`${invoiceUrl}/approve`, { method: 'POST', body: {} }),
    app.request(`${invoiceUrl}/reject`, { method: 'POST', body: { reason: 'Hold for review' } }),
  ]);
  assert.deepEqual(decisions.map(result => result.status).sort(), [200, 409]);
  const winner = decisions.find(result => result.status === 200).body.invoice;
  expectError(decisions.find(result => result.status === 409), 409, 'INVALID_STATE');
  const detail = (await app.request(invoiceUrl)).body;
  assert.deepEqual(detail.invoice, winner);
  assert.equal(detail.logs.filter(log => log.result === 'success' && /approve|reject/.test(log.action)).length, 1);
  assert.ok((await app.request('/api/activity')).body.logs.some(log => log.result === 'failure'));
});

test('activity pagination is bounded, company-scoped and deterministically ordered', async t => {
  const state = fixture();
  const source = seed.logs[0];
  for (const suffix of ['a', 'b', 'c']) {
    state.logs.push({ ...source, id: `log_order_${suffix}`, companyId, actor: owner.name, role: 'owner', entityType: 'system', entityId: null, action: 'demo.note', result: 'info', message: 'Ordering fixture' });
  }
  const app = await start(t, { seed: state });
  const expected = state.logs.filter(log => log.companyId === companyId)
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || b.id.localeCompare(a.id));
  const activity = await app.request('/api/activity');
  assert.equal(activity.status, 200);
  assert.deepEqual(activity.body.logs, expected.slice(0, 50));
  assert.deepEqual((await app.request('/api/activity?limit=1')).body.logs, expected.slice(0, 1));
  assert.deepEqual((await app.request('/api/activity?limit=200')).body.logs, expected);
  for (const limit of ['0', '201', 'invalid', '1.5']) {
    expectError(await app.request(`/api/activity?limit=${limit}`), 400, 'VALIDATION_ERROR');
  }
});

test('JSON and origin validation reject malformed requests without mutating an invoice', async t => {
  const app = await start(t, { allowedOrigins: ['http://localhost:5173'] });
  const preflight = await app.request(`${invoiceUrl}/approve`, {
    actor: null,
    method: 'OPTIONS',
    headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'X-Demo-User, Content-Type' },
  });
  assert.ok([200, 204].includes(preflight.status));
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  assert.match(preflight.headers.get('access-control-allow-headers'), /x-demo-user/i);
  assert.match(preflight.headers.get('access-control-allow-headers'), /content-type/i);
  assert.equal((await app.request('/api/invoices', { headers: { Origin: app.base } })).status, 200);
  const blocked = await app.request(`${invoiceUrl}/approve`, { method: 'POST', body: {}, headers: { Origin: 'https://untrusted.example' } });
  expectError(blocked, 403, 'FORBIDDEN');
  assert.equal(blocked.headers.get('access-control-allow-origin'), null);
  for (const input of [
    { rawBody: '{broken', headers: { 'Content-Type': 'application/json' } },
    { rawBody: 'not JSON', headers: { 'Content-Type': 'text/plain' } },
    { body: [] },
    { body: null },
  ]) {
    expectError(await app.request(`${invoiceUrl}/approve`, { method: 'POST', ...input }), 400, 'VALIDATION_ERROR');
  }
  assert.equal((await app.request(invoiceUrl)).body.invoice.status, 'pending_approval');
  assert.equal((await app.request(`${invoiceUrl}/approve`, { method: 'POST' })).status, 200, 'An empty request body is valid for an empty contract body');
});

test('approved state and its activity survive restart; reset restores the complete supplied seed', async t => {
  const app = await start(t);
  const originalProjects = (await app.request('/api/projects')).body;
  const approved = await app.request(`${invoiceUrl}/approve`, { method: 'POST', body: {} });
  assert.equal(approved.status, 200);
  await app.request('/api/demo/settings', { method: 'PUT', body: { failNext: { accounting: true, outbox: true } } });
  await app.restart();
  const saved = (await app.request(invoiceUrl)).body;
  assert.deepEqual(saved.invoice, approved.body.invoice);
  assert.equal(saved.logs.filter(log => log.result === 'success' && log.action.includes('approve')).length, 1);
  assert.deepEqual((await app.request('/api/demo/session')).body.settings.failNext, { accounting: true, outbox: true });
  const reset = await app.request('/api/demo/reset', { method: 'POST', body: {} });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.settings.demoDate, seed.settings.demoDate);
  assert.deepEqual(reset.body.settings.failNext, seed.settings.failNext);
  assert.deepEqual((await app.request('/api/projects')).body, originalProjects);
  assert.deepEqual((await app.request(invoiceUrl)).body.invoice, draft);
  const foreignAfterReset = await app.request('/api/invoices', { actor: otherOwner });
  assert.deepEqual(foreignAfterReset.body.invoices, fixture().invoices.filter(invoice => invoice.companyId === otherOwner.companyId));
  await app.restart();
  assert.deepEqual((await app.request(invoiceUrl)).body.invoice, draft);
});

test('shared guards enforce company boundaries, role checks and approval before future execution modules', () => {
  const state = fixture();
  assert.equal(findInvoice(state, owner, draft.id).id, draft.id);
  const foreign = state.invoices.find(invoice => invoice.companyId !== companyId);
  assert.throws(() => findInvoice(state, owner, foreign.id), error => error.code === 'NOT_FOUND');
  assert.throws(() => findInvoice(state, owner, 'unknown'), error => error.code === 'NOT_FOUND');
  assert.doesNotThrow(() => requireRole(owner, ['owner']));
  assert.throws(() => requireRole(pm, ['owner']), error => error.code === 'FORBIDDEN');
  for (const status of ['pending_approval', 'rejected']) {
    assert.throws(() => requireApprovedInvoice({ ...draft, status }), error => error.code === 'INVALID_STATE');
  }
  assert.throws(() => requireApprovedInvoice({ ...draft, status: 'approved', approval: null }), error => error.code === 'INVALID_STATE');
  const approval = { ...seed.invoices.find(invoice => invoice.approval).approval, by: owner.name };
  assert.doesNotThrow(() => requireApprovedInvoice({ ...draft, status: 'approved', approval }));
});

test('unimplemented business modules fail closed without reporting fabricated results', async t => {
  const app = await start(t);
  for (const url of ['/api/overview', '/api/collections', '/api/forecast']) {
    expectError(await app.request(url), 404, 'NOT_FOUND');
  }
  for (const [url, body] of [
    [`/api/milestones/${draft.milestoneId}/complete`, {}],
    [`${invoiceUrl}/payments`, { receivedAt: seed.settings.demoDate }],
    [`${invoiceUrl}/reminders`, {}],
  ]) {
    expectError(await app.request(url, { method: 'POST', body }), 404, 'NOT_FOUND');
  }
  assert.deepEqual((await app.request(invoiceUrl)).body.invoice, draft);
});
