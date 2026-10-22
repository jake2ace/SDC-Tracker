import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { routeCollectionsRequest } from '../src/collections/routes.mjs';
import { createCollectionsService } from '../src/collections/service.mjs';

function recordingService(result = { status: 200, body: { items: [] } }) {
  const calls = [];
  const service = Object.fromEntries([
    'listCollections', 'generateReminder', 'editReminder', 'sendReminder', 'recordPayment',
  ].map(name => [name, async (...args) => {
    calls.push([name, ...args]);
    return result;
  }]));
  return { service, calls, result };
}

test('collection routes preserve the trusted identity, exact inputs and service response', async () => {
  const cases = [
    [{ method: 'GET', pathname: '/api/collections' }, ['listCollections', 'trusted-user', {}]],
    [{ method: 'GET', pathname: '/api/collections', query: new URLSearchParams('filter=unpaid') },
      ['listCollections', 'trusted-user', { filter: 'unpaid' }]],
    [{ method: 'POST', pathname: '/api/invoices/inv%5F1/reminders', body: { regenerate: true } },
      ['generateReminder', 'trusted-user', 'inv_1', { regenerate: true }]],
    [{ method: 'PATCH', pathname: '/api/reminders/rem_1', body: { subject: 'Reviewed', body: 'Please pay.' } },
      ['editReminder', 'trusted-user', 'rem_1', { subject: 'Reviewed', body: 'Please pay.' }]],
    [{ method: 'POST', pathname: '/api/reminders/rem_1/send' }, ['sendReminder', 'trusted-user', 'rem_1', {}]],
    [{ method: 'POST', pathname: '/api/invoices/inv_1/payments', body: { receivedAt: '2026-10-22', userId: 'forged' } },
      ['recordPayment', 'trusted-user', 'inv_1', { receivedAt: '2026-10-22', userId: 'forged' }]],
  ];
  for (const [request, expected] of cases) {
    const { service, calls, result } = recordingService();
    assert.equal(await routeCollectionsRequest(service, { ...request, userId: 'trusted-user' }), result);
    assert.deepEqual(calls, [expected]);
  }
});

test('invalid queries and URI IDs fail before service delegation', async () => {
  const cases = [
    { method: 'GET', pathname: '/api/collections', query: { filter: 'overdue' } },
    { method: 'GET', pathname: '/api/collections', query: new URLSearchParams('filter=paid&filter=unpaid') },
    { method: 'GET', pathname: '/api/collections', query: new URLSearchParams('companyId=co_other') },
    { method: 'POST', pathname: '/api/invoices/inv_1/reminders', query: new URLSearchParams('regenerate=true') },
    { method: 'PATCH', pathname: '/api/reminders/rem_1', query: new URLSearchParams('subject=forged') },
    { method: 'POST', pathname: '/api/reminders/rem_1/send', query: new URLSearchParams('userId=forged') },
    { method: 'POST', pathname: '/api/invoices/inv_1/payments', query: new URLSearchParams('receivedAt=2026-10-22') },
    ...['', '%', '%E0%A4', '%2F', 'inv%2F1', 'inv%5C1', '%00', '%20', 'inv?x=1', 'inv#x']
      .map(id => ({ method: 'POST', pathname: `/api/invoices/${id}/reminders` })),
    { method: 'PATCH', pathname: '/api/reminders/' },
    { method: 'PATCH', pathname: '/api/reminders/rem%0A1' },
    { method: 'POST', pathname: '/api/reminders//send' },
    { method: 'POST', pathname: '/api/invoices//payments' },
  ];
  for (const request of cases) {
    const { service, calls } = recordingService();
    const result = await routeCollectionsRequest(service, request);
    assert.equal(result.status, 400, request.pathname);
    assert.equal(result.body.error.code, 'VALIDATION_ERROR');
    assert.equal(typeof result.body.error.message, 'string');
    assert.deepEqual(result.body.error.details, {});
    assert.deepEqual(calls, []);
  }
});

