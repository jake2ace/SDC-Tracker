import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInvoicingService } from '../src/invoicing/service.mjs';
import { validateState } from '../contracts/validate.mjs';
import { createSqliteTestStore } from './support/invoicing-store.mjs';

const seed = JSON.parse(await readFile(new URL('../data/demo.json', import.meta.url), 'utf8'));
const PM = 'u_lumen_pm';
const OWNER = 'u_lumen_owner';
const FINANCE = 'u_lumen_fin';
const MILESTONE = 'ms_kt_2';
const now = () => new Date('2026-10-22T04:00:00.000Z');

async function setup(t, { date = '2026-10-22' } = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'sdc-invoicing-'));
  const filename = join(directory, 'state.sqlite');
  const initial = structuredClone(seed);
  initial.settings.demoDate = date;
  const connections = [];
  const connect = () => {
    const store = createSqliteTestStore(filename, initial);
    connections.push(store);
    return { store, service: createInvoicingService({ store, now }) };
  };
  t.after(async () => {
    for (const store of connections) store.close();
    await rm(directory, { recursive: true, force: true });
  });
  return { ...connect(), connect };
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

async function draft(h, milestoneId = MILESTONE, userId = PM) {
  return ok(await h.service.completeMilestone(userId, milestoneId));
}

/** Model the approved record handed over by Issue #2, without implementing its API. */
async function approve(h, invoiceId, { reject = false } = {}) {
  return h.store.transaction(state => {
    const invoice = state.invoices.find(item => item.id === invoiceId);
    assert.equal(invoice.status, 'pending_approval');
    const owner = state.users.find(user => user.companyId === invoice.companyId && user.role === 'owner');
    const at = `${state.settings.demoDate}T11:00:00+08:00`;
    invoice.status = reject ? 'rejected' : 'approved';
    invoice.approval = { by: owner.name, role: 'owner', at, ...(reject ? { reason: 'Incorrect milestone evidence' } : {}) };
    state.logs.push({
      id: `test_approval_${++state.seq}`, companyId: invoice.companyId,
      at, demoDate: state.settings.demoDate, actor: owner.name, role: 'owner',
      action: reject ? 'invoice.reject' : 'invoice.approve', entityType: 'invoice',
      entityId: invoice.id, result: 'success', message: 'Issue #2 approval handoff fixture',
    });
    return invoice;
  });
}

async function ready(h) {
  const { invoice } = await draft(h);
  await approve(h, invoice.id);
  return invoice;
}

test('PM completion atomically creates the agreed draft and an attributable audit record', async t => {
  const h = await setup(t);
  const result = await draft(h);
  assert.equal(result.created, true);
  assert.equal(result.milestone.status, 'completed');
  assert.equal(result.milestone.completedAt, '2026-10-22');
  assert.equal(result.milestone.completedBy, 'Wei Ling');
  const invoice = result.invoice;
  assert.equal(invoice.companyId, 'co_lumen');
  assert.equal(invoice.projectId, 'pr_kopitiga_store');
  assert.equal(invoice.clientId, 'cl_kopitiga');
  assert.equal(invoice.milestoneId, MILESTONE);
  assert.equal(invoice.status, 'pending_approval');
  assert.equal(invoice.amount, 1800000);
  assert.equal(invoice.netDays, 14);
  assert.equal(invoice.currency, 'MYR');
  assert.equal(invoice.draftedAt, '2026-10-22');
  assert.equal(invoice.expectedDueDate, '2026-11-05');
  assert.equal(invoice.approval, null);
  assert.equal(invoice.issueAttempts, 0);
  for (const key of ['invoiceNo', 'issuedAt', 'dueDate', 'paidAt', 'lastIssueError']) assert.equal(invoice[key], null);
  assert.ok(invoice.issueRequestId);
  assert.deepEqual(invoice.basis, {
    projectName: 'Kopi Tiga store design', milestoneName: 'Design sign-off',
    termNote: '30% on design sign-off, due 14 days after invoice date', contractTotal: 6000000,
  });
  const state = await h.store.read();
  assert.deepEqual(state.invoices.find(item => item.id === invoice.id), invoice);
  assert.deepEqual(validateState(state), []);
  const log = state.logs.find(item => item.action === 'milestone.complete' && item.result === 'success');
  assert.ok(log);
  assert.equal(log.actor, 'Wei Ling');
  assert.equal(log.companyId, 'co_lumen');
  assert.equal(log.role, 'pm');
  assert.equal(log.demoDate, '2026-10-22');
  assert.equal(Date.parse(log.at), now().getTime());
});

