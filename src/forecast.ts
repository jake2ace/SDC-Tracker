import type { Forecast, ForecastDay, ForecastEntry, ForecastInput, ForecastScenario, Invoice, PaymentPromise } from "../contracts/domain.ts";
import { AppError } from "./errors.ts";

const DAY = 86_400_000;
const MYT_OFFSET = 8 * 60 * 60 * 1000;

function invalid(field: string, message: string): never {
  throw new AppError(422, "VALIDATION_ERROR", message, {
    fieldErrors: [{ field, code: "invalid", message }],
  });
}

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value;
}

function validTimestamp(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/u.test(value) &&
    validDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function mytDate(timestamp: string): string {
  return new Date(Date.parse(timestamp) + MYT_OFFSET).toISOString().slice(0, 10);
}

function addDays(date: string, days: number): string {
  const shifted = new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY).toISOString().slice(0, 10);
  if (!validDate(shifted)) invalid("asOfDate", "Forecast dates must stay within the four-digit calendar year range.");
  return shifted;
}

function integer(value: number, field: string, minimum = -Number.MAX_SAFE_INTEGER): number {
  if (!Number.isSafeInteger(value) || value < minimum) invalid(field, "Expected a safe integer amount in sen.");
  return value;
}

function sum(left: number, right: number): number {
  return integer(left + right, "forecast", -Number.MAX_SAFE_INTEGER);
}

