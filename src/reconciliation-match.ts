import { randomUUID } from "node:crypto";
import type { Context } from "./operations.ts";
import type { BankCredit, Customer, Invoice, MatchResult, Payment, Receipt } from "../contracts/domain.ts";
import { AppError } from "./errors.ts";
import { matchReceipt } from "./matcher.ts";

/** Creates a review proposal only; no payment, invoice or bank allocation is changed. */
export function runReceiptMatch(ctx: Context, receiptId: string, body: unknown): MatchResult {
  const data = body as Record<string, unknown>;
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).length !== 2 ||
      Object.keys(data).some((x) => !["expectedVersion", "expectedInvoiceVersion"].includes(x)) ||
      !Number.isSafeInteger(data.expectedVersion) || Number(data.expectedVersion) < 1 ||
      !Number.isSafeInteger(data.expectedInvoiceVersion) || Number(data.expectedInvoiceVersion) < 1) {
    throw new AppError(422, "VALIDATION_ERROR", "Provide only positive integer expectedVersion and expectedInvoiceVersion.");
  }
  const companyId = ctx.actor.companyId;
  const receipt = ctx.store.get<Receipt>("receipts", receiptId, companyId);
  if (!receipt) throw new AppError(404, "NOT_FOUND", "Resource not found.");
  const invoice = ctx.store.get<Invoice>("invoices", receipt.invoiceId, companyId);
  const customer = invoice && ctx.store.get<Customer>("customers", invoice.customerId, companyId);
  const company = ctx.store.getCompany(companyId);
  if (!invoice || !customer || !company) throw new AppError(404, "NOT_FOUND", "Resource not found.");
  for (const [entity, version, type] of [[receipt, data.expectedVersion, "receipt"], [invoice, data.expectedInvoiceVersion, "invoice"]] as const) {
    if (entity.version !== version) throw new AppError(409, "VERSION_CONFLICT", "The evidence changed. Refresh before matching.", { currentVersion: entity.version, entityType: type, entityId: entity.id });
  }
  const bankCredits = ctx.store.list<BankCredit>("bankCredits", companyId);
  const decision = matchReceipt({
    asOf: ctx.now, companyId, bankLedgerVersion: company.version, invoice, customer, receipt, bankCredits,
    existingReceipts: ctx.store.list<Receipt>("receipts", companyId), payments: ctx.store.list<Payment>("payments", companyId),
  });
  const match: MatchResult = {
    id: `match_${randomUUID()}`, companyId, version: 1, createdAt: ctx.now, updatedAt: ctx.now,
    invoiceId: invoice.id, receiptId: receipt.id, invoiceVersion: invoice.version, receiptVersion: receipt.version,
    bankLedgerVersion: company.version,
    eligibleCreditVersion: decision.eligibleCreditId ? bankCredits.find((x) => x.id === decision.eligibleCreditId)!.version : null,
    ...decision, checkedAt: ctx.now, status: "pending",
  };
  ctx.store.insert("matches", match);
  ctx.store.insert("activityLog", {
    id: `event_${randomUUID()}`, companyId, actorId: ctx.actor.id, action: "receipt.matched", entityType: "match", entityId: match.id,
    occurredAt: ctx.now, outcome: "succeeded", reasonCode: null, requestId: ctx.requestId,
    summary: `Matching proposal created: ${match.verdict}. Finance approval is still required; no payment was recorded.`,
  });
  return match;
}