test('completion retries across two connections create one draft and preserve rejected records', async t => {
  const h = await setup(t);
  const other = h.connect();
  const results = await Promise.all(Array.from({ length: 12 }, (_, i) =>
    (i % 2 ? h : other).service.completeMilestone(PM, MILESTONE)));
  const bodies = results.map(result => ok(result));
  assert.equal(bodies.filter(body => body.created).length, 1);
  assert.equal(new Set(bodies.map(body => body.invoice.id)).size, 1);
  for (const result of results.filter(result => !result.body.created)) assert.equal(result.status, 200);
  const invoiceId = bodies[0].invoice.id;
  await approve(h, invoiceId, { reject: true });
  const retry = ok(await other.service.completeMilestone(PM, MILESTONE), [200]);
  assert.equal(retry.created, false);
  assert.equal(retry.invoice.id, invoiceId);
  assert.equal(retry.invoice.status, 'rejected');
  const state = await other.store.read();
  assert.equal(state.invoices.filter(invoice => invoice.milestoneId === MILESTONE).length, 1);
  assert.deepEqual(validateState(state), []);
});

test('historical settlement and unapproved or rejected invoices cannot be issued', async t => {
  const h = await setup(t);
  error(await h.service.completeMilestone(PM, 'ms_kt_1'), 409, 'INVALID_STATE');
  const { invoice } = await draft(h);
  error(await h.service.issueInvoice(FINANCE, invoice.id), 409, 'INVALID_STATE');
  await approve(h, invoice.id, { reject: true });
  error(await h.service.issueInvoice(FINANCE, invoice.id), 409, 'INVALID_STATE');
  const state = await h.store.read();
  assert.equal(state.mockAccounting.length, seed.mockAccounting.length);
  assert.equal(state.invoices.find(item => item.id === invoice.id).issueAttempts, 0);
  assert.deepEqual(validateState(state), []);
});

test('two invoice records for one milestone cannot bypass the one-invoice rule with different request IDs', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  const duplicateId = 'test_duplicate_invoice';
  await h.store.transaction(state => {
    const original = state.invoices.find(i => i.id === invoice.id);
    state.invoices.push({ ...structuredClone(original), id: duplicateId, issueRequestId: 'test_duplicate_request' });
    state.settings.failNext.accounting = true;
  });
  for (const id of [invoice.id, duplicateId]) error(await h.service.issueInvoice(FINANCE, id), 409, 'INVALID_STATE');
  const state = await h.store.read();
  assert.equal(state.mockAccounting.length, seed.mockAccounting.length);
  assert.ok(state.invoices.filter(i => i.milestoneId === MILESTONE).every(i => i.issueAttempts === 0 && i.status === 'approved'));
  assert.equal(state.settings.failNext.accounting, true);
});

test('an approved invoice cannot issue after its milestone becomes pending or historically settled', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  for (const change of [{ status: 'pending', settledBeforeDemo: false }, { status: 'completed', settledBeforeDemo: true }]) {
    await h.store.transaction(state => { Object.assign(state.milestones.find(m => m.id === MILESTONE), change); });
    error(await h.service.issueInvoice(FINANCE, invoice.id), 409, 'INVALID_STATE');
    const state = await h.store.read();
    assert.equal(state.mockAccounting.length, seed.mockAccounting.length);
    assert.equal(state.invoices.find(i => i.id === invoice.id).issueAttempts, 0);
  }
});

