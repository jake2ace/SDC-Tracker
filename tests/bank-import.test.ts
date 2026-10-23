import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import type { ApiError, ApiSuccess, BankImportResult } from "../contracts/api.ts";
import type { MatcherInput, MatchResult } from "../contracts/domain.ts";

const COMPANY = "co_lumen";
const FINANCE = "u_lumen_finance";
const CLOCK = "2026-10-23T04:00:00Z";
const HEADER = "externalId,postedDate,amountSen,reference,payer,bank";
const ROW = "NEW-001,2026-10-22,12300,NEW-REFERENCE,KOPI TIGA TEST,DEMO RECEIVING BANK";
const CSV = `${HEADER}\r\n${ROW}\r\n`;
type App = Awaited<ReturnType<typeof createApp>>;
type Result<T> = { status: number; body: ApiSuccess<T> | ApiError };
const cases = JSON.parse(readFileSync(new URL("../data/eval/matcher.inputs.json", import.meta.url), "utf8")) as {
  samples: { id: string; input: MatcherInput }[];
};

async function listen(app: App) {
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-bank-"));
  const dbPath = join(directory, "demo.sqlite");
  const options = { dbPath, clock: CLOCK, reminderProvider: async () => { throw new Error("Test provider unavailable"); } };
  let app = await createApp(options);
  let base = await listen(app);
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return {
    get app() { return app; }, get base() { return base; },
    async restart() { await app.close(); app = await createApp(options); base = await listen(app); },
  };
}

async function upload(base: string, csv: string | Uint8Array, version: number, key: string,
  actor = FINANCE, name = "statement.csv", extra?: [string, string]): Promise<Result<BankImportResult>> {
  const form = new FormData();
  form.set("expectedVersion", String(version));
  form.set("file", new Blob([typeof csv === "string" ? csv : new Uint8Array(csv)], { type: "text/csv" }), name);
  if (extra) form.append(...extra);
  const response = await fetch(`${base}/api/bank-statements`, {
    method: "POST", headers: { "X-Demo-User": actor, "Idempotency-Key": key }, body: form,
  });
  return { status: response.status, body: await response.json() as ApiSuccess<BankImportResult> | ApiError };
}

async function match(base: string, receiptId: string, body: unknown, key: string, actor = FINANCE): Promise<Result<MatchResult>> {
  const response = await fetch(`${base}/api/receipts/${receiptId}/match`, {
    method: "POST", headers: { "Content-Type": "application/json", "X-Demo-User": actor, "Idempotency-Key": key },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as ApiSuccess<MatchResult> | ApiError };
}

function success<T>(result: Result<T>): T {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok("data" in result.body, JSON.stringify(result.body));
  return result.body.data;
}

function rejected(result: Result<unknown>, status: number, code?: ApiError["error"]["code"]) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.ok("error" in result.body);
  if (code) assert.equal(result.body.error.code, code);
}

function moneyState(app: App) {
  return { invoices: app.store.list("invoices", COMPANY), payments: app.store.list("payments", COMPANY),
    reminders: app.store.list("reminders", COMPANY), promises: app.store.list("promises", COMPANY) };
}

function seedMatch(app: App, id = "matcher_eval_002") {
  const input = structuredClone(cases.samples.find(sample => sample.id === id)!.input);
  app.store.put("invoices", input.invoice);
  app.store.put("customers", input.customer);
  app.store.insert("receipts", input.receipt);
  for (const credit of input.bankCredits) app.store.put("bankCredits", credit);
  for (const receipt of input.existingReceipts) app.store.insert("receipts", receipt);
  return input;
}

test("CSV imports persist provenance and canonical idempotency without posting money", async t => {
  const f = await fixture(t);
  const before = moneyState(f.app);
  const version = f.app.store.getCompany(COMPANY)!.version;
  const original = await upload(f.base, CSV, version, "import:persist");
  const imported = success(original);
  assert.equal(imported.insertedCount, 1);
  assert.equal(imported.duplicateCount, 0);
  assert.equal(imported.companyVersion, version + 1);
  assert.equal(imported.bankCredits[0]!.amountSen, 12300);
  assert.equal(imported.bankCredits[0]!.allocatedPaymentId, null);
  assert.deepEqual(moneyState(f.app), before);
  const batches = f.app.store.getBankImports(COMPANY);
  assert.equal(batches.length, 1);
  assert.equal(batches[0]!.actorId, FINANCE);
  assert.equal(batches[0]!.companyId, COMPANY);
  assert.equal(batches[0]!.importedAt, CLOCK);
  assert.equal(batches[0]!.sourceSha256, createHash("sha256").update(CSV).digest("hex"));
  assert.equal(batches[0]!.rows[0]!.rowNumber, 2);
  assert.equal(batches[0]!.rows[0]!.creditId, imported.bankCredits[0]!.id);
  assert.equal(batches[0]!.rows[0]!.status, "imported");
  const replay = await upload(f.base, CSV, version, "import:persist", FINANCE, "renamed.csv");
  assert.deepEqual(success(replay), imported, "multipart boundary and file name do not change request identity");
  assert.equal(replay.body.meta.idempotencyReplayed, true);
  assert.deepEqual(f.app.store.getBankImports(COMPANY), batches);
  await f.restart();
  assert.deepEqual(f.app.store.getBankImports(COMPANY), batches);
  const persistedReplay = await upload(f.base, CSV, version, "import:persist");
  assert.deepEqual(success(persistedReplay), imported);
  assert.equal(persistedReplay.body.meta.idempotencyReplayed, true);
  assert.deepEqual(moneyState(f.app), before);
  assert.equal(f.app.store.getCompany(COMPANY)!.version, version + 1);
  rejected(await upload(f.base, CSV.replace("12300", "12400"), version, "import:persist"), 409, "IDEMPOTENCY_CONFLICT");
});

