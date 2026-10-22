import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { addDays } from '../contracts/validate.mjs';

export async function readJson(relativePath) {
  return JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'));
}

export function materializeFixture(seed, definitions, name, seen = new Set()) {
  assert.ok(!seen.has(name), `Fixture cycle: ${name}`);
  const definition = definitions[name];
  assert.ok(definition, `Unknown fixture: ${name}`);
  const nextSeen = new Set([...seen, name]);
  const state = definition.extends
    ? materializeFixture(seed, definitions, definition.extends, nextSeen)
    : structuredClone(seed);
  Object.assign(state.settings, definition.settings ?? {});
  for (const change of definition.updates ?? []) {
    const entity = state[change.collection]?.find(row => row.id === change.id);
    assert.ok(entity, `Missing fixture target: ${change.collection}/${change.id}`);
    Object.assign(entity, structuredClone(change.set));
  }
  for (const addition of definition.appends ?? []) {
    assert.ok(Array.isArray(state[addition.collection]), `Unknown collection: ${addition.collection}`);
    state[addition.collection].push(structuredClone(addition.record));
  }
  return state;
}

// Independent accounting check: book the receipts explicitly listed by each
// golden case and the fixture's scheduled expenses. This does not implement
// the app's receivable selection, forecast adapter, or HTTP service.
export function ledgerFor(state, scenarioCase) {
  const { input, expected } = scenarioCase;
  const company = state.companies.find(c => c.id === input.companyId);
  assert.ok(company);
  const endDate = addDays(input.baseDate, input.days - 1);
  const expenses = state.expenses.filter(e => e.companyId === company.id);
  const payments = state.payments.filter(p => p.companyId === company.id);
  const beforeBase = date => date >= company.forecastBaseDate && date < input.baseDate;
  const sum = rows => rows.reduce((total, row) => total + row.amount, 0);
  const openingBalance = company.openingBalance
    + sum(payments.filter(p => beforeBase(p.receivedAt)))
    - sum(expenses.filter(e => beforeBase(e.date)));
  const includedExpenses = expenses.filter(e => e.date >= input.baseDate && e.date <= endDate);
  let balance = openingBalance;
  const days = Array.from({ length: input.days }, (_, index) => {
    const date = addDays(input.baseDate, index);
    balance += sum(expected.includedReceipts.filter(r => r.date === date))
      - sum(includedExpenses.filter(e => e.date === date));
    return { date, balance };
  });
  const minimum = days.reduce((a, b) => b.balance < a.balance ? b : a);
  const breaches = days.filter(d => d.balance < company.safetyLine);
  return {
    openingBalance, endDate, days, includedExpenseCount: includedExpenses.length,
    summary: {
      endBalance: days.at(-1).balance,
      minBalance: minimum.balance,
      minDate: minimum.date,
      firstBreachDate: breaches[0]?.date ?? null,
      breachDays: breaches.length,
      maxGapToSafety: Math.max(0, company.safetyLine - minimum.balance),
      maxShortfallBelowZero: Math.max(0, -minimum.balance),
    },
  };
}