test('draft ID allocation skips an accounting request ID already owned by another invoice', async t => {
  const h = await setup(t);
  const collision = 'issue_inv_101';
  await h.store.transaction(state => {
    state.seq = 100;
    const oldInvoice = state.invoices.find(i => i.id === 'inv_bd_1');
    const oldReceipt = state.mockAccounting.find(r => r.requestId === oldInvoice.issueRequestId);
    oldInvoice.issueRequestId = collision;
    oldReceipt.requestId = collision;
  });
  const before = await h.store.read();
  const { invoice } = await draft(h);
  assert.notEqual(invoice.issueRequestId, collision);
  const state = await h.store.read();
  assert.equal(new Set(state.invoices.map(i => i.issueRequestId)).size, state.invoices.length);
  assert.deepEqual(state.invoices.find(i => i.id === 'inv_bd_1'), before.invoices.find(i => i.id === 'inv_bd_1'));
  assert.deepEqual(state.mockAccounting, before.mockAccounting);
  assert.deepEqual(validateState(state), []);
});

test('an approved label without a valid same-company owner approval cannot authorize issuance', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  const original = (await h.store.read()).invoices.find(i => i.id === invoice.id).approval;
  for (const approval of [null, { ...original, role: 'finance', by: 'Priya Nair' }, { ...original, by: 'Mei Chen' }, { ...original, at: '2026-02-30T12:00:00+08:00' }]) {
    await h.store.transaction(state => { state.invoices.find(i => i.id === invoice.id).approval = approval; });
    error(await h.service.issueInvoice(FINANCE, invoice.id), 409, 'INVALID_STATE');
    const state = await h.store.read();
    assert.equal(state.invoices.find(i => i.id === invoice.id).issueAttempts, 0);
    assert.ok(!state.mockAccounting.some(receipt => receipt.requestId === invoice.issueRequestId));
  }
});

test('all reads are company scoped and invoice detail contains only its own audit history', async t => {
  const h = await setup(t);
  const { invoice } = await draft(h);
  for (const user of [PM, OWNER, FINANCE]) {
    const projects = ok(await h.service.listProjects(user)).projects;
    assert.equal(projects.length, 1);
    assert.equal(projects[0].companyId, 'co_lumen');
    assert.equal(projects[0].client.id, 'cl_kopitiga');
    assert.ok(projects[0].milestones.every(m => m.projectId === projects[0].id));
    assert.ok(projects[0].invoices.every(i => i.companyId === 'co_lumen'));
    const invoices = ok(await h.service.listInvoices(user)).invoices;
    assert.deepEqual(invoices.map(i => i.id), [invoice.id]);
    assert.deepEqual(ok(await h.service.listInvoices(user, { status: 'issued' })).invoices, []);
    assert.equal(ok(await h.service.listInvoices(user, { status: 'pending_approval' })).invoices.length, 1);
    const detail = ok(await h.service.getInvoice(user, invoice.id));
    assert.equal(detail.invoice.id, invoice.id);
    assert.ok(detail.logs.every(log => log.companyId === 'co_lumen'));
    assert.ok(detail.logs.every(log => log.entityId === invoice.id || log.entityId === MILESTONE));
  }
  assert.deepEqual(ok(await h.service.listInvoices('u_rantau_pm')).invoices.map(i => i.id), ['inv_bd_1']);
});

test('identity and company boundaries are enforced before idempotent results', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  ok(await h.service.issueInvoice(FINANCE, invoice.id));
  for (const user of [undefined, '', 'unknown_user']) {
    error(await h.service.listProjects(user), 401, 'UNAUTHENTICATED');
    error(await h.service.listInvoices(user), 401, 'UNAUTHENTICATED');
    error(await h.service.getInvoice(user, invoice.id), 401, 'UNAUTHENTICATED');
    error(await h.service.completeMilestone(user, MILESTONE), 401, 'UNAUTHENTICATED');
    error(await h.service.issueInvoice(user, invoice.id), 401, 'UNAUTHENTICATED');
  }
  for (const user of [OWNER, FINANCE]) error(await h.service.completeMilestone(user, MILESTONE), 403, 'FORBIDDEN');
  for (const user of [PM, OWNER]) error(await h.service.issueInvoice(user, invoice.id), 403, 'FORBIDDEN');
  const otherInvoice = await h.service.getInvoice(PM, 'inv_bd_1');
  const absentInvoice = await h.service.getInvoice(PM, 'missing_invoice');
  error(otherInvoice, 404, 'NOT_FOUND');
  error(absentInvoice, 404, 'NOT_FOUND');
  assert.deepEqual(otherInvoice.body, absentInvoice.body, '404 must not reveal cross-company existence');
  error(await h.service.issueInvoice(FINANCE, 'inv_bd_1'), 404, 'NOT_FOUND');
  error(await h.service.completeMilestone(PM, 'ms_bd_2'), 404, 'NOT_FOUND');
  const state = await h.store.read();
  assert.equal(state.invoices.filter(i => i.milestoneId === MILESTONE).length, 1);
  assert.equal(state.mockAccounting.filter(r => r.requestId === invoice.issueRequestId).length, 1);
  assert.ok(state.logs.filter(log => log.companyId === 'co_lumen' && log.result === 'denied').length >= 4);
  assert.deepEqual(validateState(state), []);
});

