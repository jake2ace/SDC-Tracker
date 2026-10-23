// Explicitly invoked against a fresh synthetic demo. This changes its ledger.
// Run from the repository root: node tests/integration/hosted-smoke.mjs
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

const base = (process.env.SMOKE_BASE_URL || "http://127.0.0.1:3000").replace(/\/$/, "");
const invoiceId = "inv_lumen_001";
const actor = "u_lumen_finance";
const runId = randomUUID();
const observed = [];
let stage = "start";
const check = (ok, message) => { if (!ok) throw new Error(message); };
const invoice = workspace => workspace.invoices.find(item => item.id === invoiceId);
const ownPayments = workspace => workspace.payments.filter(item => item.invoiceId === invoiceId);

async function request(path, body, user = actor) {
  const multipart = body instanceof FormData;
  const response = await fetch(base + path, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "X-Demo-User": user,
      ...(body === undefined ? {} : { "Idempotency-Key": `hosted-smoke:${runId}:${randomUUID()}` }),
      ...(body === undefined || multipart ? {} : { "Content-Type": "application/json" }),
    },
    body: body === undefined ? undefined : multipart ? body : JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  let result;
  try { result = await response.json(); }
  catch { throw new Error(`HTTP ${response.status}: response was not JSON (${path})`); }
  check(response.ok, `HTTP ${response.status}: ${result.error?.code || "API error"} (${path})`);
  return result.data;
}
const workspace = (user = actor) => request("/api/workspace", undefined, user);
const forecast = (user = actor) => request("/api/forecast?asOfDate=2026-10-23&delayDays=7", undefined, user);
const entries = scenario => scenario.entries.filter(item => item.invoiceId === invoiceId);

async function importFinal() {
  const ws = await workspace();
  const form = new FormData();
  form.set("expectedVersion", String(ws.company.version));
  form.set("file", new Blob([await readFile("data/demo/bank-lumen-final.csv")], { type: "text/csv" }), "bank-lumen-final.csv");
  return request("/api/bank-statements", form);
}

async function recordReceipt(label, expectedVerdict, expectedPaid, expectedDue) {
  stage = `${label}_receipt`;
  const before = invoice(await workspace());
  const form = new FormData();
  form.set("expectedVersion", String(before.version));
  form.set("file", new Blob([await readFile(`data/demo/receipts/lumen-${label}.png`)], { type: "image/png" }), `lumen-${label}.png`);
  const { receipt, fallbackReason } = await request(`/api/invoices/${invoiceId}/receipts`, form);
  const evidence = receipt.evidence;
  const reference = label === "partial" ? "LMN-231026-001" : "LMN-231026-002";
  check(receipt.processingStatus === "ready" && evidence?.source === "ai" && !fallbackReason,
    `Receipt requires review: status=${receipt.processingStatus}, reason=${fallbackReason || "none"}; no manual correction made`);
  check(evidence.amountSen === 900000 && evidence.reference === reference && evidence.payer === "KOPI TIGA TEST",
    "Receipt fields differ from the synthetic image; approval withheld");
  check(evidence.bank === "DEMO SENDER BANK A" && Date.parse(evidence.transferredAt) === Date.parse(label === "partial" ? "2026-10-23T02:30:00Z" : "2026-10-23T03:00:00Z"),
    "Receipt bank/time differs from the synthetic image; approval withheld");
  check(invoice(await workspace()).paidAmountSen === before.paidAmountSen, "Upload unexpectedly recorded a payment");
  const match = await request(`/api/receipts/${receipt.id}/match`, {
    expectedVersion: receipt.version, expectedInvoiceVersion: before.version,
  });
  check(match.verdict === expectedVerdict && match.proposedPaymentAmountSen === 900000,
    `Unexpected match verdict ${match.verdict}; approval withheld`);
  check(invoice(await workspace()).paidAmountSen === before.paidAmountSen, "Bank check unexpectedly recorded a payment");
  const approved = await request(`/api/matches/${match.id}/approve-payment`, { expectedVersion: match.version });
  check(approved.invoice.paidAmountSen === expectedPaid && approved.invoice.outstandingAmountSen === expectedDue,
    "Approved invoice totals are incorrect");
  observed.push({ stage, extraction: "ai", manualCorrections: 0, verdict: match.verdict,
    paidRM: expectedPaid / 100, dueRM: expectedDue / 100 });
  return receipt.id;
}

