import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.ts";
import type {
  ApiError, ApiSuccess, BankImportResult, PaymentApprovedResult, PromiseConfirmedResult,
  ReceiptUploadedResult, ReplyCreatedResult,
} from "../../contracts/api.ts";
import type { ActivityEvent, BankCredit, Forecast, Invoice, MatchResult, PaymentPromise, Receipt, Reminder, Reply } from "../../contracts/domain.ts";

const COMPANY = "co_lumen", INVOICE = "inv_lumen_001", FINANCE = "u_lumen_finance";
const CLOCK = "2026-10-23T04:00:00Z", HALF = 900000;
const REFERENCE = "LMN-231026-001";
type App = Awaited<ReturnType<typeof createApp>>;
type Response<T> = { status: number; body: ApiSuccess<T> | ApiError };
type Fixture = Awaited<ReturnType<typeof fixture>>;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-reconciliation-"));
  const unavailable = async (): Promise<never> => { throw new Error("Use audited manual evidence in this integration fixture."); };
  const options = { dbPath: join(directory, "demo.sqlite"), clock: CLOCK,
    extractionProvider: unavailable, reminderProvider: unavailable, ocrProvider: unavailable };
  let app: App, base: string;
  async function open() {
    app = await createApp(options);
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const address = app.server.address();
    assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  }
  await open();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { get app() { return app; }, get base() { return base; }, async restart() { await app.close(); await open(); } };
}

