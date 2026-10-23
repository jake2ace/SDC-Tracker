import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { Forecast, ForecastDay, ForecastInput, Invoice } from "../../contracts/domain.ts";
import { calculateForecast } from "../../src/forecast.ts";
import { AppError } from "../../src/errors.ts";

const inputs = JSON.parse(readFileSync(new URL("../../data/eval/forecast.inputs.json", import.meta.url), "utf8")) as {
  samples: { id: string; input: ForecastInput }[];
};
const gold = JSON.parse(readFileSync(new URL("../../data/eval/forecast.gold.json", import.meta.url), "utf8")) as {
  metadata: { comparisonFields: (keyof ForecastDay)[] };
  labels: { id: string; windowDays: number; days: Partial<ForecastDay>[];
    expectedReceiptSchedule: { invoiceId: string; date: string; amountSen: number }[] }[];
};
const baseline = () => structuredClone(inputs.samples[0].input);
const afterPayment = () => structuredClone(inputs.samples[1].input);
const expectedEntries = (forecast: Forecast, index = 0) => forecast.scenarios[index].entries
  .filter(entry => entry.kind === "expected_receipt").map(({ date, amountSen }) => ({ date, amountSen }));

test("forecast matches all four frozen schedules and forty hand-calculated daily balances", () => {
  for (const { id, input } of inputs.samples) {
    const before = structuredClone(input), label = gold.labels.find(value => value.id === id)!;
    const actual = calculateForecast(input), scenario = actual.scenarios[input.delayDays === 0 ? 0 : 1];
    assert.deepEqual(scenario.days.slice(0, 10).map(day => Object.fromEntries(
      gold.metadata.comparisonFields.map(field => [field, day[field]]))), label.days, id);
    assert.deepEqual(scenario.entries.filter(entry => entry.kind === "expected_receipt").map(
      ({ invoiceId, date, amountSen }) => ({ invoiceId, date, amountSen })), label.expectedReceiptSchedule, id);
    assert.deepEqual([calculateForecast(input), input], [actual, before], `${id}: deterministic and immutable`);
    for (const result of actual.scenarios) {
      assert.equal(result.days.length, 30);
      for (const [index, day] of result.days.entries()) {
        assert.deepEqual({ opening: day.openingBalanceSen, closing: day.closingBalanceSen, ids: day.entryIds }, {
          opening: index === 0 ? input.openingBalanceSen : result.days[index - 1].closingBalanceSen,
          closing: day.openingBalanceSen + day.actualReceiptsSen + day.expectedReceiptsSen - day.expensesSen,
          ids: result.entries.filter(entry => entry.date === day.date).map(entry => entry.id),
        });
      }
    }
  }
});

test("forecast preserves the accounting meaning of history, partial payment, promises and delayed cash", () => {
  const cases: { name: string; input: () => ForecastInput; change: (input: ForecastInput) => void;
    inspect: (forecast: Forecast) => unknown; expected: unknown }[] = [
    { name: "partial payment is actual once and only the remaining balance is expected", input: afterPayment, change: () => {},
      inspect: f => [f.scenarios[0].days[0].actualReceiptsSen, expectedEntries(f)], expected: [900000, [{ date: "2026-10-28", amountSen: 900000 }]] },
    { name: "history is already in opening cash", input: afterPayment,
      change: i => { i.openingBalanceSen = 1100000; i.payments[0].confirmedAt = "2026-10-22T03:00:00Z"; i.payments[0].effectiveDate = "2026-10-22"; i.expenses[0].dueDate = "2026-10-22"; },
      inspect: f => [f.scenarios[0].days[0].closingBalanceSen, f.scenarios[0].entries.map(e => e.kind)], expected: [1100000, ["expected_receipt", "expense"]] },
    { name: "fully paid invoice has no expected second receipt", input: afterPayment,
      change: i => { i.invoices[0].paidAmountSen = 1800000; i.invoices[0].outstandingAmountSen = 0; i.invoices[0].status = "paid"; i.payments[0].amountSen = 1800000; },
      inspect: f => [f.scenarios[0].days[0].actualReceiptsSen, expectedEntries(f)], expected: [1800000, []] },
    { name: "overdue date clamps before delay, expenses stay on their due dates", input: baseline,
      change: i => { i.delayDays = 7; }, inspect: f => [expectedEntries(f, 1), f.scenarios[1].entries.filter(e => e.kind === "expense").map(e => e.date)],
      expected: [[{ date: "2026-10-30", amountSen: 1800000 }], ["2026-10-25", "2026-10-30"]] },
    { name: "thirty-day delay is deferred beyond the final day", input: baseline,
      change: i => { i.delayDays = 30; }, inspect: f => [expectedEntries(f, 1), f.scenarios[1].deferredInvoiceIds, f.scenarios[1].days[29].date], expected: [[], ["inv_lumen_001"], "2026-11-21"] },
    { name: "invoice due after the view is listed as deferred in both scenarios", input: baseline,
      change: i => { i.invoices[0].dueDate = "2026-11-22"; }, inspect: f => f.scenarios.map(s => s.deferredInvoiceIds), expected: [["inv_lumen_001"], ["inv_lumen_001"]] },
    { name: "zero-delay scenarios have equal balances", input: afterPayment, change: () => {},
      inspect: f => f.scenarios.map(s => s.days.map(({ entryIds, ...day }) => day)).every((s, _, a) => JSON.stringify(s) === JSON.stringify(a[0])), expected: true },
    { name: "equal safety threshold does not trigger an alert", input: baseline,
      change: i => { i.invoices = []; i.expenses = []; i.openingBalanceSen = i.safetyThresholdSen; }, inspect: f => f.scenarios[0].days[0].belowSafetyThreshold, expected: false },
    { name: "negative cash is supported and triggers an alert", input: baseline,
      change: i => { i.invoices = []; i.expenses = []; i.openingBalanceSen = -1; }, inspect: f => [f.scenarios[0].days[0].closingBalanceSen, f.scenarios[0].days[0].belowSafetyThreshold], expected: [-1, true] },
    { name: "MYT year rollover uses the local date", input: baseline,
      change: i => { i.asOf = "2026-12-31T16:30:00Z"; i.asOfDate = "2027-01-01"; }, inspect: f => [f.scenarios[0].days[0].date, f.scenarios[0].days[29].date], expected: ["2027-01-01", "2027-01-30"] },
    { name: "leap day is counted exactly once", input: baseline,
      change: i => { i.asOf = "2028-02-28T16:30:00Z"; i.asOfDate = "2028-02-29"; }, inspect: f => [f.scenarios[0].days[0].date, f.scenarios[0].days[29].date], expected: ["2028-02-29", "2028-03-29"] },
    ...["superseded", "wrong_invoice", "future_confirmation", "invalid_date"].map(reason => ({
      name: `${reason} promise falls back to invoice due date`, input: afterPayment,
      change: (i: ForecastInput) => { const p = i.promises[0]; if (reason === "superseded") p.status = "superseded";
        if (reason === "wrong_invoice") p.invoiceId = "another_invoice";
        if (reason === "future_confirmation") p.confirmedAt = "2026-10-24T03:00:00Z";
        if (reason === "invalid_date") p.promisedDate = "2026-02-30"; },
      inspect: (f: Forecast) => expectedEntries(f), expected: [{ date: "2026-10-23", amountSen: 900000 }],
    })),
  ];
  for (const scenario of cases) { const input = scenario.input(); scenario.change(input);
    assert.deepEqual(scenario.inspect(calculateForecast(input)), scenario.expected, scenario.name); }
});

