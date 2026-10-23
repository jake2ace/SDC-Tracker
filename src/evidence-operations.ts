import { createHash, randomUUID } from "node:crypto";
import type { Invoice, Language, Payment, Receipt, Reply, ReplyIntent } from "../contracts/domain.ts";
import type { ReceiptUploadedResult, ReplyCreatedResult } from "../contracts/api.ts";
import { AppError } from "./errors.ts";
import { audit, changed, command, expectVersion, invalid, requireEntity, stamp, text, assertDate, type Context } from "./operations.ts";
import { extractionProviderMetadata, type ExtractionProvider } from "./extraction-provider.ts";
import { extractReceipt, extractReply } from "./extraction.ts";
import { validateReceiptImage, type OcrProvider } from "./receipt-image.ts";
import type { ReceiptUpload } from "./receipt-upload.ts";

type ReplyAnalysis = Awaited<ReturnType<typeof extractReply>>;
type ReceiptAnalysis = Awaited<ReturnType<typeof extractReceipt>>;
type ValidImage = Awaited<ReturnType<typeof validateReceiptImage>>;
type PreparedReceipt = { existing: Receipt; fallbackReason: string | null } | {
  image: ValidImage; ocrText: string; ocrEngine: string | null; ocrVersion: string | null;
  ocrError: string | null; analysis: ReceiptAnalysis;
};

function utc(value: unknown, field: string, now: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) invalid(field, "Expected a valid UTC timestamp.");
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value.replace(/(?<!\.\d{3})Z$/, ".000Z")) invalid(field, "Expected a valid UTC timestamp.");
  if (date.getTime() > Date.parse(now)) invalid(field, "Time cannot be in the future.");
  return value;
}

function nullableMoney(value: unknown): number | null {
  if (value === null) return null;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) invalid("amountSen", "Amount must be a positive safe integer in sen.");
  return value;
}

function invoiceAt(ctx: Context, id: string, version: unknown): Invoice {
  const invoice = requireEntity(ctx.store.get<Invoice>("invoices", id, ctx.actor.companyId));
  expectVersion(invoice, version, "invoice");
  return invoice;
}

function replyCommand(ctx: Context, id: string, body: unknown) {
  const data = command(body, ["expectedVersion", "text", "receivedAt", "language"]);
  invoiceAt(ctx, id, data.expectedVersion);
  const replyText = text(data.text, "text", 4000);
  const receivedAt = utc(data.receivedAt, "receivedAt", ctx.now);
  if (!["en", "ms", "zh"].includes(data.language as string)) invalid("language", "Language must be en, ms or zh.");
  return { text: replyText, receivedAt, language: data.language as Language };
}

export async function prepareReply(ctx: Context, id: string, body: unknown, provider: ExtractionProvider): Promise<ReplyAnalysis> {
  const data = replyCommand(ctx, id, body);
  return extractReply(data.text, data.receivedAt, data.language, provider);
}

function record(ctx: Context, entityType: "reply" | "receipt", entityId: string, source: "ai" | "manual" | "unavailable", fallbackReason: string | null, details: unknown) {
  ctx.store.recordExtraction({ id: `extraction_${randomUUID()}`, companyId: ctx.actor.companyId,
    entityType, entityId, occurredAt: ctx.now, actorId: ctx.actor.id, source, fallbackReason, details });
}

export function createReply(ctx: Context, id: string, body: unknown, analysis: ReplyAnalysis): ReplyCreatedResult {
  const data = replyCommand(ctx, id, body);
  const reply: Reply = { ...stamp(ctx, "reply"), invoiceId: id, ...data,
    receiptId: null, confirmedPromiseId: null, processingStatus: analysis.processingStatus, extraction: analysis.extraction };
  ctx.store.insert("replies", reply);
  record(ctx, "reply", reply.id, analysis.provenance.validated ? "ai" : "unavailable", analysis.fallbackReason, { provenance: analysis.provenance,
    inputSha256: createHash("sha256").update(data.text).digest("hex"), extraction: reply.extraction });
  audit(ctx, "reply.created", "reply", reply.id, "Customer reply retained for review; no payment or promise was confirmed.", analysis.fallbackReason);
  return { reply, fallbackReason: analysis.fallbackReason };
}

