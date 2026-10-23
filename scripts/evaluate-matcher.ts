import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { MatcherInput, MatchReason, MatchVerdict } from "../contracts/domain.ts";
import { matchReceipt } from "../src/matcher.ts";

const inputText = readFileSync(new URL("../data/eval/matcher.inputs.json", import.meta.url), "utf8");
const goldText = readFileSync(new URL("../data/eval/matcher.gold.json", import.meta.url), "utf8");
const inputs = JSON.parse(inputText) as { samples: { id: string; input: MatcherInput }[] };
const gold = JSON.parse(goldText) as { labels: { id: string; expectedVerdict: MatchVerdict;
  requiredReasons: MatchReason[]; eligibleCreditId: string | null; proposedPaymentAmountSen: number | null;
  proposedOutstandingAmountSen: number | null; eligibleForFinanceApproval: boolean }[] };
if (inputs.samples.length !== 30 || gold.labels.length !== 30 ||
  new Set(inputs.samples.map(sample => sample.id)).size !== 30 ||
  new Set(gold.labels.map(label => label.id)).size !== 30) throw new Error("Expected 30 unique frozen matcher cases and labels");
const results = inputs.samples.map(sample => {
  const label = gold.labels.find(value => value.id === sample.id);
  if (!label) throw new Error(`Missing label for ${sample.id}`);
  const before = JSON.stringify(sample.input);
  const actual = matchReceipt(sample.input);
  const deterministic = JSON.stringify(actual) === JSON.stringify(matchReceipt(structuredClone(sample.input)));
  const unchanged = before === JSON.stringify(sample.input);
  const reasonsPresent = label.requiredReasons.every(reason => actual.reasons.includes(reason));
  const verdictCorrect = actual.verdict === label.expectedVerdict;
  const amountsCorrect = actual.eligibleCreditId === label.eligibleCreditId &&
    actual.proposedPaymentAmountSen === label.proposedPaymentAmountSen &&
    actual.proposedOutstandingAmountSen === label.proposedOutstandingAmountSen;
  const unsafeApprovalCandidate = !label.eligibleForFinanceApproval && actual.eligibleCreditId !== null;
  return { id: sample.id, expectedVerdict: label.expectedVerdict, actualVerdict: actual.verdict,
    verdictCorrect, reasonsPresent, amountsCorrect, deterministic, unchanged, unsafeApprovalCandidate,
    passed: verdictCorrect && reasonsPresent && amountsCorrect && deterministic && unchanged && !unsafeApprovalCandidate };
});
const passed = results.filter(result => result.passed).length;
const report = {
  evaluation: "deterministic-matcher-frozen-synthetic-cases",
  evaluatedAt: new Date().toISOString(),
  runtime: process.version,
  inputSha256: createHash("sha256").update(inputText).digest("hex"),
  goldSha256: createHash("sha256").update(goldText).digest("hex"),
  sourceSha256: Object.fromEntries(["matcher.ts", "normalization.ts"].map(name => [name,
    createHash("sha256").update(readFileSync(new URL(`../src/${name}`, import.meta.url))).digest("hex")])),
  sampleCount: results.length,
  passed,
  failed: results.length - passed,
  verdictAccuracy: results.filter(result => result.verdictCorrect).length / results.length,
  unsafeApprovalCandidates: results.filter(result => result.unsafeApprovalCandidate).length,
  scope: "Pure matcher only. Synthetic evidence; no actual bank connection, OCR, model call, payment posting or production accuracy measurement.",
  results,
};
console.log(JSON.stringify(report, null, 2));
if (passed !== results.length) process.exitCode = 1;
