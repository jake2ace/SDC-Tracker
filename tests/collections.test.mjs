import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createCollectionsService } from '../src/collections/service.mjs';
import { validateState } from '../contracts/validate.mjs';
import { materializeFixture } from './helpers.mjs';
import { createSqliteTestStore } from './support/invoicing-store.mjs';

const seed = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
const definitions = JSON.parse(await readFile(new URL('../data/expected-results.json', import.meta.url), 'utf8')).stateFixtures;
const FINANCE = 'u_lumen_fin';
const OWNER = 'u_lumen_owner';
const PM = 'u_lumen_pm';
const INVOICE = 'inv_kt_2';
const FOREIGN_INVOICE = 'inv_bd_1';
const now = () => new Date('2026-11-08T04:00:00.000Z');
const copy = { subject: 'Payment reminder: SL-2026-0001', body: 'Please arrange payment for invoice SL-2026-0001.' };

async function setup(t, { fixture = 'lumen_issued', date = '2026-11-08', generator } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sdc-collections-'));
  const filename = join(directory, 'state.sqlite');
  const initial = materializeFixture(seed, definitions, fixture);
  initial.settings.demoDate = date;
  const calls = [];
  const generate = generator ?? (async input => { calls.push(structuredClone(input)); return { ...copy }; });
  const stores = [];
  const connect = (customGenerator = generate) => {
    const store = createSqliteTestStore(filename, initial);
    stores.push(store);
    return { store, service: createCollectionsService({ store, generator: customGenerator, now }) };
  };
  t.after(async () => {
    for (const store of stores) store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...connect(), connect, calls };
}

function ok(result, statuses = [200, 201]) {
  assert.ok(statuses.includes(result.status), JSON.stringify(result));
  assert.equal(result.body.error, undefined);
  return result.body;
}

function error(result, status, code) {
  assert.equal(result.status, status, JSON.stringify(result));
  assert.equal(result.body.error.code, code);
  assert.equal(typeof result.body.error.message, 'string');
  assert.ok(result.body.error.details && typeof result.body.error.details === 'object');
  assert.equal(Array.isArray(result.body.error.details), false);
}

const generate = async h => ok(await h.service.generateReminder(FINANCE, INVOICE)).reminder;
const valid = async h => assert.deepEqual(validateState(await h.store.read()), []);
const reviewed = reminder => ({ reviewToken: reminder.reviewToken });
const stored = ({ reviewToken, ...reminder }) => reminder;

function deferredGenerator() {
  let resolveStarted;
  let resolveResult;
  const started = new Promise(resolve => { resolveStarted = resolve; });
  const result = new Promise(resolve => { resolveResult = resolve; });
  return {
    started,
    finish(value = copy) { resolveResult({ ...value }); },
    async generator(input) { resolveStarted(structuredClone(input)); return result; },
  };
}

test('collections lists owned debt with contract filters and computes overdue days', async t => {
  const h = await setup(t);
  for (const user of [FINANCE, OWNER]) {
    const { items } = ok(await h.service.listCollections(user));
    assert.equal(items.length, 1);
    assert.equal(items[0].invoice.id, INVOICE);
    assert.equal(items[0].client.id, 'cl_kopitiga');
    assert.equal(items[0].overdueDays, 3);
    assert.deepEqual(items[0].reminders, []);
  }
  assert.equal(ok(await h.service.listCollections(FINANCE, { filter: 'unpaid' })).items.length, 1);
  assert.deepEqual(ok(await h.service.listCollections(FINANCE, { filter: 'paid' })).items, []);
  await h.store.transaction(state => { state.settings.demoDate = '2026-11-05'; });
  assert.deepEqual(ok(await h.service.listCollections(FINANCE)).items, []);
  assert.equal(ok(await h.service.listCollections(FINANCE, { filter: 'unpaid' })).items[0].overdueDays, 0);
});

test('authentication, role restrictions and foreign-company objects are checked before work', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  const actions = user => [
    () => h.service.generateReminder(user, INVOICE),
    () => h.service.editReminder(user, draft.id, copy),
    () => h.service.sendReminder(user, draft.id, reviewed(draft)),
    () => h.service.recordPayment(user, INVOICE, { receivedAt: '2026-11-08' }),
  ];
  for (const user of [undefined, 'missing-user']) {
    error(await h.service.listCollections(user), 401, 'UNAUTHENTICATED');
    for (const action of actions(user)) error(await action(), 401, 'UNAUTHENTICATED');
  }
  error(await h.service.listCollections(PM), 403, 'FORBIDDEN');
  for (const user of [OWNER, PM]) {
    for (const action of actions(user)) error(await action(), 403, 'FORBIDDEN');
  }
  const foreignReminder = seed.reminders.find(row => row.invoiceId === FOREIGN_INVOICE);
  error(await h.service.generateReminder(FINANCE, FOREIGN_INVOICE), 404, 'NOT_FOUND');
  error(await h.service.editReminder(FINANCE, foreignReminder.id, copy), 404, 'NOT_FOUND');
  error(await h.service.sendReminder(FINANCE, foreignReminder.id, reviewed(draft)), 404, 'NOT_FOUND');
  error(await h.service.recordPayment(FINANCE, FOREIGN_INVOICE, { receivedAt: '2026-11-08' }), 404, 'NOT_FOUND');
  assert.equal(h.calls.length, 1);
  const state = await h.store.read();
  assert.equal(state.mockOutbox.length, seed.mockOutbox.length);
  assert.equal(state.payments.length, seed.payments.length);
  assert.ok(state.logs.some(row => row.result === 'denied' && row.companyId === 'co_lumen'));
  await valid(h);
});

