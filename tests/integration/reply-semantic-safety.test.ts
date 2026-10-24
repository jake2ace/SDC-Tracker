import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.ts";
import { extractReply } from "../../src/extraction.ts";
import type { ExtractionProvider } from "../../src/extraction-provider.ts";
import type { ApiError, ApiSuccess, PromiseConfirmedResult, ReplyCreatedResult } from "../../contracts/api.ts";
import type { AiInput, AiReplyOutput, Forecast, Invoice, Language, Reply } from "../../contracts/domain.ts";

const COMPANY = "co_lumen", FINANCE = "u_lumen_finance", INVOICE = "inv_lumen_001";
const CLOCK = "2026-10-23T04:00:00Z", RECEIVED = "2026-10-23T03:00:00Z";
const AMOUNT = 1_800_000, DATE = "2026-10-28";
// Deliberately overconfident test output: server-side checks must survive a model error.
const promise: AiReplyOutput = { intent: "promise", amountSen: AMOUNT, promisedDate: DATE, confidence: 0.99 };
const paid: AiReplyOutput = { intent: "paid", amountSen: AMOUNT, promisedDate: null, confidence: 0.99 };

async function capturedExtraction(text: string, language: Language, output = promise) {
  let captured: AiInput | undefined;
  const result = await extractReply(text, RECEIVED, language, async input => {
    captured = input;
    return output;
  });
  assert.ok(captured, "The test provider should receive the projected source.");
  return { ...result, input: captured };
}

test("reply projection preserves Chinese negation instead of creating an affirmative promise", async () => {
  const result = await capturedExtraction("我不承诺在2026年10月28日支付RM 18000。", "zh");
  assert.match(result.input.redactedText, /不承诺/);
  assert.doesNotMatch(result.input.redactedText, /我承诺/);
  assert.equal(result.processingStatus, "needs_review");
  assert.ok(result.fallbackReason);
  const unpaid = await capturedExtraction("我未付款RM 18000。", "zh", paid);
  assert.match(unpaid.input.redactedText, /未付款/);
  assert.equal(unpaid.processingStatus, "needs_review");
});

test("English contractions retain explicit negation in the provider input", async () => {
  for (const contraction of ["can't", "can’t", "won't", "won’t", "haven't", "haven’t", "didn't"]) {
    const result = await capturedExtraction(`I ${contraction} pay RM 18000 on 28 October 2026.`, "en");
    assert.match(result.input.redactedText, /\b(?:not|cannot)\b/, contraction);
    assert.equal(result.processingStatus, "needs_review", contraction);
    assert.ok(result.fallbackReason, contraction);
  }
});

test("negative and conditional replies require review despite high-confidence financial claims", async () => {
  const cases: { text: string; language: Language; output?: AiReplyOutput }[] = [
    { text: "I will not pay RM 18000 on 28 October 2026.", language: "en" },
    { text: "I have not paid RM 18000.", language: "en", output: paid },
    { text: "I will pay RM 18000 on 28 October 2026 if the work is completed.", language: "en" },
    { text: "I will pay RM 18000 on 28 October 2026 unless the invoice is wrong.", language: "en" },
    { text: "如果工作完成，我承诺在2026年10月28日支付RM 18000。", language: "zh" },
    { text: "只有工作完成，我才在2026年10月28日支付RM 18000。", language: "zh" },
    { text: "Saya tidak akan bayar RM 18000 pada 28 Oktober 2026.", language: "ms" },
    { text: "Saya belum bayar RM 18000.", language: "ms", output: paid },
    { text: "Saya akan bayar RM 18000 pada 28 Oktober 2026 jika kerja siap.", language: "ms" },
    { text: "Saya akan bayar RM 18000 pada 28 Oktober 2026 kalau kerja siap.", language: "ms" },
  ];
  for (const example of cases) {
    const result = await capturedExtraction(example.text, example.language, example.output ?? promise);
    assert.equal(result.processingStatus, "needs_review", example.text);
    assert.ok(result.fallbackReason, example.text);
  }
});

test("unknown Chinese spans stay visibly redacted and private details never reach the provider", async () => {
  const chinese = await capturedExtraction("我霁岚承诺在2026年10月28日支付RM 18000。", "zh");
  assert.match(chinese.input.redactedText, /我\s*\[REDACTED\]\s*承诺/);
  assert.doesNotMatch(chinese.input.redactedText, /霁岚|我承诺/);
  assert.equal(chinese.processingStatus, "needs_review");
  const personal = await capturedExtraction(
    "Zorvella Qixun, zorvella.qixun@example.test, +60 12-345 6789, 42 Jalan Nebulark. I will pay RM 18000 on 28 October 2026.",
    "en",
  );
  assert.match(personal.input.redactedText, /\[REDACTED\]/);
  assert.doesNotMatch(personal.input.redactedText, /Zorvella|Qixun|example|Nebulark|12-345|6789|\+60|42/i);
  assert.match(personal.input.redactedText, /RM 18000/);
  assert.match(personal.input.redactedText, /28 October 2026/);
  assert.equal(personal.processingStatus, "needs_review");
});

