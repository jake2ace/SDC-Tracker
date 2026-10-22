import test from 'node:test';
import assert from 'node:assert/strict';
import { addDays, isDate, validateState } from '../contracts/validate.mjs';
import { readJson, materializeFixture, ledgerFor } from './helpers.mjs';

const [seed, golden] = await Promise.all([
  readJson('../data/demo.json'), readJson('../data/expected-results.json'),
]);
const fixture = name => materializeFixture(seed, golden.stateFixtures, name);
const sum = rows => rows.reduce((total, row) => total + row.amount, 0);

test('seed and every named fixture satisfy ownership, state and accounting invariants', async t => {
  assert.equal(golden.moneyUnit, 'sen');
  assert.equal(golden.currency, 'MYR');
  assert.deepEqual(validateState(seed), []);
  for (const name of Object.keys(golden.stateFixtures)) {
    await t.test(name, () => assert.deepEqual(validateState(fixture(name)), []));
  }
});

test('preflight detects meaningful invalid mutations', async t => {
  const mutations = [
    ['unsupported schema version', 'seed', s => { s.schemaVersion = 2; }, /supported version is 1/],
    ['cross-company client', 'lumen_issued', s => { s.invoices.find(i => i.id === 'inv_kt_2').clientId = 'cl_bayu'; }, /company mismatch/],
    ['unapproved issued invoice', 'lumen_issued', s => { s.invoices.find(i => i.id === 'inv_kt_2').approval = null; }, /owner approval/],
    ['second invoice for one stage', 'lumen_issued', s => { s.invoices.push({ ...s.invoices.at(-1), id: 'duplicate_invoice' }); }, /duplicate milestoneId/],
    ['fractional currency amount', 'seed', s => { s.expenses[0].amount += 0.5; }, /integer sen/],
    ['impossible calendar date', 'seed', s => { s.expenses[0].date = '2026-02-30'; }, /valid date/],
    ['wrong actual due date', 'lumen_issued', s => { s.invoices.find(i => i.id === 'inv_kt_2').dueDate = '2026-11-06'; }, /actual due date mismatch/],
    ['duplicate payment', 'lumen_paid', s => { s.payments.push({ ...s.payments[0], id: 'duplicate_payment' }); }, /duplicate invoiceId/],
    ['wrong payment amount', 'lumen_paid', s => { s.payments[0].amount -= 100; }, /full payment/],
    ['receipt not simulated', 'seed', s => { s.mockAccounting[0].simulation = false; }, /non-simulated/],
    ['successful issue by owner', 'seed', s => { Object.assign(s.logs[0], { actor: 'Mei Chen', role: 'owner' }); }, /wrong role/],
    ['paid invoice still has reminder draft', 'rantau_paid', s => {
      const reminder = structuredClone(s.reminders[0]);
      Object.assign(reminder, { id: 'paid_draft', status: 'draft', sentAt: null, sentBy: null, sendRequestId: 'paid_draft_request', sequence: 2, tone: 'firm' });
      reminder.facts.previousReminders = 1;
      s.reminders.push(reminder);
    }, /unpaid overdue invoice/],
  ];
  for (const [name, stateName, mutate, message] of mutations) {
    await t.test(name, () => {
      const state = fixture(stateName);
      mutate(state);
      assert.match(validateState(state).join('\n'), message);
    });
  }
});

test('send chronology compares actual instants across timezone offsets', () => {
  const state = fixture('seed');
  // 02:12Z is 10:12 in Malaysia, after the 09:00 local creation time.
  state.reminders[0].sentAt = '2026-10-21T02:12:00Z';
  state.mockOutbox[0].sentAt = state.reminders[0].sentAt;
  assert.deepEqual(validateState(state), []);
  state.reminders[0].sentAt = '2026-10-21T00:59:00Z';
  state.mockOutbox[0].sentAt = state.reminders[0].sentAt;
  assert.match(validateState(state).join('\n'), /invalid send timestamp/);
});

test('golden date rules use actual issuance and stop overdue status after payment', () => {
  assert.equal(isDate('2026-02-29'), false);
  assert.equal(isDate('2028-02-29'), true);
  for (const { input, expected } of golden.dateRuleCases) {
    if (input.issuedAt) assert.equal(addDays(input.issuedAt, input.netDays), expected.dueDate);
    else {
      const invoice = fixture(input.state).invoices.find(i => i.id === input.invoiceId);
      assert.ok(invoice);
      const overdueDays = invoice.status === 'issued'
        ? Math.max(0, (Date.parse(input.demoDate) - Date.parse(invoice.dueDate)) / 86_400_000) : 0;
      assert.equal(overdueDays, expected.overdueDays);
    }
  }
});