test('strict request validation prevents caller overrides and empty edited content', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  for (const query of [{ filter: 'all' }, { companyId: 'co_rantau' }, null, []]) {
    error(await h.service.listCollections(FINANCE, query), 400, 'VALIDATION_ERROR');
  }
  for (const body of [{ regenerate: 'true' }, { useTemplate: 'true' }, { amount: 1 }, { source: 'ai' }, null, []]) {
    error(await h.service.generateReminder(FINANCE, INVOICE, body), 400, 'VALIDATION_ERROR');
  }
  for (const body of [null, [], {}, { subject: ' ', body: 'hello' }, { subject: 'hi', body: '\n ' },
    { subject: 'x'.repeat(201), body: 'hello' }, { subject: 'hi', body: 'x'.repeat(4001) },
    { ...copy, companyId: 'co_rantau' }]) {
    error(await h.service.editReminder(FINANCE, draft.id, body), 400, 'VALIDATION_ERROR');
  }
  for (const body of [{}, { reviewToken: '' }, { reviewToken: 'x'.repeat(64) }, { reviewToken: 1 },
    { ...reviewed(draft), to: 'attacker@example.test' }, { approved: true }, null, []]) {
    error(await h.service.sendReminder(FINANCE, draft.id, body), 400, 'VALIDATION_ERROR');
  }
  for (const body of [null, [], {}, { receivedAt: '2026-02-30' }, { receivedAt: '2026-10-21' },
    { receivedAt: '2026-11-09' }, { receivedAt: '2026-11-08', amount: 1 },
    { receivedAt: '2026-11-08', companyId: 'co_rantau' }]) {
    error(await h.service.recordPayment(FINANCE, INVOICE, body), 400, 'VALIDATION_ERROR');
  }
  assert.equal(h.calls.length, 1);
  assert.deepEqual((await h.store.read()).reminders.find(row => row.id === draft.id), stored(draft));
  await valid(h);
});

