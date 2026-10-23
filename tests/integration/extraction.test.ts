import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.ts";
import type { ApiError, ApiSuccess, ReceiptUploadedResult, ReplyCreatedResult } from "../../contracts/api.ts";
import type { AiInput, MatchResult, Receipt, Reply } from "../../contracts/domain.ts";
import type { ExtractionProvider } from "../../src/extraction-provider.ts";

const COMPANY = "co_lumen", FINANCE = "u_lumen_finance", INVOICE = "inv_lumen_001";
const CLOCK = "2026-10-23T04:00:00Z";
const IMAGE = readFileSync(new URL("../../data/eval/images/receipt_eval_001.png", import.meta.url));
const OCR = "SYNTHETIC DEMO\nBank: DEMO SENDER BANK A\nAmount: RM 9000.00\nReference: LMN-231026-001\nPayer: KOPI TIGA TEST\nTransferred at: 2026-10-23T02:30:00Z";
const receiptFields = { bank: "DEMO SENDER BANK A", amountSen: 900000, reference: "LMN-231026-001", payer: "KOPI TIGA TEST", transferredAt: "2026-10-23T02:30:00Z" };
const validProvider: ExtractionProvider = async (input: AiInput) => input.task === "structure_receipt"
  ? { bank: receiptFields.bank, amountSen: receiptFields.amountSen, referenceToken: "REF_1", payerToken: "PAYER_1", transferredAt: receiptFields.transferredAt, confidence: 0.96 }
  : { intent: "paid", amountSen: 900000, promisedDate: null, confidence: 0.96 };
type App = Awaited<ReturnType<typeof createApp>>;
type Result<T> = { status: number; body: ApiSuccess<T> | ApiError };

async function fixture(t: TestContext, extractionProvider = validProvider) {
  const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-extraction-"));
  const options = { dbPath: join(directory, "demo.sqlite"), clock: CLOCK, extractionProvider,
    ocrProvider: async () => ({ text: OCR, engine: "test-substitute", version: "1" }) };
  let app: App, base: string;
  async function open() {
    app = await createApp(options);
    app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
    const address = app.server.address(); assert.ok(address && typeof address !== "string");
    base = `http://127.0.0.1:${address.port}`;
  }
  await open();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { get app() { return app; }, get base() { return base; }, async restart() { await app.close(); await open(); } };
}

async function request<T>(base: string, path: string, body: unknown, key: string, actor = FINANCE, method = "POST"): Promise<Result<T>> {
  const response = await fetch(`${base}${path}`, { method, headers: {
    "Content-Type": "application/json", "X-Demo-User": actor, "Idempotency-Key": key,
  }, body: JSON.stringify(body) });
  return { status: response.status, body: await response.json() as ApiSuccess<T> | ApiError };
}
async function upload(base: string, key: string, options: {
  bytes?: Uint8Array; actor?: string; invoice?: string; mimeType?: string; fields?: Record<string, string>;
} = {}): Promise<Result<ReceiptUploadedResult>> {
  const form = new FormData();
  form.set("expectedVersion", "1");
  form.set("file", new Blob([new Uint8Array(options.bytes ?? IMAGE)], { type: options.mimeType ?? "image/png" }), "receipt.png");
  for (const [key, value] of Object.entries(options.fields ?? {})) form.set(key, value);
  const response = await fetch(`${base}/api/invoices/${options.invoice ?? INVOICE}/receipts`, {
    method: "POST", headers: { "X-Demo-User": options.actor ?? FINANCE, "Idempotency-Key": key }, body: form,
  });
  return { status: response.status, body: await response.json() as ApiSuccess<ReceiptUploadedResult> | ApiError };
}
function success<T>(result: Result<T>, status = 200): T {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.ok("data" in result.body, JSON.stringify(result.body)); return result.body.data;
}
function rejected(result: Result<unknown>, status: number, code: string) {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.ok("error" in result.body); assert.equal(result.body.error.code, code);
}
function ledger(app: App) {
  return ["invoices", "bankCredits", "payments", "promises", "reminders"].map(kind => app.store.list(kind as "invoices", COMPANY));
}
const replyBody = { expectedVersion: 1, text: "I have paid RM 9000.00 for this invoice.", receivedAt: "2026-10-23T03:00:00Z", language: "en" };