test('unknown body and query fields cannot override amounts, ownership or status', async t => {
  const h = await setup(t);
  for (const body of [{ companyId: 'co_rantau' }, { amount: 1 }, { status: 'approved' }, null, []]) {
    error(await h.service.completeMilestone(PM, MILESTONE, body), 400, 'VALIDATION_ERROR');
  }
  assert.deepEqual(await h.store.read(), seed);
  const invoice = await ready(h);
  const before = await h.store.read();
  for (const body of [{ amount: 1 }, { issuedAt: '2026-02-30' }, { companyId: 'co_rantau' }, null, []]) {
    error(await h.service.issueInvoice(FINANCE, invoice.id, body), 400, 'VALIDATION_ERROR');
  }
  for (const query of [{ status: 'draft' }, { status: ['issued'] }, { companyId: 'co_rantau' }, null, []]) {
    error(await h.service.listInvoices(FINANCE, query), 400, 'VALIDATION_ERROR');
  }
  assert.deepEqual(await h.store.read(), before);
});

test('finance issuance uses its actual business date and the approved payment snapshot', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  await h.store.transaction(state => { state.settings.demoDate = '2026-10-24'; });
  const result = ok(await h.service.issueInvoice(FINANCE, invoice.id), [200]);
  assert.equal(result.invoice.status, 'issued');
  assert.equal(result.invoice.issuedAt, '2026-10-24');
  assert.equal(result.invoice.dueDate, '2026-11-07');
  assert.equal(result.invoice.expectedDueDate, '2026-11-05');
  assert.equal(result.invoice.issueAttempts, 1);
  assert.equal(result.receipt.simulation, true);
  assert.equal(result.receipt.requestId, invoice.issueRequestId);
  assert.equal(result.receipt.invoiceNo, result.invoice.invoiceNo);
  assert.equal(result.receipt.issuedAt, result.invoice.issuedAt);
  assert.equal(result.receipt.dueDate, result.invoice.dueDate);
  const state = await h.store.read();
  assert.deepEqual(validateState(state), []);
  assert.ok(state.logs.some(log => log.entityId === invoice.id && log.action === 'invoice.issue' && log.result === 'success' && log.actor === 'Priya Nair'));
});

test('issuing never replaces the approved snapshot with subsequently changed source terms', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  await h.store.transaction(state => {
    const milestone = state.milestones.find(m => m.id === MILESTONE);
    milestone.paymentTerm.amount = 900000;
    milestone.paymentTerm.netDays = 30;
    milestone.paymentTerm.note = 'Changed after approval';
    state.projects.find(p => p.id === invoice.projectId).name = 'Renamed project';
  });
  const issued = ok(await h.service.issueInvoice(FINANCE, invoice.id)).invoice;
  assert.equal(issued.amount, invoice.amount);
  assert.equal(issued.netDays, invoice.netDays);
  assert.equal(issued.clientId, invoice.clientId);
  assert.deepEqual(issued.basis, invoice.basis);
  assert.equal(issued.dueDate, '2026-11-05');
});