test("forecast ignores foreign tenant records without exposing their IDs, dates or amounts", () => {
  const input = afterPayment(), expected = calculateForecast(input);
  input.invoices.push({ ...input.invoices[0], companyId: "foreign", id: "foreign-invoice", totalAmountSen: NaN });
  input.promises.push({ ...input.promises[0], companyId: "foreign", id: "foreign-promise" });
  input.payments.push({ ...input.payments[0], companyId: "foreign", id: "foreign-payment", confirmedAt: "future-invalid" });
  input.expenses.push({ ...input.expenses[0], companyId: "foreign", id: "foreign-expense", amountSen: NaN });
  assert.deepEqual(calculateForecast(input), expected);
});

test("forecast rejects invalid dates, future actuals, duplicate allocations and unsafe arithmetic", () => {
  const cases: [string, (input: ForecastInput) => void][] = [
    ["invalid date", i => { i.asOfDate = "2026-02-30"; }],
    ["MYT date mismatch", i => { i.asOfDate = "2026-10-22"; }],
    ["bad timestamp", i => { i.asOf = "2026-10-23T99:00:00Z"; }],
    ["fractional delay", i => { i.delayDays = 0.5; }],
    ["negative delay", i => { i.delayDays = -1; }],
    ["excess delay", i => { i.delayDays = 31; }],
    ["future actual", i => { i.payments[0].confirmedAt = "2026-10-23T05:00:00Z"; }],
    ["future effective date", i => { i.payments[0].effectiveDate = "2026-10-24"; }],
    ["foreign invoice link", i => { i.payments[0].invoiceId = "foreign-invoice"; }],
    ["duplicate payment", i => { i.payments.push(structuredClone(i.payments[0])); }],
    ["duplicate allocation", i => { i.payments.push({ ...i.payments[0], id: "second-payment" }); }],
    ["overcounted payment", i => { i.payments[0].amountSen = 900001; }],
    ["bad invoice balance", i => { i.invoices[0].outstandingAmountSen = 1; }],
    ["paid invoice with outstanding", i => { i.invoices[0].status = "paid"; }],
    ["foreign currency", i => { i.invoices[0].currency = "USD" as Invoice["currency"]; }],
    ["fractional money", i => { i.expenses[0].amountSen = 0.5; }],
    ["invalid expense date", i => { i.expenses[0].dueDate = "2026-02-30"; }],
    ["unsafe starting balance", i => { i.openingBalanceSen = Number.MAX_SAFE_INTEGER + 1; }],
    ["overflow during addition", i => { i.openingBalanceSen = Number.MAX_SAFE_INTEGER; }],
    ["underflow during expense", i => { i.invoices = []; i.payments = []; i.openingBalanceSen = -Number.MAX_SAFE_INTEGER; }],
    ["overflow cannot be hidden by later expense cancellation", i => { i.openingBalanceSen = Number.MAX_SAFE_INTEGER; i.expenses[0].dueDate = i.asOfDate; i.expenses[0].amountSen = 900000; }],
  ];
  for (const [name, change] of cases) { const input = afterPayment(); change(input);
    assert.throws(() => calculateForecast(input), error => error instanceof AppError && error.status === 422, name); }
});