function scoped<T extends { id: string; companyId: string }>(values: T[], companyId: string, field: string): T[] {
  if (!Array.isArray(values)) invalid(field, "Expected a list of records.");
  const records = values.filter(value => value && value.companyId === companyId);
  const ids = new Set<string>();
  for (const record of records) {
    if (typeof record.id !== "string" || !record.id.trim() || ids.has(record.id)) {
      invalid(field, "Records must have distinct non-empty identifiers.");
    }
    ids.add(record.id);
  }
  return records.slice().sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function validateInvoice(invoice: Invoice): void {
  integer(invoice.totalAmountSen, "invoices.totalAmountSen", 1);
  integer(invoice.paidAmountSen, "invoices.paidAmountSen", 0);
  integer(invoice.outstandingAmountSen, "invoices.outstandingAmountSen", 0);
  if (invoice.currency !== "MYR" || invoice.totalAmountSen - invoice.paidAmountSen !== invoice.outstandingAmountSen) {
    invalid("invoices", "Invoice currency or balances are inconsistent.");
  }
  if (!validDate(invoice.dueDate)) invalid("invoices.dueDate", "Expected a real YYYY-MM-DD due date.");
  const statusValid = {
    issued: invoice.paidAmountSen === 0,
    partially_paid: invoice.paidAmountSen > 0 && invoice.outstandingAmountSen > 0,
    paid: invoice.outstandingAmountSen === 0,
    draft: invoice.paidAmountSen === 0,
    rejected: invoice.paidAmountSen === 0,
  };
  if (!Object.hasOwn(statusValid, invoice.status) || !statusValid[invoice.status]) {
    invalid("invoices.status", "Invoice status does not match its balances.");
  }
}

function activePromise(invoice: Invoice, promises: PaymentPromise[], asOf: string): PaymentPromise | undefined {
  return promises.find(promise => promise.id === invoice.confirmedPromiseId && promise.invoiceId === invoice.id &&
    promise.status === "active" && validDate(promise.promisedDate) && validTimestamp(promise.confirmedAt) &&
    Date.parse(promise.confirmedAt) <= Date.parse(asOf) && typeof promise.confirmedBy === "string" &&
    promise.confirmedBy.trim().length > 0 && Number.isSafeInteger(promise.amountSen) && promise.amountSen > 0);
}

/** Pure 30-day view of the current ledger. Opening cash already includes earlier payments. */
export function calculateForecast(input: ForecastInput): Forecast {
  if (!input || typeof input !== "object") invalid("forecast", "Expected forecast input.");
  if (typeof input.companyId !== "string" || !input.companyId.trim()) invalid("companyId", "Company is required.");
  if (!validTimestamp(input.asOf)) invalid("asOf", "Expected a valid UTC timestamp.");
  if (!validDate(input.asOfDate) || mytDate(input.asOf) !== input.asOfDate) {
    invalid("asOfDate", "The forecast date must equal the MYT date of the current ledger clock.");
  }
  integer(input.openingBalanceSen, "openingBalanceSen");
  integer(input.safetyThresholdSen, "safetyThresholdSen");
  if (!Number.isSafeInteger(input.delayDays) || input.delayDays < 0 || input.delayDays > 30) {
    invalid("delayDays", "Delay must be an integer from 0 to 30 days.");
  }

  const invoices = scoped(input.invoices, input.companyId, "invoices");
  const promises = scoped(input.promises, input.companyId, "promises");
  const payments = scoped(input.payments, input.companyId, "payments");
  const expenses = scoped(input.expenses, input.companyId, "expenses");
  for (const invoice of invoices) validateInvoice(invoice);
  const invoiceById = new Map(invoices.map(invoice => [invoice.id, invoice]));
  const paymentTotals = new Map<string, number>();
  const credits = new Set<string>();
  for (const payment of payments) {
    integer(payment.amountSen, "payments.amountSen", 1);
    if (!validTimestamp(payment.confirmedAt) || Date.parse(payment.confirmedAt) > Date.parse(input.asOf) ||
        !validDate(payment.effectiveDate) || payment.effectiveDate !== mytDate(payment.confirmedAt)) {
      invalid("payments", "Payments must be confirmed by the ledger clock and use their MYT confirmation date.");
    }
    if (!invoiceById.has(payment.invoiceId) || !payment.bankCreditId || credits.has(payment.bankCreditId)) {
      invalid("payments", "Payments require a current company invoice and a distinct allocated bank credit.");
    }
    credits.add(payment.bankCreditId);
    const total = sum(paymentTotals.get(payment.invoiceId) ?? 0, payment.amountSen);
    if (total > invoiceById.get(payment.invoiceId)!.paidAmountSen) invalid("payments", "Payments exceed the invoice's recorded paid amount.");
    paymentTotals.set(payment.invoiceId, total);
  }
  for (const expense of expenses) {
    integer(expense.amountSen, "expenses.amountSen", 1);
    if (!validDate(expense.dueDate)) invalid("expenses.dueDate", "Expected a real YYYY-MM-DD due date.");
  }

  const endDate = addDays(input.asOfDate, 29);
  function scenario(kind: ForecastScenario["kind"], delayDays: number): ForecastScenario {
    const entries: ForecastEntry[] = [];
    const deferredInvoiceIds: string[] = [];
    for (const payment of payments.filter(value => value.effectiveDate === input.asOfDate)) {
      entries.push({ id: `${kind}:payment:${payment.id}`, date: payment.effectiveDate, kind: "actual_payment",
        amountSen: payment.amountSen, sourceId: payment.id, invoiceId: payment.invoiceId });
    }
    for (const invoice of invoices.filter(value => ["issued", "partially_paid"].includes(value.status))) {
      const dueDate = activePromise(invoice, promises, input.asOf)?.promisedDate ?? invoice.dueDate;
      const date = addDays(dueDate < input.asOfDate ? input.asOfDate : dueDate, delayDays);
      if (date > endDate) { deferredInvoiceIds.push(invoice.id); continue; }
      entries.push({ id: `${kind}:invoice:${invoice.id}`, date, kind: "expected_receipt",
        amountSen: invoice.outstandingAmountSen, sourceId: invoice.id, invoiceId: invoice.id });
    }
    for (const expense of expenses.filter(value => value.dueDate >= input.asOfDate && value.dueDate <= endDate)) {
      entries.push({ id: `${kind}:expense:${expense.id}`, date: expense.dueDate, kind: "expense",
        amountSen: -expense.amountSen, sourceId: expense.id, invoiceId: null });
    }
    const days: ForecastDay[] = [];
    let balance = input.openingBalanceSen;
    for (let offset = 0; offset < 30; offset++) {
      const date = addDays(input.asOfDate, offset);
      const dayEntries = entries.filter(entry => entry.date === date);
      const amount = (entryKind: ForecastEntry["kind"]) => dayEntries.filter(entry => entry.kind === entryKind)
        .reduce((total, entry) => sum(total, entry.amountSen), 0);
      const actualReceiptsSen = amount("actual_payment");
      const expectedReceiptsSen = amount("expected_receipt");
      const expensesSen = -amount("expense") || 0;
      const closingBalanceSen = sum(sum(sum(balance, actualReceiptsSen), expectedReceiptsSen), -expensesSen);
      days.push({ date, openingBalanceSen: balance, actualReceiptsSen, expectedReceiptsSen, expensesSen,
        closingBalanceSen, belowSafetyThreshold: closingBalanceSen < input.safetyThresholdSen,
        entryIds: dayEntries.map(entry => entry.id) });
      balance = closingBalanceSen;
    }
    return { kind, delayDays, entries, days, deferredInvoiceIds };
  }
  return { companyId: input.companyId, asOf: input.asOf, asOfDate: input.asOfDate, timezone: "Asia/Kuala_Lumpur",
    horizonDays: 30, openingBalanceSen: input.openingBalanceSen, safetyThresholdSen: input.safetyThresholdSen,
    scenarios: [scenario("on_time", 0), scenario("delayed", input.delayDays)] };
}