test('generation supplies trusted facts, creates one AI draft, and does not send it', async t => {
  const h = await setup(t);
  const reminder = await generate(h);
  assert.deepEqual(h.calls, [{
    companyName: 'Studio Lumen', clientName: 'Kopi Tiga', tone: 'gentle',
    facts: { amount: 1800000, overdueDays: 3, dueDate: '2026-11-05', invoiceNo: 'SL-2026-0001', previousReminders: 0 },
  }]);
  assert.equal(reminder.invoiceId, INVOICE);
  assert.equal(reminder.companyId, 'co_lumen');
  assert.equal(reminder.status, 'draft');
  assert.equal(reminder.source, 'ai');
  assert.equal(reminder.sequence, 1);
  assert.equal(reminder.tone, 'gentle');
  assert.deepEqual(reminder.facts, h.calls[0].facts);
  assert.equal(reminder.subject, copy.subject);
  assert.equal(reminder.body, copy.body);
  assert.equal(reminder.createdBy, 'Priya Nair');
  assert.equal(Date.parse(reminder.createdAt), now().getTime());
  assert.ok(reminder.sendRequestId);
  for (const key of ['editedAt', 'sentAt', 'sentBy', 'lastSendError', 'cancelReason']) assert.equal(reminder[key], null);
  const retry = ok(await h.service.generateReminder(FINANCE, INVOICE), [200]).reminder;
  assert.deepEqual(retry, reminder);
  assert.equal(h.calls.length, 1, 'returning an existing draft must not spend another model call');
  assert.equal((await h.store.read()).mockOutbox.length, seed.mockOutbox.length);
  await valid(h);
});

test('only unpaid overdue invoices can generate reminders', async t => {
  for (const options of [{ date: '2026-11-05' }, { date: '2026-11-04' }, { fixture: 'lumen_draft' }, { fixture: 'lumen_paid' }]) {
    await t.test(JSON.stringify(options), async t => {
      const h = await setup(t, options);
      error(await h.service.generateReminder(FINANCE, INVOICE), 409, 'INVALID_STATE');
      assert.equal(h.calls.length, 0);
      assert.equal((await h.store.read()).reminders.length, seed.reminders.length);
    });
  }
});

test('editing trims user text and regeneration retains the same reminder and send IDs', async t => {
  const h = await setup(t);
  const original = await generate(h);
  const edited = ok(await h.service.editReminder(FINANCE, original.id, { subject: '  Please pay  ', body: '\nThanks for checking. \n' })).reminder;
  assert.equal(edited.subject, 'Please pay');
  assert.equal(edited.body, 'Thanks for checking.');
  assert.equal(Date.parse(edited.editedAt), now().getTime());
  const fresh = h.connect(async () => ({ subject: 'Refreshed subject', body: 'Refreshed text' }));
  const regenerated = ok(await fresh.service.generateReminder(FINANCE, INVOICE, { regenerate: true })).reminder;
  assert.equal(regenerated.id, original.id);
  assert.equal(regenerated.sendRequestId, original.sendRequestId);
  assert.equal(regenerated.sequence, 1);
  assert.equal(regenerated.subject, 'Refreshed subject');
  assert.equal(regenerated.body, 'Refreshed text');
  assert.equal(regenerated.source, 'ai');
  assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE).length, 1);
  await valid(h);
});

test('AI failure neither creates a partial draft nor overwrites an existing edited draft', async t => {
  const h = await setup(t);
  const broken = h.connect(async () => { throw new Error('provider failure with sk-test-never-expose'); });
  const first = await broken.service.generateReminder(FINANCE, INVOICE);
  error(first, 503, 'AI_UNAVAILABLE');
  assert.equal(JSON.stringify(first).includes('sk-test-never-expose'), false);
  assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE).length, 0);
  const draft = await generate(h);
  const edited = ok(await h.service.editReminder(FINANCE, draft.id, { subject: 'User subject', body: 'User text' })).reminder;
  error(await broken.service.generateReminder(FINANCE, INVOICE, { regenerate: true }), 503, 'AI_UNAVAILABLE');
  assert.deepEqual((await h.store.read()).reminders.find(row => row.id === draft.id), stored(edited));
  assert.equal(JSON.stringify((await h.store.read()).logs).includes('sk-test-never-expose'), false);
  assert.ok((await h.store.read()).logs.some(row => row.result === 'failure'));
  await valid(h);
});