test('accounting failure and recovery are durable, atomic and use the same request ID', async t => {
  let h = await setup(t);
  const invoice = await ready(h);
  await h.store.transaction(state => { state.settings.failNext.accounting = true; });
  const failed = await h.service.issueInvoice(FINANCE, invoice.id);
  error(failed, 502, 'UPSTREAM_FAILED');
  let state = await h.store.read();
  let stored = state.invoices.find(i => i.id === invoice.id);
  assert.equal(stored.status, 'approved');
  assert.equal(stored.issueAttempts, 1);
  assert.ok(stored.lastIssueError);
  assert.equal(stored.invoiceNo, null);
  assert.equal(stored.issuedAt, null);
  assert.equal(stored.dueDate, null);
  assert.equal(state.settings.failNext.accounting, false);
  assert.ok(!state.mockAccounting.some(receipt => receipt.requestId === invoice.issueRequestId));
  assert.ok(state.logs.some(log => log.entityId === invoice.id && log.result === 'failure'));
  assert.deepEqual(validateState(state), []);
  h.store.close();
  h = { ...h, ...h.connect() };
  const recovered = ok(await h.service.issueInvoice(FINANCE, invoice.id), [200]);
  assert.equal(recovered.invoice.issueAttempts, 2);
  assert.equal(recovered.invoice.lastIssueError, null);
  assert.equal(recovered.receipt.requestId, invoice.issueRequestId);
  state = await h.store.read();
  h.store.close();
  h = { ...h, ...h.connect() };
  assert.deepEqual(await h.store.read(), state);
  const repeated = ok(await h.service.issueInvoice(FINANCE, invoice.id), [200]);
  assert.deepEqual(repeated, recovered);
  stored = (await h.store.read()).invoices.find(i => i.id === invoice.id);
  assert.equal(stored.issueAttempts, 2);
  assert.deepEqual(validateState(await h.store.read()), []);
});

test('an existing accounting receipt repairs an interrupted approved record without issuing again', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  const receipt = { requestId: invoice.issueRequestId, invoiceNo: 'SL-2026-0900',
    issuedAt: '2026-10-22', dueDate: '2026-11-05', simulation: true };
  // Defensive recovery for an imported/interrupted adapter state: receipt exists,
  // but the local invoice has not yet been marked issued.
  await h.store.transaction(state => {
    state.invoices.find(i => i.id === invoice.id).issueAttempts = 1;
    state.mockAccounting.push(receipt);
    state.settings.failNext.accounting = true;
    state.settings.demoDate = '2026-10-24';
  });
  const recovered = ok(await h.service.issueInvoice(FINANCE, invoice.id), [200]);
  assert.deepEqual(recovered.receipt, receipt);
  assert.equal(recovered.invoice.issuedAt, '2026-10-22');
  assert.equal(recovered.invoice.dueDate, '2026-11-05');
  assert.equal(recovered.invoice.issueAttempts, 1);
  const state = await h.store.read();
  assert.equal(state.settings.failNext.accounting, true);
  assert.equal(state.mockAccounting.filter(r => r.requestId === receipt.requestId).length, 1);
  assert.deepEqual(validateState(state), []);
});

test('concurrent issue retries across connections return one persisted receipt, including after payment', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  const other = h.connect();
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) =>
    (i % 2 ? h : other).service.issueInvoice(FINANCE, invoice.id)));
  const bodies = results.map(result => ok(result, [200]));
  for (const body of bodies) assert.deepEqual(body, bodies[0]);
  let state = await h.store.read();
  assert.equal(state.mockAccounting.filter(r => r.requestId === invoice.issueRequestId).length, 1);
  assert.equal(state.invoices.find(i => i.id === invoice.id).issueAttempts, 1);
  assert.equal(new Set(state.invoices.filter(i => i.invoiceNo).map(i => i.invoiceNo)).size, state.invoices.filter(i => i.invoiceNo).length);
  await h.store.transaction(state => {
    const paid = state.invoices.find(i => i.id === invoice.id);
    paid.status = 'paid';
    paid.paidAt = state.settings.demoDate;
    state.payments.push({ id: `test_payment_${++state.seq}`, companyId: paid.companyId, invoiceId: paid.id,
      amount: paid.amount, receivedAt: paid.paidAt, recordedBy: 'Priya Nair' });
    state.settings.failNext.accounting = true;
  });
  const paidRetry = ok(await other.service.issueInvoice(FINANCE, invoice.id), [200]);
  assert.equal(paidRetry.invoice.status, 'paid');
  assert.deepEqual(paidRetry.receipt, bodies[0].receipt);
  state = await other.store.read();
  assert.equal(state.settings.failNext.accounting, true, 'idempotent return must not call accounting again');
  assert.equal(state.invoices.find(i => i.id === invoice.id).issueAttempts, 1);
  assert.deepEqual(validateState(state), []);
});