test("clear affirmative promises with explicit amount and date remain usable in all three languages", async () => {
  const cases: [Language, string][] = [
    ["en", "I will pay RM 18000 on 28 October 2026."],
    ["zh", "我承诺在2026年10月28日支付RM 18000。"],
    ["ms", "Saya akan bayar RM 18000 pada 28 Oktober 2026."],
  ];
  for (const [language, text] of cases) {
    const result = await capturedExtraction(text, language);
    assert.equal(result.processingStatus, "ready", text);
    assert.equal(result.fallbackReason, null, text);
    assert.doesNotMatch(result.input.redactedText, /\[REDACTED\]/, text);
    assert.equal(result.extraction?.amountSen, AMOUNT);
    assert.equal(result.extraction?.promisedDate, DATE);
  }
});

test("the month May does not become an uncertain commitment while modal may still requires review", async () => {
  const output = { ...promise, promisedDate: "2027-05-28" };
  for (const [language, text] of [
    ["en", "I will pay RM 18000 on 28 May 2027."],
    ["ms", "Saya akan bayar RM 18000 pada 28 Mei 2027."],
  ] as const) {
    const result = await capturedExtraction(text, language, output);
    assert.equal(result.processingStatus, "ready", text);
    assert.equal(result.fallbackReason, null, text);
    assert.equal(result.extraction?.promisedDate, "2027-05-28");
  }
  const uncertain = await capturedExtraction("I may pay RM 18000 on 28 May 2027.", "en", output);
  assert.equal(uncertain.processingStatus, "needs_review");
  assert.ok(uncertain.fallbackReason);
});

type App = Awaited<ReturnType<typeof createApp>>;
type Fixture = Awaited<ReturnType<typeof fixture>>;
type Response<T> = { status: number; body: ApiSuccess<T> | ApiError };

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-reply-semantics-"));
  const extractionProvider: ExtractionProvider = async () => promise;
  const unavailable = async (): Promise<never> => { throw new Error("No external providers in semantic safety tests."); };
  const options = { dbPath: join(directory, "demo.sqlite"), clock: CLOCK, extractionProvider,
    reminderProvider: unavailable, ocrProvider: unavailable };
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