test('golden overview values separate issued debt from unissued amounts', async t => {
  for (const scenarioCase of golden.overviewCases) {
    await t.test(scenarioCase.id, () => {
      const { input, expected, forecastReference } = scenarioCase;
      const invoices = fixture(input.state).invoices.filter(i => i.companyId === input.companyId);
      const issued = invoices.filter(i => i.status === 'issued');
      const overdue = issued.filter(i => i.dueDate < input.demoDate);
      assert.deepEqual({
        unpaidAmount: sum(issued), overdueAmount: sum(overdue), overdueCount: overdue.length,
        pendingApprovalCount: invoices.filter(i => i.status === 'pending_approval').length,
        pendingIssueAmount: sum(invoices.filter(i => ['pending_approval', 'approved'].includes(i.status))),
      }, expected);
      if (forecastReference) {
        const forecast = golden.forecastCases.find(c => c.id === forecastReference);
        assert.ok(forecast, 'Referenced forecast must exist');
        assert.equal(forecast.input.companyId, input.companyId);
        assert.equal(forecast.input.state, input.state);
        assert.equal(forecast.input.mode, 'fixed');
        assert.equal(forecast.input.scenario.kind, 'on_time');
      }
    });
  }
});

test('eight forecast goldens reconcile to independent daily cash ledgers', async t => {
  assert.equal(golden.forecastCases.length, 8);
  for (const scenarioCase of golden.forecastCases) {
    await t.test(scenarioCase.id, () => {
      const { input, expected } = scenarioCase;
      const state = fixture(input.state);
      const company = state.companies.find(c => c.id === input.companyId);
      assert.equal(input.days, 30);
      assert.equal(expected.dayCount, 30);
      assert.equal(expected.safetyLine, company.safetyLine);
      if (input.mode === 'fixed') assert.equal(input.baseDate, company.forecastBaseDate);
      const receiptKeys = new Set();
      for (const receipt of expected.includedReceipts) {
        assert.ok(isDate(receipt.date) && receipt.date >= input.baseDate && receipt.date <= expected.endDate);
        assert.ok(Number.isSafeInteger(receipt.amount) && receipt.amount > 0);
        const key = `${receipt.invoiceId}:${receipt.kind}:${receipt.date}`;
        assert.ok(!receiptKeys.has(key), 'Duplicate included receipt');
        receiptKeys.add(key);
        const invoice = state.invoices.find(i => i.id === receipt.invoiceId);
        if (receipt.kind === 'actual_receipt') {
          assert.ok(state.payments.some(p => p.companyId === company.id && p.invoiceId === receipt.invoiceId && p.amount === receipt.amount && p.receivedAt === receipt.date));
          assert.equal(invoice.status, 'paid');
        } else if (invoice) {
          assert.equal(invoice.companyId, company.id);
          assert.equal(invoice.status, 'issued');
          assert.equal(receipt.amount, invoice.amount);
          assert.equal(receipt.assumedToday, invoice.dueDate < input.baseDate);
          if (input.scenario.kind === 'on_time') assert.equal(receipt.date, invoice.dueDate < input.baseDate ? input.baseDate : invoice.dueDate);
        } else {
          // The Rantau rolling case includes its not-yet-invoiced next stage.
          const projects = new Set(state.projects.filter(p => p.companyId === company.id).map(p => p.id));
          assert.ok(state.milestones.some(m => projects.has(m.projectId) && !m.settledBeforeDemo
            && !state.invoices.some(i => i.milestoneId === m.id)
            && m.paymentTerm.amount === receipt.amount && addDays(m.plannedDate, m.paymentTerm.netDays) === receipt.date));
        }
      }
      // Actual receipts inside the window must all survive every scenario.
      for (const payment of state.payments.filter(p => p.companyId === company.id && p.receivedAt >= input.baseDate && p.receivedAt <= expected.endDate)) {
        assert.equal(expected.includedReceipts.filter(r => r.kind === 'actual_receipt' && r.invoiceId === payment.invoiceId).length, 1);
        assert.equal(expected.includedReceipts.filter(r => r.kind === 'expected_receipt' && r.invoiceId === payment.invoiceId).length, 0);
      }
      const ledger = ledgerFor(state, scenarioCase);
      assert.equal(ledger.openingBalance, expected.openingBalance);
      assert.equal(ledger.endDate, expected.endDate);
      assert.equal(ledger.includedExpenseCount, expected.includedExpenseCount);
      assert.deepEqual(ledger.summary, expected.summary);
      for (const checkpoint of expected.checkpoints) assert.equal(ledger.days.find(d => d.date === checkpoint.date)?.balance, checkpoint.balance);
    });
  }
});