test('calendar addition covers leap day and year rollover using the injected business date', async t => {
  for (const [date, due] of [['2028-02-20', '2028-03-05'], ['2027-02-20', '2027-03-06'], ['2026-12-25', '2027-01-08']]) {
    await t.test(date, async t => {
      const h = await setup(t, { date });
      const invoice = await ready(h);
      assert.equal(invoice.expectedDueDate, due);
      const issued = ok(await h.service.issueInvoice(FINANCE, invoice.id)).invoice;
      assert.equal(issued.issuedAt, date);
      assert.equal(issued.dueDate, due);
      assert.deepEqual(validateState(await h.store.read()), []);
    });
  }
});

test('invalid or backward business dates cannot be silently normalized into an issued invoice', async t => {
  const h = await setup(t);
  const invoice = await ready(h);
  for (const date of ['2026-02-30', '2026-10-21']) {
    await h.store.transaction(state => { state.settings.demoDate = date; });
    error(await h.service.issueInvoice(FINANCE, invoice.id), 409, 'INVALID_STATE');
    const state = await h.store.read();
    assert.equal(state.invoices.find(i => i.id === invoice.id).status, 'approved');
    assert.equal(state.invoices.find(i => i.id === invoice.id).issueAttempts, 0);
    assert.ok(!state.mockAccounting.some(receipt => receipt.requestId === invoice.issueRequestId));
  }
});

test('transaction rollback leaves no partial stage, invoice, receipt, log or consumed failure flag', async t => {
  const h = await setup(t);
  const before = await h.store.read();
  const rollbackStore = {
    read: () => h.store.read(),
    transaction: fn => h.store.transaction(state => {
      fn(state);
      throw new Error('Injected persistence failure');
    }),
  };
  const service = createInvoicingService({ store: rollbackStore, now });
  await assert.rejects(service.completeMilestone(PM, MILESTONE), /Injected persistence failure/);
  assert.deepEqual(await h.store.read(), before);
  const invoice = await ready(h);
  const beforeIssue = await h.store.read();
  await assert.rejects(service.issueInvoice(FINANCE, invoice.id), /Injected persistence failure/);
  assert.deepEqual(await h.store.read(), beforeIssue, 'a failed commit cannot leave a receipt or issued state');
  await h.store.transaction(state => { state.settings.failNext.accounting = true; });
  const approvedState = await h.store.read();
  await assert.rejects(service.issueInvoice(FINANCE, invoice.id), /Injected persistence failure/);
  assert.deepEqual(await h.store.read(), approvedState);
  error(await h.service.issueInvoice(FINANCE, invoice.id), 502, 'UPSTREAM_FAILED');
});

test('store reads and service results cannot mutate persisted data without a transaction', async t => {
  const h = await setup(t);
  const snapshot = await h.store.read();
  snapshot.settings.demoDate = '1900-01-01';
  assert.equal((await h.store.read()).settings.demoDate, '2026-10-22');
  const { invoice } = await draft(h);
  invoice.amount = 1;
  invoice.basis.projectName = 'Mutated by client';
  const detail = ok(await h.service.getInvoice(PM, invoice.id));
  assert.equal(detail.invoice.amount, 1800000);
  assert.equal(detail.invoice.basis.projectName, 'Kopi Tiga store design');
  detail.invoice.amount = 2;
  assert.equal((await h.store.read()).invoices.find(i => i.id === invoice.id).amount, 1800000);
});