function receiptContext(ctx: Context, invoiceId: string, upload: ReceiptUpload): Reply | null {
  invoiceAt(ctx, invoiceId, upload.expectedVersion);
  if (!upload.replyId) return null;
  const reply = requireEntity(ctx.store.get<Reply>("replies", upload.replyId, ctx.actor.companyId));
  if (reply.invoiceId !== invoiceId) throw new AppError(404, "NOT_FOUND", "Record not found.");
  expectVersion(reply, upload.expectedReplyVersion, "reply");
  return reply;
}

function existingReceipt(ctx: Context, invoiceId: string, hash: string): Receipt | undefined {
  const receipt = ctx.store.list<Receipt>("receipts", ctx.actor.companyId).find(item => item.imageSha256 === hash);
  if (receipt && receipt.invoiceId !== invoiceId) throw new AppError(409, "DUPLICATE_EVIDENCE", "This image is already attached to another invoice.");
  return receipt;
}

function existingResult(ctx: Context, receipt: Receipt): ReceiptUploadedResult {
  const runs = ctx.store.getExtractionRuns(receipt.id, ctx.actor.companyId);
  return { receipt, existing: true, fallbackReason: runs.at(-1)?.fallbackReason ?? null };
}

export async function prepareReceipt(ctx: Context, invoiceId: string, upload: ReceiptUpload, ocr: OcrProvider, provider: ExtractionProvider): Promise<PreparedReceipt> {
  receiptContext(ctx, invoiceId, upload);
  const hash = createHash("sha256").update(upload.file.bytes).digest("hex");
  const existing = existingReceipt(ctx, invoiceId, hash);
  if (existing) return { existing, fallbackReason: existingResult(ctx, existing).fallbackReason };
  const image = await validateReceiptImage(upload.file.bytes);
  let ocrText = ""; let ocrEngine: string | null = null; let ocrVersion: string | null = null;
  let ocrError: string | null = null;
  try {
    const output = await ocr(image);
    if (typeof output.text !== "string" || !output.text.trim() || output.text.length > 32000) throw new Error("Invalid OCR output");
    ocrText = output.text; ocrEngine = output.engine; ocrVersion = output.version;
  } catch { ocrError = "ocr_unavailable"; }
  const analysis: ReceiptAnalysis = ocrError ? { evidence: null, processingStatus: "manual_required",
    fallbackReason: ocrError, provenance: { version: "step5-v1", ...extractionProviderMetadata(provider),
      inputSha256: hash, redactedInputSha256: null, outputSha256: null, modelCalled: false, validated: false } }
    : await extractReceipt(ocrText, ctx.now, provider);
  return { image, ocrText, ocrEngine, ocrVersion, ocrError, analysis };
}

export function saveReceipt(ctx: Context, invoiceId: string, upload: ReceiptUpload, prepared: PreparedReceipt): ReceiptUploadedResult {
  const reply = receiptContext(ctx, invoiceId, upload);
  const hash = createHash("sha256").update(upload.file.bytes).digest("hex");
  const existing = existingReceipt(ctx, invoiceId, hash);
  if (existing) return existingResult(ctx, existing);
  if (!("image" in prepared)) throw new AppError(409, "INVALID_STATE", "Receipt changed during processing. Retry with a new request.");
  if (reply?.receiptId) throw new AppError(409, "INVALID_STATE", "This reply already has a receipt.");
  const { image, analysis } = prepared;
  const receipt: Receipt = { ...stamp(ctx, "receipt"), invoiceId, replyId: reply?.id ?? null,
    imageId: `image_${randomUUID()}`, imageSha256: hash, mimeType: image.mimeType, byteLength: image.bytes.byteLength,
    width: image.width, height: image.height, processingStatus: analysis.processingStatus, evidence: analysis.evidence };
  ctx.store.insert("receipts", receipt);
  ctx.store.insertReceiptArtifact({ imageId: receipt.imageId, receiptId: receipt.id, companyId: ctx.actor.companyId,
    bytes: image.bytes, mimeType: image.mimeType, ocrText: prepared.ocrText, ocrEngine: prepared.ocrEngine,
    ocrVersion: prepared.ocrVersion, ocrError: prepared.ocrError });
  if (reply) ctx.store.put("replies", changed(ctx, reply, { receiptId: receipt.id }));
  record(ctx, "receipt", receipt.id, analysis.provenance.validated ? "ai" : "unavailable", analysis.fallbackReason, { provenance: analysis.provenance,
    imageSha256: hash, ocrSha256: createHash("sha256").update(prepared.ocrText).digest("hex"), evidence: receipt.evidence });
  audit(ctx, "receipt.uploaded", "receipt", receipt.id, "Original receipt and local OCR retained; no money was posted.", analysis.fallbackReason);
  return { receipt, existing: false, fallbackReason: analysis.fallbackReason };
}