test("repeated files and renamed external IDs are duplicates without a ledger version bump", async t => {
  const f = await fixture(t);
  const version = f.app.store.getCompany(COMPANY)!.version;
  const first = success(await upload(f.base, CSV, version, "duplicate:first"));
  const repeated = success(await upload(f.base, CSV, first.companyVersion, "duplicate:repeat"));
  assert.equal(repeated.insertedCount, 0);
  assert.equal(repeated.duplicateCount, 1);
  assert.equal(repeated.companyVersion, first.companyVersion);
  assert.equal(repeated.duplicates[0]!.reason, "external_id");
  const renamed = success(await upload(f.base, CSV.replace("NEW-001", "NEW-RENAMED"), first.companyVersion, "duplicate:rename"));
  assert.equal(renamed.insertedCount, 0);
  assert.equal(renamed.duplicateCount, 1);
  assert.equal(renamed.duplicates[0]!.reason, "fingerprint");
  assert.equal(renamed.duplicates[0]!.existingCreditId, first.bankCredits[0]!.id);
  assert.equal(f.app.store.getCompany(COMPANY)!.version, first.companyVersion);
  const twice = success(await upload(f.base, `${HEADER}\n${ROW.replace("NEW-001", "IN-FILE-1").replace("NEW-REFERENCE", "IN-FILE-REF")}\n${ROW.replace("NEW-001", "IN-FILE-2").replace("NEW-REFERENCE", "IN-FILE-REF")}\n`, first.companyVersion, "duplicate:in-file"));
  assert.equal(twice.insertedCount, 1);
  assert.equal(twice.duplicateCount, 1);
});

test("malformed rows and conflicting external IDs fail the entire import", async t => {
  const f = await fixture(t);
  const version = f.app.store.getCompany(COMPANY)!.version;
  const before = f.app.store.list("bankCredits", COMPANY);
  const invalidFiles: (string | Uint8Array)[] = [
    `${HEADER}\n${ROW}\nBAD,2026-02-30,100,REF,KOPI TIGA TEST,BANK\n`,
    `${HEADER}\n${ROW}\nBAD,2026-10-22,1.5,REF,KOPI TIGA TEST,BANK\n`,
    `${HEADER}\n${ROW}\nBAD,2026-10-22,9007199254740992,REF,KOPI TIGA TEST,BANK\n`,
    `${HEADER}\n${ROW}\nBAD,2026-10-22,-1,REF,KOPI TIGA TEST,BANK\n`,
    `${HEADER}\n${ROW}\n"unclosed`,
    `${HEADER},companyId\n${ROW},co_rantau\n`,
    new Uint8Array([0xff, 0xfe, 0x61]),
  ];
  for (const [index, csv] of invalidFiles.entries()) {
    rejected(await upload(f.base, csv, version, `invalid:rows-${index}`), 422);
    assert.deepEqual(f.app.store.list("bankCredits", COMPANY), before);
    assert.equal(f.app.store.getCompany(COMPANY)!.version, version);
    assert.equal(f.app.store.getBankImports(COMPANY).length, 0);
  }
  const first = success(await upload(f.base, CSV, version, "conflict:first"));
  const conflictCsv = `${HEADER}\n${ROW.replace("NEW-001", "SHOULD-NOT-INSERT").replace("NEW-REFERENCE", "NEW-2")}\n${ROW.replace("12300", "12400")}\n`;
  rejected(await upload(f.base, conflictCsv, first.companyVersion, "conflict:atomic"), 409, "BANK_IMPORT_CONFLICT");
  assert.equal(f.app.store.list("bankCredits", COMPANY).length, before.length + 1);
  assert.equal(f.app.store.getCompany(COMPANY)!.version, first.companyVersion);
  const inFileConflict = `${HEADER}\n${ROW.replace("NEW-001", "SAME-IN-FILE")}\n${ROW.replace("NEW-001", "SAME-IN-FILE").replace("12300", "12400")}\n`;
  rejected(await upload(f.base, inFileConflict, first.companyVersion, "conflict:in-file"), 409, "BANK_IMPORT_CONFLICT");
  assert.equal(f.app.store.list("bankCredits", COMPANY).length, before.length + 1);
  assert.equal(f.app.store.getBankImports(COMPANY).length, 1);
});

