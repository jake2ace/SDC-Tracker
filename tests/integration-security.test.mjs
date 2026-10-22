import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import test from 'node:test';
import { createApplication } from '../src/server.mjs';
import { materializeFixture, readJson } from './helpers.mjs';

const seed = await readJson('../data/demo.json');
const definitions = (await readJson('../data/expected-results.json')).stateFixtures;
const FINANCE = 'u_lumen_fin';
const OWNER = 'u_lumen_owner';
const INVOICE = 'inv_kt_2';
const generatePath = `/api/invoices/${INVOICE}/reminders`;
const draftText = { subject: 'Payment reminder', body: 'Please share an update on the outstanding payment.' };

function fixture(name = 'lumen_issued') {
  const state = materializeFixture(seed, definitions, name);
  state.settings.demoDate = '2026-11-08';
  return state;
}

function deferredGenerator() {
  let enter;
  let finish;
  const started = new Promise(resolve => { enter = resolve; });
  const result = new Promise(resolve => { finish = resolve; });
  let calls = 0;
  return {
    started,
    finish: () => finish({ ...draftText }),
    get calls() { return calls; },
    async generate() {
      calls += 1;
      enter();
      return result;
    },
  };
}

async function start(t, options = {}) {
  const app = createApplication({
    databasePath: ':memory:',
    seed: fixture(),
    demoMode: true,
    allowedOrigins: [],
    allowedHosts: [],
    reminderGenerator: async () => ({ ...draftText }),
    ...options,
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const base = `http://127.0.0.1:${app.server.address().port}`;
  t.after(() => app.close());
  return {
    ...app,
    base,
    async request(path, { method = 'GET', actor = FINANCE, body, headers = {} } = {}) {
      const response = await fetch(base + path, {
        method,
        headers: {
          ...(actor ? { 'X-Demo-User': actor } : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const text = await response.text();
      return { status: response.status, body: text ? JSON.parse(text) : null, headers: response.headers };
    },
    raw(path, { method = 'GET', body = '', headers = {} } = {}) {
      return new Promise((resolve, reject) => {
        const request = httpRequest(base + path, {
          method,
          headers: { 'X-Demo-User': FINANCE, ...headers },
        }, response => {
          let text = '';
          response.setEncoding('utf8');
          response.on('data', chunk => { text += chunk; });
          response.on('error', reject);
          response.on('end', () => resolve({
            status: response.statusCode,
            body: text ? JSON.parse(text) : null,
            headers: response.headers,
          }));
        });
        request.on('error', reject);
        request.end(body);
      });
    },
  };
}

function expectError(response, status, code) {
  assert.equal(response.status, status, JSON.stringify(response.body));
  assert.equal(response.body.error.code, code);
}

test('reset cannot erase a demo while a pending AI result could write back into it', async t => {
  const generator = deferredGenerator();
  const app = await start(t, { reminderGenerator: generator.generate });
  const pending = app.request(generatePath, { method: 'POST', body: {} });
  try {
    await generator.started;
    const before = app.store.read();
    expectError(await app.request('/api/demo/reset', { method: 'POST', body: {} }), 409, 'INVALID_STATE');
    assert.deepEqual(app.store.read().invoices, before.invoices);
    assert.deepEqual(app.store.read().reminders, before.reminders);
  } finally {
    generator.finish();
    await pending;
  }
  assert.equal((await pending).status, 201);
  assert.equal(generator.calls, 1);
  assert.equal(app.store.read().reminders.filter(row => row.invoiceId === INVOICE).length, 1);
  assert.equal((await app.request('/api/demo/reset', { method: 'POST', body: {} })).status, 200);
  assert.deepEqual(app.store.read().reminders, fixture().reminders);
});

test('AI call budget counts real generations, preserves cached drafts, and survives a demo reset', async t => {
  let calls = 0;
  const app = await start(t, {
    aiLimits: { maxCallsPerMinute: 2, maxConcurrent: 2 },
    reminderGenerator: async () => { calls += 1; return { ...draftText }; },
  });
  assert.equal((await app.request(generatePath, { method: 'POST', body: {} })).status, 201);
  for (let index = 0; index < 3; index += 1) {
    assert.equal((await app.request(generatePath, { method: 'POST', body: {} })).status, 200);
  }
  assert.equal(calls, 1, 'Reading the existing draft must not spend another provider call');
  assert.equal((await app.request(generatePath, { method: 'POST', body: { regenerate: true } })).status, 200);
  expectError(await app.request(generatePath, { method: 'POST', body: { regenerate: true } }), 503, 'AI_UNAVAILABLE');
  assert.equal(calls, 2);
  assert.equal((await app.request('/api/demo/reset', { method: 'POST', body: {} })).status, 200);
  expectError(await app.request(generatePath, { method: 'POST', body: {} }), 503, 'AI_UNAVAILABLE');
  assert.equal(calls, 2, 'Reset must not provide a fresh paid API budget');
});

test('AI concurrency is bounded across companies and a finished call releases its slot', async t => {
  const generator = deferredGenerator();
  const app = await start(t, {
    aiLimits: { maxCallsPerMinute: 10, maxConcurrent: 1 },
    reminderGenerator: generator.generate,
  });
  const pending = app.request(generatePath, { method: 'POST', body: {} });
  const foreignPath = '/api/invoices/inv_bd_1/reminders';
  try {
    await generator.started;
    expectError(await app.request(foreignPath, {
      method: 'POST', actor: 'u_rantau_fin', body: { regenerate: true },
    }), 503, 'AI_UNAVAILABLE');
    assert.equal(generator.calls, 1);
  } finally {
    generator.finish();
    await pending;
  }
  assert.equal((await app.request(foreignPath, {
    method: 'POST', actor: 'u_rantau_fin', body: { regenerate: true },
  })).status, 201);
  assert.equal(generator.calls, 2);
});

test('denied requests do not spend the AI budget, and provider failures still consume a call', async t => {
  let calls = 0;
  const privateError = 'provider-private-response-that-must-not-be-exposed';
  const app = await start(t, {
    aiLimits: { maxCallsPerMinute: 1, maxConcurrent: 1 },
    reminderGenerator: async () => { calls += 1; throw new Error(privateError); },
  });
  expectError(await app.request(generatePath, { method: 'POST', actor: 'u_lumen_pm', body: {} }), 403, 'FORBIDDEN');
  expectError(await app.request('/api/invoices/inv_bd_1/reminders', { method: 'POST', body: {} }), 404, 'NOT_FOUND');
  assert.equal(calls, 0);
  const failed = await app.request(generatePath, { method: 'POST', body: {} });
  expectError(failed, 503, 'AI_UNAVAILABLE');
  assert.equal(calls, 1);
  assert.equal(JSON.stringify(failed).includes(privateError), false);
  assert.equal(JSON.stringify(app.store.read()).includes(privateError), false);
  expectError(await app.request(generatePath, { method: 'POST', body: {} }), 503, 'AI_UNAVAILABLE');
  assert.equal(calls, 1);
  assert.equal((await app.request('/api/demo/reset', { method: 'POST', body: {} })).status, 200,
    'A failed generation must release the reset guard');
});

test('allowed frontend can preflight and perform PATCH editing while foreign origins stay blocked', async t => {
  const origin = 'http://localhost:5173';
  const app = await start(t, { allowedOrigins: [origin] });
  const generated = await app.request(generatePath, { method: 'POST', body: {} });
  assert.equal(generated.status, 201);
  const path = `/api/reminders/${generated.body.reminder.id}`;
  const preflight = await app.request(path, {
    method: 'OPTIONS', actor: null,
    headers: { Origin: origin, 'Access-Control-Request-Method': 'PATCH', 'Access-Control-Request-Headers': 'content-type,x-demo-user' },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), origin);
  assert.ok(preflight.headers.get('access-control-allow-methods').split(/,\s*/).includes('PATCH'));
  const edited = await app.request(path, {
    method: 'PATCH', body: { subject: 'Reviewed reminder', body: 'The finance team has reviewed this reminder.' },
    headers: { Origin: origin },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.reminder.subject, 'Reviewed reminder');
  expectError(await app.request(path, {
    method: 'PATCH', body: draftText, headers: { Origin: 'https://foreign.example' },
  }), 403, 'FORBIDDEN');
  assert.equal(app.store.read().reminders.find(row => row.id === generated.body.reminder.id).subject, 'Reviewed reminder');
});

test('Host validation rejects rebinding even with a matching Origin and permits only configured hosts', async t => {
  const app = await start(t, { allowedHosts: ['tracker.example'] });
  assert.equal((await app.request('/health', { actor: null })).status, 200);
  const allowed = await app.raw('/health', { headers: { Host: 'tracker.example', Origin: 'https://tracker.example' } });
  assert.equal(allowed.status, 200);
  for (const host of ['attacker.example', 'tracker.example.attacker.example', 'tracker.example:1234']) {
    expectError(await app.raw('/health', { headers: { Host: host, Origin: `http://${host}` } }), 403, 'FORBIDDEN');
  }
});

test('read-only HTTP endpoints reject request bodies before consulting business logic', async t => {
  const app = await start(t);
  for (const path of ['/api/forecast', '/api/demo/session', '/api/activity']) {
    expectError(await app.raw(path, {
      body: '{}', headers: { 'Content-Type': 'application/json', 'Content-Length': '2' },
    }), 400, 'VALIDATION_ERROR');
  }
  assert.deepEqual(app.store.read().invoices, fixture().invoices);
  assert.deepEqual(app.store.read().reminders, fixture().reminders);
});

test('rejection reasons reject markup and hidden control characters without saving them', async t => {
  const initial = fixture('lumen_draft');
  const app = await start(t, { seed: initial });
  const path = `/api/invoices/${INVOICE}/reject`;
  for (const reason of [
    'Unsafe <img src=x>', 'Bad\u0000text', 'Bad\ntext', 'Bad\rtext', 'Bad\ttext',
    'Bad\u0085text', 'Bad\u202etext', 'Bad\u200btext',
  ]) {
    expectError(await app.request(path, { method: 'POST', actor: OWNER, body: { reason } }), 400, 'VALIDATION_ERROR');
    assert.deepEqual(app.store.read().invoices, initial.invoices);
    assert.equal(app.store.read().logs.some(log => log.message.includes(reason)), false);
  }
  const accepted = await app.request(path, {
    method: 'POST', actor: OWNER, body: { reason: 'Please confirm the delivery evidence.' },
  });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.invoice.approval.reason, 'Please confirm the delivery evidence.');
});