try {
  stage = "frontend_and_seed";
  const health = await request("/health");
  check(health.status === "ok" && health.database === "ready", "Health or database is not ready");
  const page = await fetch(base + "/", { signal: AbortSignal.timeout(15_000) });
  const html = await page.text();
  const asset = html.match(/<script[^>]+src="([^"]+)"/);
  check(page.ok && html.includes('id="root"') && asset, "Built frontend is not served from the API origin");
  const assetResponse = await fetch(new URL(asset[1], base), { signal: AbortSignal.timeout(15_000) });
  check(assetResponse.ok && /javascript/.test(assetResponse.headers.get("content-type") || ""), "Frontend JavaScript asset is unavailable");
  const initial = await workspace();
  const first = invoice(initial);
  check(first && first.totalAmountSen === 1800000 && first.paidAmountSen === 0 && first.outstandingAmountSen === 1800000,
    "Fresh seed required: LUMEN-DEMO-001 must be RM18,000 due and RM0 paid");
  check(ownPayments(initial).length === 0 && !initial.bankCredits.some(item => item.reference === "LMN-231026-002"),
    "Fresh seed required: previous payment or final bank credit exists");
  observed.push({ stage, health: "ok", frontendAsset: "served", seed: "fresh" });

  stage = "reminder_ai";
  const reminder = await request(`/api/invoices/${invoiceId}/reminders`, { expectedVersion: first.version, language: "en" });
  check(reminder.generationMode === "ai" && reminder.status === "draft", `Reminder mode was ${reminder.generationMode}; real AI required`);
  check(/18,?000(?:\.00)?/.test(reminder.draftText), "Reminder does not contain the outstanding amount");
  const sent = await request(`/api/reminders/${reminder.id}/send`, {
    expectedVersion: reminder.version, expectedInvoiceVersion: invoice(await workspace()).version, text: reminder.draftText,
  });
  check(sent.status === "sent_simulated", "Simulated reminder send was not recorded");
  observed.push({ stage, generation: "ai", send: "simulated", noExternalMessage: true });

  const partialReceiptId = await recordReceipt("partial", "partial", 900000, 900000);
  stage = "promise_ai_and_forecast";
  const partial = invoice(await workspace());
  check(partial.collectionStatus === "active", "Partial payment stopped collections unexpectedly");
  const { reply, fallbackReason } = await request(`/api/invoices/${invoiceId}/replies`, {
    expectedVersion: partial.version, text: "I will pay the remaining RM9,000 on 28 October 2026.",
    receivedAt: "2026-10-23T04:00:00Z", language: "en",
  });
  check(reply.processingStatus === "ready" && reply.extraction?.source === "ai" && !fallbackReason,
    `Reply requires review: status=${reply.processingStatus}, reason=${fallbackReason || "none"}`);
  check(reply.extraction.intent === "promise" && reply.extraction.amountSen === 900000 && reply.extraction.promisedDate === "2026-10-28",
    "Reply extraction did not match the explicit promise");
  await request(`/api/replies/${reply.id}/confirm-promise`, {
    expectedVersion: reply.version, expectedInvoiceVersion: invoice(await workspace()).version,
    promisedDate: "2026-10-28", amountSen: 900000,
  });
  const promised = invoice(await workspace());
  check(promised.paidAmountSen === 900000 && promised.outstandingAmountSen === 900000 && promised.dueDate === first.dueDate,
    "Promise changed actual payment or original due date");
  const projected = await forecast();
  for (const scenario of projected.scenarios) {
    const own = entries(scenario);
    const actual = own.filter(item => item.kind === "actual_payment");
    const expected = own.filter(item => item.kind === "expected_receipt");
    check(actual.length === 1 && actual[0].amountSen === 900000 && actual[0].date === "2026-10-23", "Actual payment moved in the forecast");
    check(expected.length === 1 && expected[0].amountSen === 900000 && expected[0].date === (scenario.kind === "on_time" ? "2026-10-28" : "2026-11-04"),
      `Promise forecast is incorrect for ${scenario.kind}`);
  }
  observed.push({ stage, extraction: "ai", onTime: "2026-10-28", sevenDaysLate: "2026-11-04", actualPaidRM: 9000 });

  stage = "final_bank_import";
  const imported = await importFinal();
  check(imported.insertedCount === 1 && imported.duplicateCount === 0, "Final bank credit was not newly imported");
  check(invoice(await workspace()).paidAmountSen === 900000, "Bank import unexpectedly recorded a payment");
  observed.push({ stage, inserted: 1, noAutomaticPayment: true });
  await recordReceipt("final", "confirmed", 1800000, 0);

  stage = "settled_and_duplicate";
  const settled = await workspace();
  check(invoice(settled).status === "paid" && invoice(settled).collectionStatus === "stopped" && ownPayments(settled).length === 2,
    "Final payment did not settle exactly twice and stop collections");
  for (const scenario of (await forecast()).scenarios) {
    const own = entries(scenario);
    check(own.length === 2 && own.every(item => item.kind === "actual_payment" && item.amountSen === 900000),
      "Settled invoice still has expected cash or incorrect actual payments");
  }
  const duplicate = await importFinal();
  check(duplicate.insertedCount === 0 && duplicate.duplicateCount === 1 && ownPayments(await workspace()).length === 2,
    "Duplicate CSV created another credit or payment");
  observed.push({ stage, paidRM: 18000, dueRM: 0, payments: 2, collection: "stopped", duplicateNewCredits: 0 });

  stage = "company_isolation";
  const other = await workspace("u_rantau_finance");
  check(!invoice(other) && other.payments.every(item => item.companyId === "co_rantau"), "Rantau workspace contains Lumen data");
  for (const scenario of (await forecast("u_rantau_finance")).scenarios) check(entries(scenario).length === 0, "Rantau forecast contains Lumen entries");
  const denied = await fetch(`${base}/api/receipts/${partialReceiptId}/image`, {
    headers: { "X-Demo-User": "u_rantau_finance" }, signal: AbortSignal.timeout(15_000),
  });
  check(denied.status === 404, `Other company could access receipt image: HTTP ${denied.status}`);
  const reloaded = invoice(await workspace());
  check(reloaded.paidAmountSen === 1800000 && reloaded.outstandingAmountSen === 0, "Reloaded settlement differs");
  observed.push({ stage, workspace: "isolated", forecast: "isolated", image: "404", reload: "settled" });
  console.log(JSON.stringify({ status: "passed", verifiedAiOutputs: 4, manualCorrections: 0, observed }));
} catch (error) {
  console.log(JSON.stringify({ status: "failed", stage, message: error instanceof Error ? error.message : "Unknown smoke failure", observed }));
  process.exitCode = 1;
}