test('malformed generator output cannot be stored as an AI draft', async t => {
  for (const output of [null, { subject: '', body: 'hello' }, { subject: 'hello', body: '' },
    { subject: 'x'.repeat(201), body: 'hello' }, { subject: 'hello', body: 'x'.repeat(4001) },
    { subject: 12, body: 'hello' }]) {
    await t.test(JSON.stringify(output).slice(0, 60), async t => {
      const h = await setup(t, { generator: async () => output });
      error(await h.service.generateReminder(FINANCE, INVOICE), 503, 'AI_UNAVAILABLE');
      assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE).length, 0);
    });
  }
});

test('send requires explicit action and creates one simulated receipt even after retries and payment', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  const sent = ok(await h.service.sendReminder(FINANCE, draft.id, reviewed(draft)));
  assert.equal(sent.reminder.status, 'sent');
  assert.equal(sent.reminder.sentBy, 'Priya Nair');
  assert.equal(sent.outbox.requestId, draft.sendRequestId);
  assert.equal(sent.outbox.reminderId, draft.id);
  assert.equal(sent.outbox.to, seed.clients.find(row => row.id === 'cl_kopitiga').email);
  assert.equal(sent.outbox.subject, draft.subject);
  assert.equal(sent.outbox.sentAt, sent.reminder.sentAt);
  assert.equal(sent.outbox.simulation, true);
  const other = h.connect();
  const retries = await Promise.all(Array.from({ length: 8 }, (_, index) =>
    (index % 2 ? h : other).service.sendReminder(FINANCE, draft.id, reviewed(draft))));
  for (const retry of retries) assert.deepEqual(ok(retry, [200]), sent);
  ok(await h.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-11-08' }));
  assert.deepEqual(ok(await other.service.sendReminder(FINANCE, draft.id, reviewed(draft)), [200]), sent);
  error(await h.service.sendReminder(OWNER, draft.id, reviewed(draft)), 403, 'FORBIDDEN');
  error(await h.service.editReminder(FINANCE, draft.id, copy), 409, 'INVALID_STATE');
  const state = await h.store.read();
  assert.equal(state.mockOutbox.filter(row => row.requestId === draft.sendRequestId).length, 1);
  assert.equal(state.logs.filter(row => row.action === 'reminder.send' && row.result === 'success' && row.entityId === draft.id).length, 1);
  await valid(h);
});

test('outbox failure is consumed once, persists draft error and retries with the original request ID', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  await h.store.transaction(state => { state.settings.failNext.outbox = true; });
  error(await h.service.sendReminder(FINANCE, draft.id, reviewed(draft)), 502, 'UPSTREAM_FAILED');
  const failed = await h.store.read();
  const failedDraft = failed.reminders.find(row => row.id === draft.id);
  assert.equal(failed.settings.failNext.outbox, false);
  assert.equal(failedDraft.status, 'draft');
  assert.ok(failedDraft.lastSendError);
  assert.equal(failedDraft.sendRequestId, draft.sendRequestId);
  assert.equal(failed.mockOutbox.length, seed.mockOutbox.length);
  assert.ok(failed.logs.some(row => row.action === 'reminder.send' && row.result === 'failure'));
  const sent = ok(await h.service.sendReminder(FINANCE, draft.id, reviewed(draft)));
  assert.equal(sent.outbox.requestId, draft.sendRequestId);
  assert.equal(sent.reminder.lastSendError, null);
  await valid(h);
});

test('a captured review cannot send content changed by another connection', async t => {
  const h = await setup(t);
  const original = await generate(h);
  const other = h.connect();
  const edited = ok(await other.service.editReminder(FINANCE, original.id, {
    subject: 'Changed in another tab', body: 'This message has not been reviewed in the first tab.',
  })).reminder;
  assert.notEqual(edited.reviewToken, original.reviewToken);
  await h.store.transaction(state => { state.settings.failNext.outbox = true; });
  const stale = await h.service.sendReminder(FINANCE, original.id, reviewed(original));
  error(stale, 409, 'DRAFT_CHANGED');
  assert.equal(stale.body.error.details.reviewRequired, true);
  const blocked = await h.store.read();
  assert.equal(blocked.mockOutbox.length, seed.mockOutbox.length);
  assert.equal(blocked.settings.failNext.outbox, true, 'Version rejection happens before an outbox attempt');
  assert.ok(blocked.logs.some(row => row.entityId === original.id && row.action === 'reminder.send' && row.result === 'denied'));
  error(await h.service.sendReminder(FINANCE, original.id, reviewed(edited)), 502, 'UPSTREAM_FAILED');
  const sent = ok(await h.service.sendReminder(FINANCE, original.id, reviewed(edited)));
  assert.equal(sent.outbox.subject, edited.subject);
  assert.equal(sent.reminder.body, edited.body);
  assert.equal(sent.reminder.reviewToken, edited.reviewToken);
  assert.deepEqual(ok(await other.service.sendReminder(FINANCE, original.id, reviewed(edited))), sent);
  await valid(h);
});

