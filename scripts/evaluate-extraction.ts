import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import type { Language } from "../contracts/domain.ts";
import { extractReceipt, extractReply } from "../src/extraction.ts";
import { createExtractionProvider, type ExtractionProvider } from "../src/extraction-provider.ts";
import { createLocalOcrProvider, validateReceiptImage } from "../src/receipt-image.ts";

const root = new URL("../", import.meta.url);
const mode = process.argv.find(arg => arg.startsWith("--provider="))?.slice(11) ?? "deepseek";
if (!["deepseek", "unavailable"].includes(mode)) throw new Error("Use --provider=deepseek or --provider=unavailable.");
const envFile = process.argv.find(arg => arg.startsWith("--env-file="))?.slice(11);
if (envFile) process.loadEnvFile(envFile);
if (mode === "deepseek" && (!process.env.DEEPSEEK_API_KEY || !process.env.DEEPSEEK_MODEL)) {
  throw new Error("Real evaluation requires DEEPSEEK_API_KEY and DEEPSEEK_MODEL. No substitute is used.");
}
const sha256 = (value: Uint8Array) => createHash("sha256").update(value).digest("hex");
async function json<T>(path: string): Promise<T> { return JSON.parse(await readFile(new URL(path, root), "utf8")) as T; }
type ReceiptSample = { id: string; imagePath: string; sha256: string; layoutId: string; variant: string };
type Evidence = { bank: string; amountSen: number; reference: string; transferredAt: string; payer: string };
type ReplySample = { id: string; text: string; receivedAt: string; language: Language };
const generated = await json<{ samples: ReceiptSample[] }>("data/eval/receipts.generated.json");
const replies = await json<{ samples: ReplySample[]; confidenceGuardProbes: { id: string; replyId: string; syntheticInjectedExtraction: Record<string, unknown> }[] }>("data/eval/replies.inputs.json");
// Gold is confined to this offline scorer. Never pass a label to an extraction provider.
const receiptGold = await json<{ metadata: { asOf: string }; labels: { id: string; evidence: Evidence }[] }>("data/eval/receipts.gold.json");
const replyGold = await json<{ labels: { id: string; expectedIntent: string; expectedAmountSen: number | null; expectedPromisedDate: string | null; requiresExtractionReview: boolean }[];
  confidenceGuardExpectations: { id: string; requiresExtractionReview: boolean }[] }>("data/eval/replies.gold.json");
if (generated.samples.length !== 40 || receiptGold.labels.length !== 40 || replies.samples.length !== 40 || replyGold.labels.length !== 40
  || [generated.samples, receiptGold.labels, replies.samples, replyGold.labels].some(items => new Set(items.map(item => item.id)).size !== 40)) {
  throw new Error("Expected 40 unique receipt samples/labels and 40 unique reply samples/labels.");
}
const provider: ExtractionProvider = mode === "deepseek" ? createExtractionProvider({
  apiKey: process.env.DEEPSEEK_API_KEY, baseUrl: process.env.DEEPSEEK_BASE_URL, model: process.env.DEEPSEEK_MODEL, timeoutMs: 30000,
}) : async () => { throw new Error("intentional_provider_unavailable"); };
const ocr = createLocalOcrProvider();
const startedAt = new Date().toISOString();
const hashedPaths = ["data/eval/receipts.manifest.json", "data/eval/receipts.generated.json", "data/eval/receipts.gold.json", "data/eval/replies.inputs.json", "data/eval/replies.gold.json", "src/extraction.ts", "src/extraction-provider.ts", "src/receipt-image.ts", "src/receipt-ocr-worker.mjs", "scripts/evaluate-extraction.ts"];
const inputs: Record<string, string> = {};
for (const path of hashedPaths) inputs[path] = sha256(await readFile(new URL(path, root)));

async function parallel<T, R>(items: T[], action: (item: T) => Promise<R>, limit: number): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const index = next++; results[index] = await action(items[index]!); }
  }));
  return results;
}

