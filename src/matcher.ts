import type { BankCredit, MatcherInput, MatchReason, MatchResult, MatchVerdict, TenantEntity } from "../contracts/domain.ts";
import { normalizePayer, normalizeReference } from "./normalization.ts";

/** Pure decision only. Recording a match and approving payment are separate operations. */
export type MatchDecision = Pick<MatchResult,
  "verdict" | "reasons" | "candidateCreditIds" | "eligibleCreditId" |
  "proposedPaymentAmountSen" | "proposedOutstandingAmountSen">;

const DAY = 86_400_000;
const MYT_OFFSET = 8 * 60 * 60 * 1000;

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function text(value: unknown, maxLength = 1000): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maxLength;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function businessDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function timestamp(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/u.test(value)) return false;
  return businessDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function mytDate(value: string): string {
  return new Date(Date.parse(value) + MYT_OFFSET).toISOString().slice(0, 10);
}

function entity(value: unknown, companyId: string, asOf: number): value is TenantEntity {
  if (!record(value)) return false;
  return text(value.id) && value.companyId === companyId && positiveInteger(value.version) &&
    timestamp(value.createdAt) && timestamp(value.updatedAt) &&
    Date.parse(value.createdAt) <= Date.parse(value.updatedAt) && Date.parse(value.updatedAt) <= asOf;
}

function decision(verdict: MatchVerdict, reasons: MatchReason[], candidateCreditIds: string[] = []): MatchDecision {
  return {
    verdict, reasons, candidateCreditIds,
    eligibleCreditId: null, proposedPaymentAmountSen: null, proposedOutstandingAmountSen: null,
  };
}

function review(reason: MatchReason = "invalid_evidence", candidates: string[] = []): MatchDecision {
  return decision("needs_review", [reason], candidates);
}

function validCredit(credit: BankCredit, companyId: string, asOf: number): boolean {
  return entity(credit, companyId, asOf) && text(credit.externalId, 128) &&
    businessDate(credit.postedDate) && positiveInteger(credit.amountSen) &&
    text(credit.reference, 128) && text(credit.payer, 200) && text(credit.bank, 100) &&
    normalizeReference(credit.reference).length > 0 && normalizePayer(credit.payer).length > 0 &&
    normalizePayer(credit.bank).length > 0 &&
    (credit.allocatedPaymentId === null || text(credit.allocatedPaymentId));
}

/**
 * Evaluate stored, tenant-scoped evidence against the frozen contract.
 * Runtime guards intentionally fail closed even when a caller bypasses HTTP validation.
 * This function has no clock, model call, mutation, payment or generated identifier.
 */