test('review tokens bind recipient identity, invoice facts and regenerated content', async t => {
  for (const [label, change] of [
    ['email', state => { state.clients.find(row => row.id === 'cl_kopitiga').email = 'changed@example.test'; }],
    ['contact name', state => { state.clients.find(row => row.id === 'cl_kopitiga').contactName = 'Different contact'; }],
    ['client name', state => { state.clients.find(row => row.id === 'cl_kopitiga').name = 'Different client'; }],
    ['company name', state => { state.companies.find(row => row.id === 'co_lumen').name = 'Different company'; }],
    ['invoice amount', state => { state.invoices.find(row => row.id === INVOICE).amount += 1; }],
  ]) {
    await t.test(label, async t => {
      const h = await setup(t);
      const original = await generate(h);
      await h.store.transaction(change);
      error(await h.service.sendReminder(FINANCE, original.id, reviewed(original)), 409, 'DRAFT_CHANGED');
      assert.equal((await h.store.read()).mockOutbox.length, seed.mockOutbox.length);
    });
  }
  const h = await setup(t);
  const original = await generate(h);
  const other = h.connect(async () => ({ subject: 'Regenerated subject', body: 'Regenerated safe text.' }));
  const updated = ok(await other.service.generateReminder(FINANCE, INVOICE, { regenerate: true })).reminder;
  assert.notEqual(updated.reviewToken, original.reviewToken);
  error(await h.service.sendReminder(FINANCE, original.id, reviewed(original)), 409, 'DRAFT_CHANGED');
  ok(await h.service.sendReminder(FINANCE, updated.id, reviewed(updated)));
  await valid(h);
});

test('explicit manual fallback is labelled, locally validated, editable and still requires review', async t => {
  let modelCalls = 0;
  const h = await setup(t, { generator: async () => { modelCalls++; throw new Error('Provider unavailable'); } });
  error(await h.service.generateReminder(FINANCE, INVOICE), 503, 'AI_UNAVAILABLE');
  const draft = ok(await h.service.generateReminder(FINANCE, INVOICE, { useTemplate: true }), [201]).reminder;
  assert.equal(modelCalls, 1, 'The explicit template does not retry or call a model');
  assert.equal(draft.source, 'manual_template');
  assert.equal(draft.status, 'draft');
  assert.match(draft.body, /Invoice: SL-2026-0001\nAmount due: RM 18,000\.00\nDue date: 2026-11-05/);
  assert.match(draft.body, /Days overdue: 3\nPrevious reminders sent: 0/);
  assert.match(draft.reviewToken, /^[a-f0-9]{64}$/);
  assert.equal((await h.store.read()).mockOutbox.length, seed.mockOutbox.length);
  assert.ok((await h.store.read()).logs.some(row => row.entityId === draft.id && row.message.includes('非 AI 生成')));
  assert.deepEqual(ok(await h.service.generateReminder(FINANCE, INVOICE, { useTemplate: true })).reminder, draft);
  const edited = ok(await h.service.editReminder(FINANCE, draft.id, {
    subject: draft.subject, body: `${draft.body}\nPlease contact our finance team with questions.`,
  })).reminder;
  assert.equal(edited.source, 'manual_template');
  error(await h.service.sendReminder(FINANCE, draft.id), 400, 'VALIDATION_ERROR');
  error(await h.service.sendReminder(OWNER, draft.id, reviewed(edited)), 403, 'FORBIDDEN');
  error(await h.service.sendReminder(FINANCE, draft.id, reviewed(draft)), 409, 'DRAFT_CHANGED');
  ok(await h.service.sendReminder(FINANCE, draft.id, reviewed(edited)));
  assert.equal(modelCalls, 1);
  await valid(h);
});