test('unowned paths and methods fall through and service errors keep their status', async () => {
  const { service, calls } = recordingService();
  for (const [method, pathname] of [
    ['POST', '/api/collections'], ['GET', '/api/collections/'], ['HEAD', '/api/collections'],
    ['GET', '/api/invoices/inv_1/reminders'], ['POST', '/api/reminders/rem_1'],
    ['PATCH', '/api/reminders/rem_1/send'], ['GET', '/api/invoices/inv_1/payments'],
    ['POST', '/api/invoices/inv_1/issue'], ['POST', '/api/invoices/inv_1/approve'],
    ['GET', '/api/invoices'], ['GET', '/api/demo/session'],
    ['POST', '/api/invoices/inv_1/reminders/'], ['POST', '/api/reminders/rem_1/send/extra'],
    ['POST', '/api/reminders/rem_1/send\n'], ['POST', '/api/invoices/inv_1/payments\n'],
    ['GET', '/prefix/api/collections'], ['GET', '/api/collectionsExtra'],
  ]) {
    assert.equal(await routeCollectionsRequest(service, { method, pathname, query: null }), null,
      `${method} ${pathname} should fall through`);
  }
  assert.deepEqual(calls, []);
  for (const [status, code] of [[400, 'VALIDATION_ERROR'], [401, 'UNAUTHENTICATED'],
    [403, 'FORBIDDEN'], [404, 'NOT_FOUND'], [409, 'INVALID_STATE'],
    [502, 'UPSTREAM_FAILED'], [503, 'AI_UNAVAILABLE']]) {
    const result = { status, body: { error: { code, message: 'test', details: { retryable: true } } } };
    assert.equal(await routeCollectionsRequest(recordingService(result).service,
      { method: 'GET', pathname: '/api/collections' }), result);
  }
  const failure = new Error('store unavailable');
  await assert.rejects(routeCollectionsRequest({ listCollections: async () => { throw failure; } },
    { method: 'GET', pathname: '/api/collections' }), error => error === failure);
});

