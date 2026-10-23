import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { MatcherInput, MatchReason, MatchVerdict } from "../contracts/domain.ts";
import { matchReceipt } from "../src/matcher.ts";

const inputs = JSON.parse(readFileSync(new URL("../data/eval/matcher.inputs.json", import.meta.url), "utf8")) as {
  samples: { id: string; input: MatcherInput }[];
};
const gold = JSON.parse(readFileSync(new URL("../data/eval/matcher.gold.json", import.meta.url), "utf8")) as {
  labels: { id: string; scenario: string; expectedVerdict: MatchVerdict; requiredReasons: MatchReason[];
    eligibleCreditId: string | null; proposedPaymentAmountSen: number | null;
    proposedOutstandingAmountSen: number | null; eligibleForFinanceApproval: boolean }[];
};

test("all 30 frozen matcher cases satisfy separate gold decisions without changing input", () => {
  assert.equal(inputs.samples.length, 30);
  assert.equal(gold.labels.length, 30);
  assert.equal(new Set(inputs.samples.map(sample => sample.id)).size, 30);
  assert.deepEqual(inputs.samples.map(sample => sample.id).sort(), gold.labels.map(label => label.id).sort());
  for (const sample of inputs.samples) {
    const expected = gold.labels.find(label => label.id === sample.id)!;
    const before = structuredClone(sample.input);
    const actual = matchReceipt(sample.input);
    const message = `${sample.id}: ${expected.scenario}`;
    assert.equal(actual.verdict, expected.expectedVerdict, message);
    for (const reason of expected.requiredReasons) assert.ok(actual.reasons.includes(reason), `${message}: ${reason}`);
    assert.equal(actual.eligibleCreditId, expected.eligibleCreditId, message);
    assert.equal(actual.proposedPaymentAmountSen, expected.proposedPaymentAmountSen, message);
    assert.equal(actual.proposedOutstandingAmountSen, expected.proposedOutstandingAmountSen, message);
    assert.equal(actual.eligibleCreditId !== null, expected.eligibleForFinanceApproval, message);
    assert.deepEqual(sample.input, before, `${message}: input mutated`);
    assert.deepEqual(matchReceipt(structuredClone(before)), actual, `${message}: nondeterministic decision`);
  }
});

test("malformed internal evidence and relationships cannot become approval candidates", () => {
  const mutations: [string, (input: MatcherInput) => void][] = [
    ["foreign invoice", input => { input.invoice.companyId = "co_rantau"; }],
    ["foreign customer", input => { input.customer.companyId = "co_rantau"; }],
    ["wrong customer relationship", input => { input.invoice.customerId = "missing_customer"; }],
    ["wrong receipt relationship", input => { input.receipt.invoiceId = "missing_invoice"; }],
    ["unsafe amount", input => { input.receipt.evidence!.amountSen = Number.MAX_SAFE_INTEGER + 1; }],
    ["fractional amount", input => { input.receipt.evidence!.amountSen = 1.5; }],
    ["invalid calendar date", input => { input.receipt.evidence!.transferredAt = "2026-02-30T02:30:00Z"; }],
    ["non-finite confidence", input => { input.receipt.evidence!.confidence = Number.NaN; }],
    ["inconsistent balance", input => { input.invoice.outstandingAmountSen -= 1; }],
    ["unreviewed manual evidence", input => { input.receipt.evidence!.source = "manual"; input.receipt.evidence!.confidence = null; }],
    ["impossible bank date", input => { input.bankCredits[0]!.postedDate = "2026-02-30"; }],
  ];
  for (const [name, mutate] of mutations) {
    const input = structuredClone(inputs.samples[0]!.input);
    mutate(input);
    const actual = matchReceipt(input);
    assert.equal(actual.eligibleCreditId, null, name);
    assert.equal(actual.proposedPaymentAmountSen, null, name);
    assert.equal(actual.proposedOutstandingAmountSen, null, name);
    assert.ok(actual.verdict !== "confirmed" && actual.verdict !== "partial", name);
  }
  assert.equal(matchReceipt(null as unknown as MatcherInput).verdict, "needs_review");
});

test("reference conflicts stay ambiguous, self receipts are ignored and foreign evidence cannot match", () => {
  const input = structuredClone(inputs.samples[0]!.input);
  input.existingReceipts = [structuredClone(input.receipt)];
  assert.equal(matchReceipt(input).verdict, "confirmed", "same receipt must not duplicate itself");
  const foreign = structuredClone(input.bankCredits[0]!);
  foreign.id = "foreign_credit";
  foreign.companyId = "co_rantau";
  input.bankCredits = [foreign];
  const foreignResult = matchReceipt(input);
  assert.equal(foreignResult.eligibleCreditId, null);
  assert.ok(!foreignResult.candidateCreditIds.includes(foreign.id));
  input.bankCredits = structuredClone(inputs.samples[0]!.input.bankCredits);
  for (const change of [{ payer: "SOMEONE ELSE" }, { postedDate: "2026-10-01" }]) {
    const conflict = { ...structuredClone(input.bankCredits[0]!), id: "conflicting_credit", ...change };
    const actual = matchReceipt({ ...input, bankCredits: [...input.bankCredits, conflict] });
    assert.equal(actual.verdict, "needs_review");
    assert.ok(actual.reasons.includes("multiple_candidates"));
    assert.equal(actual.eligibleCreditId, null);
  }
});