test("reply extraction, manual correction and idempotent restart preserve source and ledger", async t => {
  const f = await fixture(t), before = ledger(f.app);
  const created = success(await request<ReplyCreatedResult>(f.base, `/api/invoices/${INVOICE}/replies`, replyBody, "reply:create-001"), 201).reply;
  assert.deepEqual([created.processingStatus, created.extraction?.intent, created.extraction?.source], ["ready", "paid", "ai"]);
  await f.restart();
  const replay = await request<ReplyCreatedResult>(f.base, `/api/invoices/${INVOICE}/replies`, replyBody, "reply:create-001");
  assert.equal(success(replay, 201).reply.id, created.id);
  assert.ok("data" in replay.body && replay.body.meta.idempotencyReplayed);
  const command = { expectedVersion: created.version, intent: "other", amountSen: null, promisedDate: null, reason: "Customer clarified that no payment was sent." };
  const corrected = success(await request<Reply>(f.base, `/api/replies/${created.id}/extraction`, command, "reply:correct-001", FINANCE, "PATCH"));
  assert.deepEqual([corrected.text, corrected.extraction?.source, corrected.extraction?.reviewedBy, corrected.version], [replyBody.text, "manual", FINANCE, created.version + 1]);
  const partial = success(await request<Reply>(f.base, `/api/replies/${created.id}/extraction`, {
    expectedVersion: corrected.version, intent: "partial", amountSen: 900000, promisedDate: "2026-10-28", reason: "Customer clarified the partial claim and the remaining-payment date.",
  }, "reply:partial-001", FINANCE, "PATCH"));
  assert.deepEqual([partial.extraction?.intent, partial.extraction?.promisedDate, partial.confirmedPromiseId], ["partial", "2026-10-28", null]);
  rejected(await request(f.base, `/api/replies/${created.id}/extraction`, command, "reply:stale-001", FINANCE, "PATCH"), 409, "VERSION_CONFLICT");
  assert.equal(f.app.store.getExtractionRuns(created.id, COMPANY).length, 3);
  assert.deepEqual(ledger(f.app), before);
});

test("receipt upload retains original bytes, local OCR, tenant access and one idempotent image", async t => {
  const f = await fixture(t), before = ledger(f.app);
  const reply = success(await request<ReplyCreatedResult>(f.base, `/api/invoices/${INVOICE}/replies`, replyBody, "receipt:reply-001"), 201).reply;
  const fields = { replyId: reply.id, expectedReplyVersion: String(reply.version) };
  const created = success(await upload(f.base, "receipt:upload-001", { fields })).receipt;
  assert.deepEqual([created.replyId, created.processingStatus, created.mimeType], [reply.id, "ready", "image/png"]);
  const artifact = f.app.store.getReceiptArtifact(created.id, COMPANY)!;
  assert.deepEqual([Buffer.from(artifact.bytes), artifact.ocrText, artifact.ocrEngine], [IMAGE, OCR, "test-substitute"]);
  await f.restart();
  assert.equal(success(await upload(f.base, "receipt:upload-001", { fields })).receipt.id, created.id);
  const duplicate = success(await upload(f.base, "receipt:duplicate-001"));
  assert.deepEqual([duplicate.existing, duplicate.receipt.id, f.app.store.list("receipts", COMPANY).length], [true, created.id, 1]);
  for (const [actor, status] of [["u_lumen_owner", 200], ["u_lumen_pm", 200], ["u_rantau_finance", 404]] as const) {
    const image = await fetch(`${f.base}/api/receipts/${created.id}/image`, { headers: { "X-Demo-User": actor } });
    assert.equal(image.status, status);
    if (status === 200) assert.deepEqual(Buffer.from(await image.arrayBuffer()), IMAGE);
  }
  const match = success(await request<MatchResult>(f.base, `/api/receipts/${created.id}/match`, { expectedVersion: created.version, expectedInvoiceVersion: 1 }, "receipt:match-001"));
  assert.deepEqual([match.verdict, match.status], ["partial", "pending"]);
  assert.deepEqual(ledger(f.app), before);
});