test("CSV authorization, version and upload guards reject without exposing foreign data", async t => {
  const f = await fixture(t);
  const version = f.app.store.getCompany(COMPANY)!.version;
  for (const actor of ["u_lumen_pm", "u_lumen_owner"]) rejected(await upload(f.base, CSV, version, `guards:${actor}`, actor), 403, "FORBIDDEN");
  rejected(await upload(f.base, CSV, version + 1, "guards:stale"), 409, "VERSION_CONFLICT");
  rejected(await upload(f.base, CSV, version, "guards:tenant-field", FINANCE, "bank.csv", ["companyId", "co_rantau"]), 422);
  rejected(await upload(f.base, CSV, version, "guards:duplicate-field", FINANCE, "bank.csv", ["expectedVersion", String(version)]), 422);
  rejected(await upload(f.base, `${HEADER}\n${Array.from({ length: 1001 }, (_, i) => ROW.replace("NEW-001", `LIMIT-${i}`)).join("\n")}\n`, version, "guards:row-limit"), 422);
  rejected(await upload(f.base, " ".repeat(1024 * 1024 + 1), version, "guards:size-limit"), 413);
  assert.equal(f.app.store.getCompany(COMPANY)!.version, version);
  const foreign = success(await upload(f.base, CSV, f.app.store.getCompany("co_rantau")!.version, "guards:foreign-finance", "u_rantau_finance"));
  assert.ok(foreign.bankCredits.every(credit => credit.companyId === "co_rantau"));
  assert.equal(f.app.store.list("bankCredits", COMPANY).length, 1);
});

test("BOM, quoted CSV fields and CRLF are parsed as data", async t => {
  const f = await fixture(t);
  const csv = `\uFEFF${HEADER}\r\nQUOTED-1,2026-10-22,500,"REF,WITH,COMMAS","KOPI ""TIGA"" TEST",DEMO BANK\r\n`;
  const result = success(await upload(f.base, csv, f.app.store.getCompany(COMPANY)!.version, "quoted:csv-fields"));
  assert.equal(result.bankCredits[0]!.reference, "REF,WITH,COMMAS");
  assert.equal(result.bankCredits[0]!.payer, 'KOPI "TIGA" TEST');
});

test("matching records a pending partial proposal and snapshots without changing balances", async t => {
  const f = await fixture(t);
  const input = seedMatch(f.app);
  const before = moneyState(f.app);
  const creditsBefore = f.app.store.list("bankCredits", COMPANY);
  const command = { expectedVersion: input.receipt.version, expectedInvoiceVersion: input.invoice.version };
  const original = await match(f.base, input.receipt.id, command, "match:partial");
  const result = success(original);
  assert.equal(result.verdict, "partial");
  assert.equal(result.proposedPaymentAmountSen, 900000);
  assert.equal(result.proposedOutstandingAmountSen, 900000);
  assert.equal(result.status, "pending");
  assert.equal(result.receiptVersion, input.receipt.version);
  assert.equal(result.invoiceVersion, input.invoice.version);
  assert.equal(result.bankLedgerVersion, f.app.store.getCompany(COMPANY)!.version);
  assert.equal(result.eligibleCreditVersion, input.bankCredits[0]!.version);
  assert.deepEqual(moneyState(f.app), before);
  assert.deepEqual(f.app.store.list("bankCredits", COMPANY), creditsBefore);
  const replay = await match(f.base, input.receipt.id, command, "match:partial");
  assert.deepEqual(success(replay), result);
  assert.equal(replay.body.meta.idempotencyReplayed, true);
  assert.equal(f.app.store.list("matches", COMPANY).length, 1);
  await f.restart();
  assert.deepEqual(success(await match(f.base, input.receipt.id, command, "match:partial")), result);
  assert.deepEqual(moneyState(f.app), before);
});

test("matching enforces role, tenant, receipt and invoice versions before recording a proposal", async t => {
  const f = await fixture(t);
  const input = seedMatch(f.app);
  const command = { expectedVersion: input.receipt.version, expectedInvoiceVersion: input.invoice.version };
  rejected(await match(f.base, input.receipt.id, command, "match:owner", "u_lumen_owner"), 403, "FORBIDDEN");
  const foreign = await match(f.base, input.receipt.id, command, "match:foreign", "u_rantau_finance");
  rejected(foreign, 404, "NOT_FOUND");
  assert.ok(!JSON.stringify(foreign.body).includes(input.receipt.id));
  rejected(await match(f.base, input.receipt.id, { ...command, expectedVersion: 999 }, "match:stale-receipt"), 409, "VERSION_CONFLICT");
  rejected(await match(f.base, input.receipt.id, { ...command, expectedInvoiceVersion: 999 }, "match:stale-invoice"), 409, "VERSION_CONFLICT");
  rejected(await match(f.base, input.receipt.id, { ...command, companyId: "co_rantau" }, "match:extra-field"), 422);
  assert.equal(f.app.store.list("matches", COMPANY).length, 0);
  assert.equal(f.app.store.list("payments", COMPANY).length, 0);
});