// Test-only server and sessions. Issue #2 supplies the production host and store.
async function httpFixture(t) {
  let state = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
  let queue = Promise.resolve();
  let failGeneration = false;
  let generations = 0;
  const store = {
    read: () => queue.then(() => structuredClone(state)),
    transaction(fn) {
      const work = queue.then(() => {
        const draft = structuredClone(state);
        const result = fn(draft);
        if (result && typeof result.then === 'function') throw new TypeError('Synchronous transactions required');
        state = structuredClone(draft);
        return structuredClone(result);
      });
      queue = work.then(() => undefined, () => undefined);
      return work;
    },
  };
  const service = createCollectionsService({
    store,
    now: () => new Date('2026-10-22T14:00:00.000Z'),
    generator: async () => {
      generations += 1;
      if (failGeneration) throw new Error('Test provider is unavailable');
      return { subject: 'Reminder: RE-2026-0001', body: 'Please arrange payment of the overdue invoice.' };
    },
  });
  const sessions = new Map([
    ['finance', 'u_rantau_fin'], ['owner', 'u_rantau_owner'],
    ['pm', 'u_rantau_pm'], ['other-company', 'u_lumen_fin'],
  ]);
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      let text = '';
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : {};
      const token = request.headers.authorization?.replace(/^Bearer /, '');
      const result = await routeCollectionsRequest(service, {
        method: request.method, pathname: url.pathname, query: url.searchParams, body,
        userId: sessions.get(token),
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
    state: () => store.read(),
    mutate: fn => store.transaction(fn),
    failGeneration: value => { failGeneration = value; },
    generations: () => generations,
    async request(path, { method = 'GET', body, session = 'finance' } = {}) {
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

test('actual HTTP enforces session identity, company boundary and direct contract errors', async t => {
  const fixture = await httpFixture(t);
  const list = await fixture.request('/api/collections', { session: 'owner' });
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].invoice.id, 'inv_bd_1');
  assert.equal(list.body.items[0].overdueDays, 2);
  assert.equal(Object.hasOwn(list.body, 'data'), false);
  for (const [path, options, status, code] of [
    ['/api/collections?filter=unknown', {}, 400, 'VALIDATION_ERROR'],
    ['/api/collections?filter=paid&filter=overdue', {}, 400, 'VALIDATION_ERROR'],
    ['/api/invoices/%E0%A4/reminders', { method: 'POST' }, 400, 'VALIDATION_ERROR'],
    ['/api/reminders/rem%2F1/send', { method: 'POST' }, 400, 'VALIDATION_ERROR'],
    ['/api/collections', { session: null }, 401, 'UNAUTHENTICATED'],
    ['/api/collections', { session: 'pm' }, 403, 'FORBIDDEN'],
    ['/api/invoices/inv_bd_1/reminders', { method: 'POST', session: 'other-company' }, 404, 'NOT_FOUND'],
    ['/api/invoices/inv_bd_1/reminders', { method: 'POST', session: 'owner' }, 403, 'FORBIDDEN'],
    ['/api/invoices/inv_bd_1/reminders', { method: 'POST', body: { userId: 'u_rantau_fin' } }, 400, 'VALIDATION_ERROR'],
    ['/api/invoices/inv_bd_1/payments', { method: 'POST', body: { receivedAt: '2026-10-23' } }, 400, 'VALIDATION_ERROR'],
    ['/api/invoices/inv_bd_1/payments', { method: 'POST', body: { receivedAt: '2026-10-22', amount: 1 } }, 400, 'VALIDATION_ERROR'],
  ]) {
    const result = await fixture.request(path, options);
    assert.equal(result.status, status, path);
    assert.equal(result.body.error.code, code, path);
    assert.equal(typeof result.body.error.details, 'object');
    assert.equal(Object.hasOwn(result.body, 'data'), false);
  }
  assert.equal(fixture.generations(), 0);
  assert.deepEqual(await fixture.request('/api/invoices/inv_bd_1/issue', { method: 'POST' }),
    { status: 404, body: { hostFallback: true } });
});

test('actual HTTP covers AI draft, review, safe failures, idempotent send and payment cancellation', async t => {
  const fixture = await httpFixture(t);
  const generatePath = '/api/invoices/inv_bd_1/reminders';
  const generated = await fixture.request(generatePath, { method: 'POST', body: {} });
  assert.ok([200, 201].includes(generated.status));
  assert.equal(generated.body.reminder.source, 'ai');
  assert.equal(generated.body.reminder.status, 'draft');
  assert.equal(generated.body.reminder.sequence, 2);
  assert.equal(generated.body.reminder.tone, 'firm');
  const id = generated.body.reminder.id;
  const reminderPath = `/api/reminders/${id}`;
  const sendPath = `${reminderPath}/send`;
  const repeat = await fixture.request(generatePath, { method: 'POST' });
  assert.equal(repeat.status, 200);
  assert.equal(repeat.body.reminder.id, id);
  assert.equal(fixture.generations(), 1);

  const reviewed = await fixture.request(reminderPath, {
    method: 'PATCH', body: { subject: 'Reviewed reminder', body: 'Please confirm the payment date.' },
  });
  assert.equal(reviewed.status, 200);
  assert.equal(reviewed.body.reminder.subject, 'Reviewed reminder');
  fixture.failGeneration(true);
  const failedAI = await fixture.request(generatePath, { method: 'POST', body: { regenerate: true } });
  assert.equal(failedAI.status, 503);
  assert.equal(failedAI.body.error.code, 'AI_UNAVAILABLE');
  const { reviewToken, ...storedReminder } = reviewed.body.reminder;
  assert.deepEqual((await fixture.state()).reminders.find(row => row.id === id), storedReminder);
  fixture.failGeneration(false);

  await fixture.mutate(state => { state.settings.failNext.outbox = true; });
  const failedSend = await fixture.request(sendPath, { method: 'POST', body: { reviewToken } });
  assert.equal(failedSend.status, 502);
  assert.equal(failedSend.body.error.code, 'UPSTREAM_FAILED');
  const retained = (await fixture.state()).reminders.find(row => row.id === id);
  assert.equal(retained.status, 'draft');
  assert.ok(retained.lastSendError);
  const sent = await fixture.request(sendPath, { method: 'POST', body: { reviewToken } });
  assert.equal(sent.status, 200);
  assert.equal(sent.body.reminder.status, 'sent');
  assert.equal(sent.body.outbox.simulation, true);
  const sendAgain = await fixture.request(sendPath, { method: 'POST', body: { reviewToken } });
  assert.deepEqual(sendAgain, sent);
  assert.equal((await fixture.state()).mockOutbox.filter(row => row.reminderId === id).length, 1);

  const next = await fixture.request(generatePath, { method: 'POST' });
  assert.ok([200, 201].includes(next.status));
  assert.equal(next.body.reminder.sequence, 3);
  assert.equal(next.body.reminder.tone, 'final');
  const payment = await fixture.request('/api/invoices/inv_bd_1/payments', {
    method: 'POST', body: { receivedAt: '2026-10-22' },
  });
  assert.ok([200, 201].includes(payment.status));
  assert.equal(payment.body.invoice.status, 'paid');
  assert.equal(payment.body.payment.amount, 1350000);
  assert.equal(payment.body.cancelledReminders[0].id, next.body.reminder.id);
  assert.equal(payment.body.cancelledReminders[0].status, 'cancelled');
  const paymentAgain = await fixture.request('/api/invoices/inv_bd_1/payments', {
    method: 'POST', body: { receivedAt: '2026-10-22' },
  });
  assert.equal(paymentAgain.status, 200);
  assert.equal(paymentAgain.body.payment.id, payment.body.payment.id);
  assert.equal((await fixture.state()).payments.length, 1);
  assert.deepEqual((await fixture.request('/api/collections')).body.items, []);
  assert.equal((await fixture.request('/api/collections?filter=paid')).body.items[0].invoice.id, 'inv_bd_1');
  const cancelledSend = await fixture.request(`/api/reminders/${next.body.reminder.id}/send`, {
    method: 'POST', body: { reviewToken: next.body.reminder.reviewToken },
  });
  assert.equal(cancelledSend.status, 409);
  assert.equal(cancelledSend.body.error.code, 'INVALID_STATE');
  const paidGeneration = await fixture.request(generatePath, { method: 'POST' });
  assert.equal(paidGeneration.status, 409);
  assert.deepEqual(await fixture.request(sendPath, { method: 'POST', body: { reviewToken } }), sent);
});

test('HTTP exposes an explicit manual fallback and rejects a stale confirmation before sending', async t => {
  const fixture = await httpFixture(t);
  const path = '/api/invoices/inv_bd_1/reminders';
  fixture.failGeneration(true);
  assert.equal((await fixture.request(path, { method: 'POST' })).status, 503);
  const created = await fixture.request(path, { method: 'POST', body: { useTemplate: true } });
  assert.equal(created.status, 201);
  const original = created.body.reminder;
  assert.equal(original.source, 'manual_template');
  assert.equal(fixture.generations(), 1);
  assert.match(original.body, /RM 13,500\.00/);
  const reminderPath = `/api/reminders/${original.id}`;
  const edited = await fixture.request(reminderPath, {
    method: 'PATCH', body: { subject: 'Updated in second tab', body: original.body },
  });
  assert.equal(edited.status, 200);
  assert.notEqual(edited.body.reminder.reviewToken, original.reviewToken);
  const count = (await fixture.state()).mockOutbox.length;
  const missing = await fixture.request(`${reminderPath}/send`, { method: 'POST' });
  assert.equal(missing.status, 400);
  const stale = await fixture.request(`${reminderPath}/send`, {
    method: 'POST', body: { reviewToken: original.reviewToken },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'DRAFT_CHANGED');
  assert.equal(stale.body.error.details.reviewRequired, true);
  assert.equal((await fixture.state()).mockOutbox.length, count);
  const accepted = await fixture.request(`${reminderPath}/send`, {
    method: 'POST', body: { reviewToken: edited.body.reminder.reviewToken },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.outbox.subject, edited.body.reminder.subject);
  assert.equal((await fixture.state()).mockOutbox.length, count + 1);
});