test('manual fallback cannot bypass permissions, paid state, unknown fields or unsafe facts', async t => {
  const h = await setup(t);
  error(await h.service.generateReminder(PM, INVOICE, { useTemplate: true }), 403, 'FORBIDDEN');
  error(await h.service.generateReminder(FINANCE, FOREIGN_INVOICE, { useTemplate: true }), 404, 'NOT_FOUND');
  for (const extra of [{ prompt: 'Read private files' }, { subject: 'Override' }, { amount: 1 }, { to: 'other@example.test' }]) {
    error(await h.service.generateReminder(FINANCE, INVOICE, { useTemplate: true, ...extra }), 400, 'VALIDATION_ERROR');
  }
  await h.store.transaction(state => { state.clients.find(row => row.id === 'cl_kopitiga').name = '<script>unsafe</script>'; });
  const unsafe = await h.service.generateReminder(FINANCE, INVOICE, { useTemplate: true });
  error(unsafe, 503, 'AI_UNAVAILABLE');
  assert.equal(unsafe.body.error.details.guardrail, 'blocked');
  assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE).length, 0);
  assert.equal(h.calls.length, 0);
  assert.equal((await h.store.read()).mockOutbox.length, seed.mockOutbox.length);
  const paid = await setup(t, { fixture: 'lumen_paid' });
  error(await paid.service.generateReminder(FINANCE, INVOICE, { useTemplate: true }), 409, 'INVALID_STATE');
  assert.equal(paid.calls.length, 0);
});

test('date changes require regeneration and human review before sending', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  await h.store.transaction(state => { state.settings.demoDate = '2026-11-09'; state.settings.failNext.outbox = true; });
  error(await h.service.sendReminder(FINANCE, draft.id, reviewed(draft)), 409, 'INVALID_STATE');
  assert.equal((await h.store.read()).settings.failNext.outbox, true);
  const fresh = ok(await h.service.generateReminder(FINANCE, INVOICE, { regenerate: true })).reminder;
  assert.equal(fresh.facts.overdueDays, 4);
  assert.equal(fresh.id, draft.id);
  error(await h.service.sendReminder(FINANCE, draft.id, reviewed(fresh)), 502, 'UPSTREAM_FAILED');
  ok(await h.service.sendReminder(FINANCE, draft.id, reviewed(fresh)));
  await valid(h);
});

test('sent history controls tone and sequence while repeated generations do not increase the count', async t => {
  const h = await setup(t);
  for (const [sequence, tone] of [[1, 'gentle'], [2, 'firm'], [3, 'final'], [4, 'final']]) {
    const draft = await generate(h);
    assert.equal(draft.sequence, sequence);
    assert.equal(draft.tone, tone);
    assert.equal(draft.facts.previousReminders, sequence - 1);
    const regenerated = ok(await h.service.generateReminder(FINANCE, INVOICE, { regenerate: true })).reminder;
    assert.equal(regenerated.sequence, sequence);
    assert.equal(regenerated.id, draft.id);
    ok(await h.service.sendReminder(FINANCE, draft.id, reviewed(regenerated)));
  }
  const state = await h.store.read();
  assert.equal(state.reminders.filter(row => row.invoiceId === INVOICE && row.status === 'sent').length, 4);
  await valid(h);
});