export function correctReply(ctx: Context, id: string, body: unknown): Reply {
  const data = command(body, ["expectedVersion", "intent", "promisedDate", "amountSen", "reason"]);
  const reply = requireEntity(ctx.store.get<Reply>("replies", id, ctx.actor.companyId));
  expectVersion(reply, data.expectedVersion, "reply");
  if (reply.confirmedPromiseId) throw new AppError(409, "INVALID_STATE", "A confirmed promise cannot be edited through extraction.");
  const reason = text(data.reason, "reason", 500);
  if (!["paid", "promise", "partial", "dispute", "other"].includes(data.intent as string)) invalid("intent", "Unknown reply intent.");
  const intent = data.intent as ReplyIntent;
  let promisedDate: string | null = null;
  if (data.promisedDate !== null) {
    if (typeof data.promisedDate !== "string") invalid("promisedDate", "Expected a date or null.");
    assertDate(data.promisedDate, "promisedDate");
    promisedDate = data.promisedDate;
  }
  if (!["promise", "partial"].includes(intent) && promisedDate !== null) invalid("promisedDate", "Only a promise or partial-payment reply can have a promised date.");
  if (intent === "promise" && !promisedDate) invalid("promisedDate", "A reviewed promise requires an explicit date.");
  const next = changed(ctx, reply, { processingStatus: "ready", extraction: { intent, promisedDate,
    amountSen: nullableMoney(data.amountSen), source: "manual", confidence: null, reviewedBy: ctx.actor.id, reviewedAt: ctx.now } });
  ctx.store.put("replies", next);
  record(ctx, "reply", id, "manual", null, { reason, before: reply.extraction, after: next.extraction });
  audit(ctx, "reply.corrected", "reply", id, "Finance reviewed reply extraction; this does not confirm a promise or payment.");
  return next;
}

export function correctReceipt(ctx: Context, id: string, body: unknown): Receipt {
  const data = command(body, ["expectedVersion", "bank", "amountSen", "reference", "transferredAt", "payer", "reason"]);
  const receipt = requireEntity(ctx.store.get<Receipt>("receipts", id, ctx.actor.companyId));
  expectVersion(receipt, data.expectedVersion, "receipt");
  if (ctx.store.list<Payment>("payments", ctx.actor.companyId).some(payment => payment.receiptId === id)) {
    throw new AppError(409, "INVALID_STATE", "Evidence attached to an approved payment cannot be changed.");
  }
  const amountSen = nullableMoney(data.amountSen);
  if (amountSen === null) invalid("amountSen", "Receipt amount is required.");
  const reason = text(data.reason, "reason", 500);
  const next = changed(ctx, receipt, { processingStatus: "ready", evidence: {
    bank: text(data.bank, "bank", 100), amountSen, reference: text(data.reference, "reference", 128),
    transferredAt: utc(data.transferredAt, "transferredAt", ctx.now), payer: text(data.payer, "payer", 200),
    source: "manual", confidence: null, reviewedBy: ctx.actor.id, reviewedAt: ctx.now,
  } });
  ctx.store.put("receipts", next);
  record(ctx, "receipt", id, "manual", null, { reason, before: receipt.evidence, after: next.evidence });
  audit(ctx, "receipt.corrected", "receipt", id, "Finance reviewed receipt evidence. Existing match proposals require a fresh match.");
  return next;
}