async function request<T>(f: Fixture, path: string, body?: unknown, key = "", method?: string): Promise<Response<T>> {
  const response = await fetch(`${f.base}${path}`, {
    method: method ?? (body === undefined ? "GET" : "POST"),
    headers: { "X-Demo-User": FINANCE, ...(key ? { "Idempotency-Key": key } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as ApiSuccess<T> | ApiError };
}

function success<T>(result: Response<T>, status = 200): T {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.ok("data" in result.body, JSON.stringify(result.body));
  return result.body.data;
}

function invoice(f: Fixture): Invoice { return f.app.store.get<Invoice>("invoices", INVOICE, COMPANY)!; }
async function forecast(f: Fixture) {
  return success(await request<Forecast>(f, "/api/forecast?asOfDate=2026-10-23&delayDays=7"));
}
async function financialState(f: Fixture) {
  return { invoice: invoice(f), promises: f.app.store.list("promises", COMPANY),
    payments: f.app.store.list("payments", COMPANY), forecast: await forecast(f) };
}
async function createReply(f: Fixture, text: string, language: Language, key: string) {
  return success(await request<ReplyCreatedResult>(f, `/api/invoices/${INVOICE}/replies`, {
    expectedVersion: invoice(f).version, text, receivedAt: RECEIVED, language,
  }, `${key}:create`), 201);
}
async function confirm(f: Fixture, reply: Reply, key: string) {
  return request<PromiseConfirmedResult>(f, `/api/replies/${reply.id}/confirm-promise`, {
    expectedVersion: reply.version, expectedInvoiceVersion: invoice(f).version,
    promisedDate: DATE, amountSen: AMOUNT,
  }, `${key}:confirm`);
}
function reviewRequired(result: Response<unknown>) {
  assert.equal(result.status, 422, JSON.stringify(result.body));
  assert.ok("error" in result.body);
  assert.equal(result.body.error.code, "REVIEW_REQUIRED");
}

test("quarantined replies cannot create promises, payments or forecast changes through HTTP", async t => {
  const f = await fixture(t);
  const before = await financialState(f);
  const cases: [Language, string][] = [
    ["zh", "我不承诺在2026年10月28日支付RM 18000。"],
    ["en", "I can't pay RM 18000 on 28 October 2026."],
    ["ms", "Saya akan bayar RM 18000 pada 28 Oktober 2026 jika kerja siap."],
  ];
  for (const [index, [language, text]] of cases.entries()) {
    const created = await createReply(f, text, language, `blocked:${index}`);
    assert.equal(created.reply.processingStatus, "needs_review");
    assert.ok(created.fallbackReason);
    reviewRequired(await confirm(f, created.reply, `blocked:${index}`));
    assert.equal(f.app.store.get<Reply>("replies", created.reply.id, COMPANY)?.confirmedPromiseId, null);
    assert.deepEqual(await financialState(f), before);
  }
});

test("legacy AI-ready unsafe replies are rechecked at confirmation after a database restart", async t => {
  const f = await fixture(t);
  const before = await financialState(f);
  const cases: [Language, string][] = [
    ["zh", "我不承诺在2026年10月28日支付RM 18000。"],
    ["en", "I will pay RM 18000 on 28 October 2026 unless the invoice is wrong."],
    ["zh", "我霁岚承诺在2026年10月28日支付RM 18000。"],
  ];
  const legacy: Reply[] = [];
  for (const [index, [language, text]] of cases.entries()) {
    const created = await createReply(f, text, language, `legacy:${index}`);
    const reply: Reply = { ...created.reply, processingStatus: "ready",
      extraction: { ...promise, source: "ai", reviewedBy: null, reviewedAt: null } };
    f.app.store.put("replies", reply);
    legacy.push(reply);
  }
  await f.restart();
  for (const [index, reply] of legacy.entries()) {
    assert.equal(f.app.store.get<Reply>("replies", reply.id, COMPANY)?.processingStatus, "ready");
    reviewRequired(await confirm(f, reply, `legacy:${index}`));
    assert.deepEqual(await financialState(f), before);
  }
});

test("audited Finance correction can resolve an unsafe reply without recording a payment", async t => {
  const f = await fixture(t);
  const before = await financialState(f);
  const created = await createReply(f, "我不承诺在2026年10月28日支付RM 18000。", "zh", "manual");
  reviewRequired(await confirm(f, created.reply, "manual:before-review"));
  const corrected = success(await request<Reply>(f, `/api/replies/${created.reply.id}/extraction`, {
    expectedVersion: created.reply.version, intent: "promise", amountSen: AMOUNT, promisedDate: DATE,
    reason: "Finance checked the original negation and obtained a subsequent explicit whole-balance commitment from the customer.",
  }, "manual:correct", "PATCH"));
  assert.equal(corrected.processingStatus, "ready");
  assert.deepEqual([corrected.extraction?.source, corrected.extraction?.reviewedBy, corrected.extraction?.reviewedAt,
    corrected.extraction?.confidence], ["manual", FINANCE, CLOCK, null]);
  assert.equal(corrected.text, created.reply.text, "Original evidence must remain available for review.");
  const confirmed = success(await confirm(f, corrected, "manual:after-review"));
  assert.equal(confirmed.promise.promisedDate, DATE);
  assert.equal(confirmed.promise.amountSen, AMOUNT);
  assert.equal(confirmed.promise.confirmedBy, FINANCE);
  assert.deepEqual(f.app.store.list("payments", COMPANY), before.payments);
  assert.equal(invoice(f).paidAmountSen, before.invoice.paidAmountSen);
  assert.equal(invoice(f).outstandingAmountSen, before.invoice.outstandingAmountSen);
  const after = await forecast(f);
  const onTime = after.scenarios.find(scenario => scenario.kind === "on_time");
  assert.ok(onTime?.entries.some(entry => entry.invoiceId === INVOICE && entry.kind === "expected_receipt"
    && entry.date === DATE && entry.amountSen === AMOUNT));
});

test("a clear AI-extracted affirmative promise remains confirmable without a manual correction", async t => {
  const f = await fixture(t);
  const before = await financialState(f);
  const created = await createReply(f, "I will pay RM 18000 on 28 October 2026.", "en", "affirmative");
  assert.equal(created.reply.processingStatus, "ready");
  const confirmed = success(await confirm(f, created.reply, "affirmative"));
  assert.equal(confirmed.promise.promisedDate, DATE);
  assert.equal(confirmed.promise.amountSen, AMOUNT);
  assert.equal(confirmed.reply.confirmedPromiseId, confirmed.promise.id);
  assert.deepEqual(f.app.store.list("payments", COMPANY), before.payments);
  assert.equal(invoice(f).paidAmountSen, before.invoice.paidAmountSen);
});