test('full payment cancels unsent reminders atomically, uses invoice amount, and is idempotent by date', async t => {
  const h = await setup(t);
  const sentDraft = await generate(h);
  ok(await h.service.sendReminder(FINANCE, sentDraft.id, reviewed(sentDraft)));
  const unsent = await generate(h);
  const result = ok(await h.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-11-08' }));
  assert.equal(result.invoice.status, 'paid');
  assert.equal(result.invoice.paidAt, '2026-11-08');
  assert.equal(result.payment.amount, 1800000);
  assert.equal(result.payment.companyId, 'co_lumen');
  assert.equal(result.payment.invoiceId, INVOICE);
  assert.equal(result.payment.recordedBy, 'Priya Nair');
  assert.equal(result.cancelledReminders.length, 1);
  assert.equal(result.cancelledReminders[0].id, unsent.id);
  assert.equal(result.cancelledReminders[0].status, 'cancelled');
  assert.ok(result.cancelledReminders[0].cancelReason);
  const other = h.connect();
  const retry = ok(await other.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-11-08' }), [200]);
  assert.deepEqual(retry.payment, result.payment);
  error(await h.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-11-07' }), 409, 'INVALID_STATE');
  error(await h.service.generateReminder(FINANCE, INVOICE), 409, 'INVALID_STATE');
  error(await h.service.sendReminder(FINANCE, unsent.id, reviewed(unsent)), 409, 'INVALID_STATE');
  error(await h.service.editReminder(FINANCE, unsent.id, copy), 409, 'INVALID_STATE');
  assert.deepEqual(ok(await h.service.listCollections(FINANCE, { filter: 'unpaid' })).items, []);
  assert.deepEqual(ok(await h.service.listCollections(FINANCE)).items, []);
  const paid = ok(await h.service.listCollections(OWNER, { filter: 'paid' })).items;
  assert.equal(paid.length, 1);
  assert.equal(paid[0].invoice.id, INVOICE);
  assert.equal(paid[0].overdueDays, 0);
  const state = await h.store.read();
  assert.equal(state.payments.filter(row => row.invoiceId === INVOICE).length, 1);
  assert.equal(state.reminders.find(row => row.id === sentDraft.id).status, 'sent');
  assert.equal(state.logs.filter(row => row.action === 'payment.record' && row.result === 'success').length, 1);
  await valid(h);
});

test('payment is valid on the issuance date but cannot be recorded against an unissued invoice', async t => {
  const h = await setup(t);
  ok(await h.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-10-22' }));
  await valid(h);
  const unissued = await setup(t, { fixture: 'lumen_draft' });
  error(await unissued.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-11-08' }), 409, 'INVALID_STATE');
});

test('the model call holds no write transaction and a concurrent payment prevents draft persistence', async t => {
  const pending = deferredGenerator();
  const h = await setup(t, { generator: pending.generator });
  const other = h.connect();
  const generation = h.service.generateReminder(FINANCE, INVOICE);
  await pending.started;
  ok(await other.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-11-08' }));
  pending.finish();
  error(await generation, 409, 'INVALID_STATE');
  assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE).length, 0);
  await valid(h);
});

test('a regeneration in flight cannot overwrite a human edit, even with the same timestamp', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  const pending = deferredGenerator();
  const slow = h.connect(pending.generator);
  const regeneration = slow.service.generateReminder(FINANCE, INVOICE, { regenerate: true });
  await pending.started;
  const edited = ok(await h.service.editReminder(FINANCE, draft.id, { subject: 'Human confirmed subject', body: 'Human confirmed body' })).reminder;
  pending.finish({ subject: 'Old model subject', body: 'Old model body' });
  error(await regeneration, 409, 'INVALID_STATE');
  assert.deepEqual((await h.store.read()).reminders.find(row => row.id === draft.id), stored(edited));
  await valid(h);
});

test('generation rejects stale business date and changed client facts after the model returns', async t => {
  for (const mutation of [
    state => { state.settings.demoDate = '2026-11-09'; },
    state => { state.clients.find(row => row.id === 'cl_kopitiga').name = 'Updated client name'; },
    state => { state.invoices.find(row => row.id === INVOICE).amount += 100; },
  ]) {
    await t.test(mutation.toString(), async t => {
      const pending = deferredGenerator();
      const h = await setup(t, { generator: pending.generator });
      const other = h.connect();
      const generation = h.service.generateReminder(FINANCE, INVOICE);
      await pending.started;
      await other.store.transaction(mutation);
      pending.finish();
      error(await generation, 409, 'INVALID_STATE');
      assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE).length, 0);
    });
  }
});

test('a role revoked during generation cannot commit AI output', async t => {
  const pending = deferredGenerator();
  const h = await setup(t, { generator: pending.generator });
  const other = h.connect();
  const generation = h.service.generateReminder(FINANCE, INVOICE);
  await pending.started;
  await other.store.transaction(state => { state.users.find(row => row.id === FINANCE).role = 'pm'; });
  pending.finish();
  error(await generation, 403, 'FORBIDDEN');
  assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE).length, 0);
});