export function matchReceipt(input: MatcherInput): MatchDecision {
  if (!record(input) || !text(input.companyId) || !timestamp(input.asOf) ||
    !positiveInteger(input.bankLedgerVersion) || !Array.isArray(input.bankCredits) ||
    !Array.isArray(input.existingReceipts) || !Array.isArray(input.payments)) return review();

  const { companyId, invoice, customer, receipt } = input;
  const asOf = Date.parse(input.asOf);
  if (!entity(invoice, companyId, asOf) || !entity(customer, companyId, asOf) ||
    !entity(receipt, companyId, asOf) || invoice.customerId !== customer.id ||
    receipt.invoiceId !== invoice.id || !text(invoice.projectId) || !text(invoice.milestoneId) ||
    invoice.currency !== "MYR" || !businessDate(invoice.dueDate)) return review();

  if (invoice.status !== "issued" && invoice.status !== "partially_paid") return review("invoice_not_collectible");
  if (!positiveInteger(invoice.totalAmountSen) || !nonnegativeInteger(invoice.paidAmountSen) ||
    !positiveInteger(invoice.outstandingAmountSen) ||
    invoice.totalAmountSen - invoice.paidAmountSen !== invoice.outstandingAmountSen ||
    invoice.collectionStatus !== "active" ||
    (invoice.status === "issued" && invoice.paidAmountSen !== 0) ||
    (invoice.status === "partially_paid" && invoice.paidAmountSen === 0) ||
    !timestamp(invoice.issuedAt) || Date.parse(invoice.issuedAt) > asOf || !text(invoice.approvedBy)) return review();

  if (!Array.isArray(customer.payerAliases) || customer.payerAliases.length === 0 ||
    !customer.payerAliases.every(alias => text(alias, 200) && normalizePayer(alias).length > 0) ||
    !text(receipt.imageId) || typeof receipt.imageSha256 !== "string" || !/^[\da-f]{64}$/iu.test(receipt.imageSha256) ||
    !["image/png", "image/jpeg", "image/webp"].includes(receipt.mimeType) ||
    !positiveInteger(receipt.byteLength) || receipt.byteLength > 5 * 1024 * 1024 ||
    !positiveInteger(receipt.width) || !positiveInteger(receipt.height) || receipt.width * receipt.height > 20_000_000 ||
    (receipt.replyId !== null && !text(receipt.replyId))) return review();

  const evidence = receipt.evidence;
  if (evidence === null || evidence === undefined) return review("missing_field");
  if (!record(evidence)) return review();
  const required = [evidence.bank, evidence.amountSen, evidence.reference, evidence.transferredAt, evidence.payer];
  if (required.some(value => value === null || value === undefined || (typeof value === "string" && !value.trim()))) {
    return review("missing_field");
  }
  if (!text(evidence.bank, 100) || !positiveInteger(evidence.amountSen) || !text(evidence.reference, 128) ||
    !timestamp(evidence.transferredAt) || !text(evidence.payer, 200)) return review();
  if (!normalizePayer(evidence.bank) || !normalizeReference(evidence.reference) || !normalizePayer(evidence.payer)) {
    return review("missing_field");
  }
  if (Date.parse(evidence.transferredAt) > asOf) return review("future_transfer_time");

  if (evidence.source === "ai") {
    if (typeof evidence.confidence !== "number" || !Number.isFinite(evidence.confidence) ||
      evidence.confidence < 0 || evidence.confidence > 1 || evidence.confidence < 0.85) return review("low_confidence");
    if (evidence.reviewedBy !== null || evidence.reviewedAt !== null) return review();
  } else if (evidence.source === "manual") {
    if (!text(evidence.reviewedBy) || !timestamp(evidence.reviewedAt) ||
      Date.parse(evidence.reviewedAt) > asOf || Date.parse(evidence.reviewedAt) < Date.parse(receipt.createdAt) ||
      Date.parse(evidence.reviewedAt) > Date.parse(receipt.updatedAt)) return review("manual_review_required");
    if (evidence.confidence !== null) return review();
  } else return review();

  if (receipt.processingStatus === "manual_required" || receipt.processingStatus === "needs_review") {
    return review("manual_review_required");
  }
  if (receipt.processingStatus !== "ready") return review();

  // Discard other tenants before reading their identifiers, values or relationships.
  // Records with no valid tenant marker cannot safely participate in a decision.
  const collections = [input.bankCredits, input.existingReceipts, input.payments];
  if (collections.some(rows => rows.some(row => !record(row) || !text(row.companyId)))) return review();
  const bankCredits = input.bankCredits.filter(row => row.companyId === companyId);
  const receipts = input.existingReceipts.filter(row => row.companyId === companyId);
  const payments = input.payments.filter(row => row.companyId === companyId);
  if (!bankCredits.every(row => validCredit(row, companyId, asOf)) ||
    new Set(bankCredits.map(row => row.id)).size !== bankCredits.length ||
    !receipts.every(row => entity(row, companyId, asOf) && text(row.invoiceId) &&
      typeof row.imageSha256 === "string" && /^[\da-f]{64}$/iu.test(row.imageSha256)) ||
    !payments.every(row => entity(row, companyId, asOf) && text(row.invoiceId) &&
      text(row.bankCreditId) && text(row.receiptId) && text(row.matchResultId) &&
      positiveInteger(row.amountSen) && timestamp(row.confirmedAt) && Date.parse(row.confirmedAt) <= asOf &&
      text(row.confirmedBy) && businessDate(row.effectiveDate) && businessDate(row.bankPostedDate))) return review();

  const reference = normalizeReference(evidence.reference);
  const candidates = bankCredits.filter(row => normalizeReference(row.reference) === reference);
  // Stable order makes the same input set reproducible regardless of import ordering.
  const candidateIds = candidates.map(row => row.id).sort();
  const duplicateReasons: MatchReason[] = [];
  if (receipts.some(row => row.id !== receipt.id && row.imageSha256.toLowerCase() === receipt.imageSha256.toLowerCase())) {
    duplicateReasons.push("duplicate_image");
  }
  for (const payment of payments) {
    const credit = bankCredits.find(row => row.id === payment.bankCreditId);
    if (!credit) return review("invalid_evidence", candidateIds);
    if (normalizeReference(credit.reference) === reference && !duplicateReasons.includes("reused_reference")) {
      duplicateReasons.push("reused_reference");
    }
  }
  if (candidates.some(row => row.allocatedPaymentId !== null)) duplicateReasons.push("credit_already_allocated");
  if (duplicateReasons.length) return decision("duplicate", duplicateReasons, candidateIds);
  if (candidates.length === 0) return decision("not_in_bank_yet", ["no_bank_reference"]);

  const aliases = new Set(customer.payerAliases.map(normalizePayer));
  const reasons: MatchReason[] = [];
  if (!aliases.has(normalizePayer(evidence.payer)) || candidates.some(row => !aliases.has(normalizePayer(row.payer)))) {
    reasons.push("wrong_payer");
  }
  const today = mytDate(input.asOf);
  const transferredDate = mytDate(evidence.transferredAt);
  if (candidates.some(row => row.postedDate > today)) reasons.push("future_bank_posting");
  if (candidates.some(row => {
    const offset = (Date.parse(`${row.postedDate}T00:00:00Z`) - Date.parse(`${transferredDate}T00:00:00Z`)) / DAY;
    return offset < 0 || offset > 2;
  })) reasons.push("date_outside_window");
  if (candidates.length > 1) reasons.push("multiple_candidates");
  if (reasons.length) return decision("needs_review", reasons, candidateIds);

  const credit = candidates[0];
  if (credit.amountSen !== evidence.amountSen) return decision("amount_mismatch", ["amount_differs"], candidateIds);
  if (credit.amountSen > invoice.outstandingAmountSen) return review("overpayment", candidateIds);
  const remaining = invoice.outstandingAmountSen - credit.amountSen;
  return {
    verdict: remaining === 0 ? "confirmed" : "partial",
    reasons: [remaining === 0 ? "exact_match" : "partial_amount"],
    candidateCreditIds: candidateIds,
    eligibleCreditId: credit.id,
    proposedPaymentAmountSen: credit.amountSen,
    proposedOutstandingAmountSen: remaining,
  };
}