const receiptResults = await parallel(generated.samples, async sample => {
  const expected = receiptGold.labels.find(label => label.id === sample.id)!.evidence;
  const bytes = await readFile(new URL(`data/eval/${sample.imagePath}`, root));
  if (sha256(bytes) !== sample.sha256) throw new Error(`Fixture hash changed: ${sample.id}`);
  const started = performance.now();
  const duration = () => Math.round((performance.now() - started) * 100) / 100;
  let validatedAt: number | null = null;
  let ocrCompletedAt: number | null = null;
  try {
    const image = await validateReceiptImage(bytes);
    validatedAt = duration();
    const ocrResult = await ocr(image);
    ocrCompletedAt = duration();
    const result = await extractReceipt(ocrResult.text, receiptGold.metadata.asOf, provider);
    const completedAt = duration();
    const actual = result.evidence;
    return { id: sample.id, layoutId: sample.layoutId, variant: sample.variant, imageSha256: sample.sha256,
      ocr: ocrResult, result, expected, exact: {
        amount: actual?.amountSen === expected.amountSen, reference: actual?.reference === expected.reference,
        transferTime: actual?.transferredAt != null && Date.parse(actual.transferredAt) === Date.parse(expected.transferredAt), bank: actual?.bank === expected.bank, payer: actual?.payer === expected.payer,
      }, failure: null, timingMs: { validation: validatedAt, ocr: Math.round((ocrCompletedAt - validatedAt) * 100) / 100,
        extraction: Math.round((completedAt - ocrCompletedAt) * 100) / 100, total: completedAt } };
  } catch {
    // Error bodies may contain provider data; the public report keeps only a stable category.
    return { id: sample.id, layoutId: sample.layoutId, variant: sample.variant, imageSha256: sample.sha256,
      ocr: null, result: null, expected, exact: { amount: false, reference: false, transferTime: false, bank: false, payer: false }, failure: "ocr_or_extraction_failed",
      timingMs: { validation: validatedAt, ocr: ocrCompletedAt === null || validatedAt === null ? null : Math.round((ocrCompletedAt - validatedAt) * 100) / 100,
        extraction: null, total: duration() } };
  }
}, 2);
const replyResults = await parallel(replies.samples, async sample => {
  const expected = replyGold.labels.find(label => label.id === sample.id)!;
  const started = performance.now();
  const result = await extractReply(sample.text, sample.receivedAt, sample.language, provider);
  const actual = result.extraction;
  return { id: sample.id, language: sample.language, receivedAt: sample.receivedAt, text: sample.text,
    result, expected, exact: { intent: actual?.intent === expected.expectedIntent, amount: actual?.amountSen === expected.expectedAmountSen,
      promisedDate: actual?.promisedDate === expected.expectedPromisedDate },
    requiredReviewRespected: !expected.requiresExtractionReview || result.processingStatus !== "ready",
    timingMs: Math.round((performance.now() - started) * 100) / 100 };
}, 4);
const guards = await parallel(replies.confidenceGuardProbes, async probe => {
  const sample = replies.samples.find(sample => sample.id === probe.replyId)!;
  const expected = replyGold.confidenceGuardExpectations.find(item => item.id === probe.id)!;
  const { intent, promisedDate, amountSen, confidence } = probe.syntheticInjectedExtraction;
  const result = await extractReply(sample.text, sample.receivedAt, sample.language, async () => ({ intent, promisedDate, amountSen, confidence }));
  const requiresReview = result.processingStatus !== "ready";
  return { id: probe.id, mode: "injected_output_guard_test", result, expectedReview: expected.requiresExtractionReview,
    passed: requiresReview === expected.requiresExtractionReview };
}, 2);
const count = <T>(items: T[], predicate: (item: T) => boolean) => items.filter(predicate).length;
const timings = receiptResults.map(item => item.timingMs.total).sort((a, b) => a - b);
const changedDuringRun: string[] = [];
for (const path of hashedPaths) if (inputs[path] !== sha256(await readFile(new URL(path, root)))) changedDuringRun.push(path);
const report = {
  metadata: { startedAt, completedAt: new Date().toISOString(), nodeVersion: process.version, mode, synthetic: true,
    model: mode === "deepseek" ? process.env.DEEPSEEK_MODEL : null, frozenAsOf: receiptGold.metadata.asOf, hashes: inputs, changedDuringRun,
    scope: "Local OCR on all 40 generated synthetic receipts and extraction on all 40 frozen replies. Gold is used only by generation/scoring; production extraction never receives gold.",
    timing: { clock: "performance.now monotonic milliseconds", receiptStart: "image bytes loaded and hash verified, immediately before validation",
      receiptEnd: "validated extraction result returned, before scoring/report serialization", concurrency: { receipts: 2, replies: 4 },
      includesHumanInteraction: false, includesBrowserUpload: false, manualBaseline: null },
    providerCost: { reported: false, amount: null, currency: null, reason: "The adapter does not expose billed usage or provider cost; no cost is inferred." },
    limitations: ["Synthetic fixtures do not establish real-bank or production accuracy.", "Transfer time exactness compares UTC instants, allowing equivalent .000Z serialization.", "Frozen asOf is retained; future receipt timestamps may correctly require review.", "Provider failures, rejected fields and abstentions remain in denominators.", "Six injected confidence probes are separate from the 80 real-input results.", "No payment, bank allocation or promise is created by evaluation.", "Script latency is not manual-versus-tool workflow timing, and supports no human time-saving claim."] },
  summary: {
    receipts: { total: receiptResults.length, ocrCompleted: count(receiptResults, r => r.ocr !== null),
      amountExact: count(receiptResults, r => r.exact.amount), referenceExact: count(receiptResults, r => r.exact.reference), transferTimeExact: count(receiptResults, r => r.exact.transferTime),
      ready: count(receiptResults, r => r.result?.processingStatus === "ready"), reviewOrFailure: count(receiptResults, r => r.result?.processingStatus !== "ready"),
      modelCalled: count(receiptResults, r => r.result?.provenance.modelCalled === true), validatedModelOutput: count(receiptResults, r => r.result?.provenance.validated === true),
      latencyMs: { min: timings[0], median: Math.round(((timings[19]! + timings[20]!) / 2) * 100) / 100, max: timings.at(-1) } },
    replies: { total: replyResults.length, intentExact: count(replyResults, r => r.exact.intent), amountExact: count(replyResults, r => r.exact.amount), promisedDateExact: count(replyResults, r => r.exact.promisedDate),
      ready: count(replyResults, r => r.result.processingStatus === "ready"), reviewOrFailure: count(replyResults, r => r.result.processingStatus !== "ready"), requiredReviewRespected: count(replyResults, r => r.requiredReviewRespected),
      modelCalled: count(replyResults, r => r.result.provenance.modelCalled), validatedModelOutput: count(replyResults, r => r.result.provenance.validated) },
    injectedGuardTests: { total: guards.length, passed: count(guards, r => r.passed), includedInAccuracy: false },
  }, receipts: receiptResults, replies: replyResults, injectedGuardTests: guards,
};
const output = process.argv.find(arg => arg.startsWith("--output="))?.slice(9) ?? `docs/evaluation/extraction-${mode}-results.json`;
await mkdir(new URL("docs/evaluation/", root), { recursive: true });
await writeFile(new URL(output, root), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ report: output, mode, summary: report.summary }, null, 2));