test("unavailable extraction remains recoverable through audited evidence correction", async t => {
  const f = await fixture(t, async () => { throw new Error("test provider unavailable"); }), before = ledger(f.app);
  const uploaded = success(await upload(f.base, "fallback:upload-001"));
  assert.deepEqual([uploaded.receipt.processingStatus, uploaded.receipt.evidence], ["manual_required", null]);
  assert.ok(uploaded.fallbackReason);
  const receipt = uploaded.receipt;
  const corrected = success(await request<Receipt>(f.base, `/api/receipts/${receipt.id}/evidence`, { expectedVersion: receipt.version, ...receiptFields, reason: "Checked all fields against the retained receipt image." }, "fallback:correct-001", FINANCE, "PATCH"));
  assert.deepEqual([corrected.processingStatus, corrected.evidence?.source, corrected.evidence?.reviewedBy, corrected.evidence?.reviewedAt], ["ready", "manual", FINANCE, CLOCK]);
  const match = success(await request<MatchResult>(f.base, `/api/receipts/${receipt.id}/match`, { expectedVersion: corrected.version, expectedInvoiceVersion: 1 }, "fallback:match-001"));
  assert.equal(match.verdict, "partial");
  assert.equal(f.app.store.getExtractionRuns(receipt.id, COMPANY).length, 2);
  assert.deepEqual(ledger(f.app), before);
});

test("HTTP authorization, file content and version guards reject before extraction", async t => {
  let providerCalls = 0;
  const f = await fixture(t, async input => { providerCalls++; return validProvider(input); });
  const initialCounts = [f.app.store.list("receipts", COMPANY).length, f.app.store.list("replies", COMPANY).length];
  const cases: [string, Parameters<typeof upload>[2], number, string][] = [
    ["owner", { actor: "u_lumen_owner" }, 403, "FORBIDDEN"],
    ["pm", { actor: "u_lumen_pm" }, 403, "FORBIDDEN"],
    ["tenant", { actor: "u_rantau_finance" }, 404, "NOT_FOUND"],
    ["stale", { fields: { expectedVersion: "99" } }, 409, "VERSION_CONFLICT"],
    ["false-type", { bytes: Buffer.from("not an image") }, 415, "UNSUPPORTED_MEDIA_TYPE"],
    ["truncated", { bytes: IMAGE.subarray(0, 40) }, 422, "VALIDATION_ERROR"],
    ["oversized", { bytes: new Uint8Array(5 * 1024 * 1024 + 1) }, 413, "PAYLOAD_TOO_LARGE"],
    ["tenant-field", { fields: { companyId: "co_rantau" } }, 422, "VALIDATION_ERROR"],
    ["reply-version", { fields: { replyId: "reply_missing" } }, 422, "VALIDATION_ERROR"],
  ];
  for (const [name, options, status, code] of cases) rejected(await upload(f.base, `guard:${name}-001`, options), status, code);
  for (const [actor, status, code] of [["u_lumen_owner", 403, "FORBIDDEN"], ["u_rantau_finance", 404, "NOT_FOUND"]] as const) {
    rejected(await request(f.base, `/api/invoices/${INVOICE}/replies`, replyBody, `reply:guard-${actor}`, actor), status, code);
  }
  rejected(await request(f.base, `/api/invoices/${INVOICE}/replies`, { ...replyBody, receivedAt: "2026-10-24T00:00:00Z" }, "reply:future-001"), 422, "VALIDATION_ERROR");
  assert.deepEqual([providerCalls, f.app.store.list("receipts", COMPANY).length, f.app.store.list("replies", COMPANY).length], [0, ...initialCounts]);
});