async function request<T>(f: Fixture, path: string, body?: unknown, key = "", actor = FINANCE, method?: string): Promise<Response<T>> {
  const form = body instanceof FormData;
  const response = await fetch(`${f.base}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "X-Demo-User": actor, ...(key ? { "Idempotency-Key": key } : {}),
      ...(!form && body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : form ? body : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as ApiSuccess<T> | ApiError };
}
function success<T>(result: Response<T>, status = 200): T {
  assert.equal(result.status, status, JSON.stringify(result.body));
  if (!("data" in result.body)) throw new Error(JSON.stringify(result.body));
  return result.body.data;
}
function rejected(result: Response<unknown>, status: number, code?: string) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  if (!("error" in result.body)) throw new Error("Expected an API error.");
  if (code) assert.equal(result.body.error.code, code);
}
function invoice(f: Fixture): Invoice { return f.app.store.get<Invoice>("invoices", INVOICE, COMPANY)!; }
function ledger(f: Fixture) {
  return {
    company: f.app.store.getCompany(COMPANY),
    entities: ["invoices", "bankCredits", "payments", "promises", "matches", "replies", "reminders"]
      .map(kind => f.app.store.list(kind as "invoices", COMPANY)),
  };
}
async function manualReceipt(f: Fixture, key: string, reference = REFERENCE, imageNumber = 1): Promise<Receipt> {
  const image = readFileSync(new URL(`../../data/eval/images/receipt_eval_${String(imageNumber).padStart(3, "0")}.png`, import.meta.url));
  const form = new FormData();
  form.set("expectedVersion", String(invoice(f).version));
  form.set("file", new Blob([image], { type: "image/png" }), "synthetic-receipt.png");
  const uploaded = success(await request<ReceiptUploadedResult>(f, `/api/invoices/${INVOICE}/receipts`, form, `${key}:upload`)).receipt;
  return success(await request<Receipt>(f, `/api/receipts/${uploaded.id}/evidence`, {
    expectedVersion: uploaded.version, bank: "DEMO SENDER BANK A", amountSen: HALF, reference,
    payer: "KOPI TIGA TEST", transferredAt: "2026-10-23T02:30:00Z", reason: "Checked synthetic receipt fields against the retained test image.",
  }, `${key}:correct`, FINANCE, "PATCH"));
}
async function pendingMatch(f: Fixture, key: string, reference = REFERENCE, imageNumber = 1): Promise<MatchResult> {
  const receipt = await manualReceipt(f, key, reference, imageNumber);
  return success(await request<MatchResult>(f, `/api/receipts/${receipt.id}/match`, {
    expectedVersion: receipt.version, expectedInvoiceVersion: invoice(f).version,
  }, `${key}:match`));
}
async function approve(f: Fixture, match: MatchResult, key: string) {
  return request<PaymentApprovedResult>(f, `/api/matches/${match.id}/approve-payment`, { expectedVersion: match.version }, key);
}
async function manualPromise(f: Fixture, key: string, date = "2026-10-28"): Promise<Reply> {
  const created = success(await request<ReplyCreatedResult>(f, `/api/invoices/${INVOICE}/replies`, {
    expectedVersion: invoice(f).version, text: "I will pay the entire remaining amount on 28 October.",
    receivedAt: "2026-10-23T03:00:00Z", language: "en",
  }, `${key}:create`), 201).reply;
  return success(await request<Reply>(f, `/api/replies/${created.id}/extraction`, {
    expectedVersion: created.version, intent: "promise", amountSen: invoice(f).outstandingAmountSen,
    promisedDate: date, reason: "Confirmed the full remaining amount and date against the synthetic reply.",
  }, `${key}:correct`, FINANCE, "PATCH"));
}
function promiseCommand(f: Fixture, reply: Reply) {
  return { expectedVersion: reply.version, expectedInvoiceVersion: invoice(f).version,
    promisedDate: reply.extraction!.promisedDate, amountSen: invoice(f).outstandingAmountSen };
}
async function forecast(f: Fixture, actor = FINANCE): Promise<Forecast> {
  return success(await request<Forecast>(f, "/api/forecast?asOfDate=2026-10-23&delayDays=7", undefined, "", actor));
}

test("partial collection, confirmed promise and final payment stay connected without double-counting cash", async t => {
  const f = await fixture(t);
  const pending = await pendingMatch(f, "flow:first");
  assert.deepEqual([pending.verdict, pending.status, invoice(f).outstandingAmountSen, f.app.store.list("payments", COMPANY).length],
    ["partial", "pending", HALF * 2, 0]);

  const partial = success(await approve(f, pending, "flow:partial"));
  assert.deepEqual([partial.payment.amountSen, partial.invoice.paidAmountSen, partial.invoice.outstandingAmountSen,
    partial.invoice.status, partial.invoice.collectionStatus, partial.bankCredit.allocatedPaymentId],
  [HALF, HALF, HALF, "partially_paid", "active", partial.payment.id]);
  const reminder = success(await request<Reminder>(f, `/api/invoices/${INVOICE}/reminders`, {
    expectedVersion: partial.invoice.version, language: "en",
  }, "flow:remainder-reminder"), 201);
  assert.match(reminder.draftText, /9,?000\.00/);

  const reply = await manualPromise(f, "flow:promise");
  const promised = success(await request<PromiseConfirmedResult>(f, `/api/replies/${reply.id}/confirm-promise`, promiseCommand(f, reply), "flow:confirm-promise"));
  const predicted = await forecast(f);
  for (const scenario of predicted.scenarios) {
    const entries = scenario.entries.filter(entry => entry.invoiceId === INVOICE);
    assert.deepEqual(entries.map(entry => [entry.kind, entry.amountSen, entry.date]).sort(), [
      ["actual_payment", HALF, "2026-10-23"],
      ["expected_receipt", HALF, scenario.kind === "on_time" ? "2026-10-28" : "2026-11-04"],
    ]);
  }

  const csv = new FormData();
  csv.set("expectedVersion", String(partial.companyVersion));
  csv.set("file", new Blob(["externalId,postedDate,amountSen,reference,payer,bank\nFINAL-002,2026-10-23,900000,LMN-REMAIN-002,KOPI TIGA TEST,DEMO RECEIVING BANK\n"], { type: "text/csv" }), "remaining.csv");
  success(await request<BankImportResult>(f, "/api/bank-statements", csv, "flow:import-remaining"));
  const finalMatch = await pendingMatch(f, "flow:final", "LMN-REMAIN-002", 2);
  const paid = success(await approve(f, finalMatch, "flow:pay-remaining"));
  assert.deepEqual([paid.invoice.status, paid.invoice.paidAmountSen, paid.invoice.outstandingAmountSen, paid.invoice.collectionStatus,
    f.app.store.get<PaymentPromise>("promises", promised.promise.id, COMPANY)?.status], ["paid", HALF * 2, 0, "stopped", "fulfilled"]);
  rejected(await request(f, `/api/invoices/${INVOICE}/reminders`, { expectedVersion: paid.invoice.version, language: "en" }, "flow:no-more-reminders"), 409, "INVALID_STATE");
  rejected(await request(f, `/api/reminders/${reminder.id}/send`, { expectedVersion: reminder.version,
    expectedInvoiceVersion: paid.invoice.version, text: reminder.draftText }, "flow:stale-reminder"), 409);

  const after = await forecast(f);
  assert.ok(after.scenarios.every(scenario => scenario.entries.filter(entry => entry.invoiceId === INVOICE)
    .every(entry => entry.kind === "actual_payment")));
  const persisted = ledger(f);
  await f.restart();
  assert.deepEqual([ledger(f), await forecast(f)], [persisted, after]);
});

test("payment retries and simultaneous approvals allocate one bank credit only once", async t => {
  const f = await fixture(t), match = await pendingMatch(f, "retry");
  const secondProposal = success(await request<MatchResult>(f, `/api/receipts/${match.receiptId}/match`, {
    expectedVersion: match.receiptVersion, expectedInvoiceVersion: match.invoiceVersion,
  }, "retry:second-proposal"));
  const results = await Promise.all([approve(f, match, "retry:first"), approve(f, secondProposal, "retry:second")]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results[0].status === 200 ? 0 : 1;
  const original = success(results[winner]);
  const key = winner === 0 ? "retry:first" : "retry:second";
  await f.restart();
  const replay = await approve(f, winner === 0 ? match : secondProposal, key);
  assert.deepEqual(success(replay), original);
  assert.equal(replay.body.meta.idempotencyReplayed, true);
  rejected(await approve(f, original.match, "retry:already-applied"), 409, "INVALID_STATE");
  const repeated = success(await request<MatchResult>(f, `/api/receipts/${match.receiptId}/match`, {
    expectedVersion: match.receiptVersion, expectedInvoiceVersion: original.invoice.version,
  }, "retry:rematch"));
  assert.deepEqual([repeated.verdict, f.app.store.list("payments", COMPANY).length, invoice(f).paidAmountSen], ["duplicate", 1, HALF]);
  rejected(await approve(f, repeated, "retry:duplicate-evidence"), 422, "REVIEW_REQUIRED");
});

test("payment approval rejects foreign actors, injected amounts and changed review snapshots", async t => {
  const f = await fixture(t), match = await pendingMatch(f, "guards");
  const path = `/api/matches/${match.id}/approve-payment`, command = { expectedVersion: match.version };
  const before = ledger(f);
  for (const [actor, status] of [["u_lumen_owner", 403], ["u_lumen_pm", 403], ["u_rantau_finance", 404]] as const)
    rejected(await request(f, path, command, `guard:actor-${actor}`, actor), status);
  rejected(await request(f, path, { ...command, amountSen: 1 }, "guard:amount"), 422, "VALIDATION_ERROR");
  rejected(await request(f, path, { ...command, companyId: "co_rantau" }, "guard:tenant"), 422, "VALIDATION_ERROR");
  assert.deepEqual(ledger(f), before);

  const receipt = f.app.store.get<Receipt>("receipts", match.receiptId, COMPANY)!;
  const currentInvoice = invoice(f), company = f.app.store.getCompany(COMPANY)!;
  const credit = f.app.store.get<BankCredit>("bankCredits", match.eligibleCreditId!, COMPANY)!;
  for (const [kind, entity] of [["receipts", receipt], ["invoices", currentInvoice], ["bankCredits", credit]] as const) {
    f.app.store.put(kind, { ...entity, version: entity.version + 1 });
    rejected(await request(f, path, command, `guard:changed-${kind}`), 409, "VERSION_CONFLICT");
    f.app.store.put(kind, entity);
  }
  f.app.store.updateCompany({ ...company, version: company.version + 1 });
  rejected(await request(f, path, command, "guard:changed-ledger"), 409, "VERSION_CONFLICT");
  f.app.store.updateCompany(company);
  f.app.store.put("bankCredits", { ...credit, payer: "UNRELATED TEST PAYER" });
  rejected(await request(f, path, command, "guard:changed-evidence"), 422, "REVIEW_REQUIRED");
  f.app.store.put("bankCredits", credit);
  assert.deepEqual(ledger(f), before);
});

test("a transaction failure rolls back payment, allocation, invoice, audit and retry state", async t => {
  const f = await fixture(t), match = await pendingMatch(f, "rollback");
  const before = ledger(f), auditBefore = f.app.store.list<ActivityEvent>("activityLog", COMPANY).filter(event => event.outcome === "succeeded");
  const saveIdempotency = f.app.store.saveIdempotency;
  f.app.store.saveIdempotency = () => { throw new Error("Injected failure after all ledger mutations."); };
  try { rejected(await approve(f, match, "rollback:approve"), 500, "INTERNAL_ERROR"); }
  finally { f.app.store.saveIdempotency = saveIdempotency; }
  assert.deepEqual([ledger(f), f.app.store.list<ActivityEvent>("activityLog", COMPANY).filter(event => event.outcome === "succeeded"),
    f.app.store.getIdempotency(COMPANY, FINANCE, "rollback:approve")], [before, auditBefore, undefined]);
  success(await approve(f, match, "rollback:approve"));
  assert.equal(f.app.store.list("payments", COMPANY).length, 1);
});

test("promise confirmation requires Finance review, full remainder and current evidence, then supersedes safely", async t => {
  const f = await fixture(t), reply = await manualPromise(f, "promise:first");
  const path = `/api/replies/${reply.id}/confirm-promise`, command = promiseCommand(f, reply), before = ledger(f);
  for (const [name, changes, status, code] of [
    ["amount", { amountSen: HALF }, 422, "REVIEW_REQUIRED"],
    ["date", { promisedDate: "2026-10-29" }, 422, "REVIEW_REQUIRED"],
    ["invalid-date", { promisedDate: "2026-02-30" }, 422, "VALIDATION_ERROR"],
    ["stale-reply", { expectedVersion: 99 }, 409, "VERSION_CONFLICT"],
    ["stale-invoice", { expectedInvoiceVersion: 99 }, 409, "VERSION_CONFLICT"],
    ["extra", { confirmedBy: FINANCE }, 422, "VALIDATION_ERROR"],
  ] as const) rejected(await request(f, path, { ...command, ...changes }, `promise:guard-${name}`), status, code);
  for (const [actor, status] of [["u_lumen_owner", 403], ["u_lumen_pm", 403], ["u_rantau_finance", 404]] as const)
    rejected(await request(f, path, command, `promise:actor-${actor}`, actor), status);
  assert.deepEqual(ledger(f), before);

  const original = success(await request<PromiseConfirmedResult>(f, path, command, "promise:confirm-first"));
  const replacement = await manualPromise(f, "promise:replacement", "2026-10-30");
  const updated = success(await request<PromiseConfirmedResult>(f, `/api/replies/${replacement.id}/confirm-promise`, promiseCommand(f, replacement), "promise:confirm-replacement"));
  assert.deepEqual([f.app.store.get<PaymentPromise>("promises", original.promise.id, COMPANY)?.status, updated.promise.status,
    updated.invoice.confirmedPromiseId, f.app.store.list("payments", COMPANY).length], ["superseded", "active", updated.promise.id, 0]);
  const replay = await request<PromiseConfirmedResult>(f, path, command, "promise:confirm-first");
  assert.deepEqual(success(replay), original);
  rejected(await request(f, path, { ...command, expectedVersion: original.reply.version,
    expectedInvoiceVersion: updated.invoice.version }, "promise:repeat-new-key"), 409, "INVALID_STATE");
});

test("forecast is a read-only tenant-scoped view with strict scenario parameters", async t => {
  const f = await fixture(t), before = ledger(f);
  for (const actor of ["u_lumen_owner", FINANCE, "u_lumen_pm"]) {
    const result = await forecast(f, actor);
    assert.deepEqual([result.companyId, result.horizonDays, result.scenarios.map(scenario => scenario.days.length)], [COMPANY, 30, [30, 30]]);
  }
  const foreign = await forecast(f, "u_rantau_finance");
  assert.ok(foreign.companyId === "co_rantau" && foreign.scenarios.every(scenario => scenario.entries.every(entry => entry.invoiceId !== INVOICE)));
  for (const query of ["delayDays=-1", "delayDays=1.5", "asOfDate=2026-02-30", "companyId=co_rantau", "delayDays=7&delayDays=0"])
    rejected(await request(f, `/api/forecast?${query}`), 422, "VALIDATION_ERROR");
  assert.deepEqual(ledger(f), before);
});