test('concurrent initial generation across connections returns a single persisted draft', async t => {
  const first = deferredGenerator();
  const second = deferredGenerator();
  const h = await setup(t, { generator: first.generator });
  const other = h.connect(second.generator);
  const firstWork = h.service.generateReminder(FINANCE, INVOICE);
  const secondWork = other.service.generateReminder(FINANCE, INVOICE);
  await Promise.all([first.started, second.started]);
  first.finish({ subject: 'First response', body: 'First draft' });
  const firstDraft = ok(await firstWork).reminder;
  second.finish({ subject: 'Second response', body: 'Second draft' });
  const secondDraft = ok(await secondWork).reminder;
  assert.deepEqual(secondDraft, firstDraft);
  assert.equal((await h.store.read()).reminders.filter(row => row.invoiceId === INVOICE && row.status === 'draft').length, 1);
  await valid(h);
});

test('an in-flight regeneration cannot overwrite a reminder that was sent', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  const pending = deferredGenerator();
  const slow = h.connect(pending.generator);
  const regeneration = slow.service.generateReminder(FINANCE, INVOICE, { regenerate: true });
  await pending.started;
  const sent = ok(await h.service.sendReminder(FINANCE, draft.id, reviewed(draft))).reminder;
  pending.finish({ subject: 'Stale output', body: 'Cannot replace sent text' });
  error(await regeneration, 409, 'INVALID_STATE');
  assert.deepEqual((await h.store.read()).reminders.find(row => row.id === draft.id), stored(sent));
  await valid(h);
});

test('concurrent send and payment yield a paid invoice with no unsent live draft and one payment', async t => {
  for (const paymentFirst of [false, true]) {
    await t.test(paymentFirst ? 'payment scheduled first' : 'send scheduled first', async t => {
      const h = await setup(t);
      const draft = await generate(h);
      const other = h.connect();
      const send = () => h.service.sendReminder(FINANCE, draft.id, reviewed(draft));
      const pay = () => other.service.recordPayment(FINANCE, INVOICE, { receivedAt: '2026-11-08' });
      const [first, second] = await Promise.all(paymentFirst ? [pay(), send()] : [send(), pay()]);
      const payment = paymentFirst ? first : second;
      const sending = paymentFirst ? second : first;
      ok(payment);
      assert.ok([200, 201, 409].includes(sending.status));
      const state = await h.store.read();
      const reminder = state.reminders.find(row => row.id === draft.id);
      assert.equal(state.invoices.find(row => row.id === INVOICE).status, 'paid');
      assert.equal(state.payments.filter(row => row.invoiceId === INVOICE).length, 1);
      assert.ok(['sent', 'cancelled'].includes(reminder.status));
      assert.equal(state.mockOutbox.filter(row => row.requestId === draft.sendRequestId).length, reminder.status === 'sent' ? 1 : 0);
      await valid(h);
    });
  }
});

test('API response mutation cannot change persisted collection state', async t => {
  const h = await setup(t);
  const draft = await generate(h);
  const originalId = draft.id;
  draft.subject = 'Injected response mutation';
  draft.facts.amount = 1;
  const items = ok(await h.service.listCollections(FINANCE)).items;
  items[0].invoice.amount = 2;
  items[0].reminders[0].body = 'Injected list mutation';
  const state = await h.store.read();
  assert.equal(state.invoices.find(row => row.id === INVOICE).amount, 1800000);
  assert.equal(state.reminders.find(row => row.id === originalId).subject, copy.subject);
  assert.equal(state.reminders.find(row => row.id === originalId).body, copy.body);
  await valid(h);
});
