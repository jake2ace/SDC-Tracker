import type { PaymentApprovedResult, PromiseConfirmedResult } from "../contracts/api.ts";
import type {
  BankCredit, Customer, Invoice, MatchResult, Payment, PaymentPromise, Receipt, Reply,
} from "../contracts/domain.ts";
import { AppError } from "./errors.ts";
import { matchReceipt } from "./matcher.ts";
import {
  assertDate, audit, changed, command, expectVersion, invalid, money, requireEntity,
  stamp, today, versionNumber, type Context,
} from "./operations.ts";

function review(message: string, reasonCodes?: string[]): never {
  throw new AppError(422, "REVIEW_REQUIRED", message, reasonCodes ? { reasonCodes } : {});
}

function collectible(invoice: Invoice): void {
  if (!["issued", "partially_paid"].includes(invoice.status) || invoice.collectionStatus !== "active") {
    throw new AppError(409, "INVALID_STATE", "Only an issued invoice with an active outstanding balance can be updated.");
  }
  money(invoice.totalAmountSen, true, "totalAmountSen");
  money(invoice.paidAmountSen, false, "paidAmountSen");
  money(invoice.outstandingAmountSen, true, "outstandingAmountSen");
  if (invoice.currency !== "MYR" || invoice.totalAmountSen - invoice.paidAmountSen !== invoice.outstandingAmountSen ||
      (invoice.status === "issued" && invoice.paidAmountSen !== 0) ||
      (invoice.status === "partially_paid" && invoice.paidAmountSen === 0)) {
    throw new AppError(409, "INVALID_STATE", "Only a collectible MYR invoice with a consistent outstanding balance can be updated.");
  }
}

/** Active promise links remain historical references when the promise is fulfilled. */
function activePromise(ctx: Context, invoice: Invoice): PaymentPromise | null {
  const active = ctx.store.list<PaymentPromise>("promises", ctx.actor.companyId)
    .filter(promise => promise.invoiceId === invoice.id && promise.status === "active");
  if (active.length > 1 || (active.length === 0) !== (invoice.confirmedPromiseId === null)) {
    throw new AppError(409, "INVALID_STATE", "Invoice promise links are inconsistent.");
  }
  if (active.length === 0) return null;
  const promise = active[0];
  const reply = requireEntity(ctx.store.get<Reply>("replies", promise.replyId, ctx.actor.companyId));
  if (promise.id !== invoice.confirmedPromiseId || reply.invoiceId !== invoice.id || reply.confirmedPromiseId !== promise.id) {
    throw new AppError(409, "INVALID_STATE", "Invoice promise links are inconsistent.");
  }
  return promise;
}

function utcTime(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d+)?Z$/u.test(value)) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) && new Date(time).toISOString().slice(0, 10) === value.slice(0, 10) ? time : null;
}

function reviewedPromise(ctx: Context, reply: Reply): void {
  const extraction = reply.extraction;
  if (reply.processingStatus !== "ready" || !extraction || extraction.intent !== "promise") {
    review("Review the reply and provide a clear whole-balance payment promise before confirming it.");
  }
  const now = utcTime(ctx.now);
  const received = utcTime(reply.receivedAt);
  if (now === null || received === null || received > now) review("The reply has an invalid or future received time.");
  if (extraction.source === "ai") {
    if (typeof extraction.confidence !== "number" || !Number.isFinite(extraction.confidence) ||
        extraction.confidence < 0.85 || extraction.confidence > 1 ||
        extraction.reviewedBy !== null || extraction.reviewedAt !== null) {
      review("Review uncertain reply extraction before confirming a promise.");
    }
  } else if (extraction.source === "manual") {
    const reviewer = extraction.reviewedBy ? ctx.store.getUser(extraction.reviewedBy) : undefined;
    const reviewed = utcTime(extraction.reviewedAt);
    const created = utcTime(reply.createdAt);
    const updated = utcTime(reply.updatedAt);
    if (!reviewer || reviewer.companyId !== ctx.actor.companyId || reviewer.role !== "finance" ||
        reviewed === null || created === null || updated === null || reviewed < created ||
        reviewed > updated || reviewed > now || extraction.confidence !== null) {
      review("Manual reply extraction requires a valid server review stamp.");
    }
  } else review("Review the reply extraction before confirming a promise.");
}

/** The caller wraps approval, audit and idempotency storage in one transaction. */
export function approvePayment(ctx: Context, id: string, body: unknown): PaymentApprovedResult {
  const data = command(body, ["expectedVersion"]);
  const companyId = ctx.actor.companyId;
  const match = requireEntity(ctx.store.get<MatchResult>("matches", id, companyId));
  expectVersion(match, data.expectedVersion, "match");
  if (match.status !== "pending") throw new AppError(409, "INVALID_STATE", "This match has already been applied.");
  if (!["confirmed", "partial"].includes(match.verdict) || !match.eligibleCreditId) {
    review("Only a confirmed or partial match with one eligible credit can be approved.", match.reasons);
  }

  const invoice = requireEntity(ctx.store.get<Invoice>("invoices", match.invoiceId, companyId));
  const receipt = requireEntity(ctx.store.get<Receipt>("receipts", match.receiptId, companyId));
  const customer = requireEntity(ctx.store.get<Customer>("customers", invoice.customerId, companyId));
  const credit = requireEntity(ctx.store.get<BankCredit>("bankCredits", match.eligibleCreditId, companyId));
  const company = requireEntity(ctx.store.getCompany(companyId));
  if (receipt.invoiceId !== invoice.id) throw new AppError(404, "NOT_FOUND", "Record not found.");
  if (receipt.replyId !== null) {
    const reply = requireEntity(ctx.store.get<Reply>("replies", receipt.replyId, companyId));
    if (reply.invoiceId !== invoice.id || reply.receiptId !== receipt.id) {
      throw new AppError(404, "NOT_FOUND", "Record not found.");
    }
  }
  if (company.currency !== "MYR") throw new AppError(409, "INVALID_STATE", "Only MYR ledger payments are supported.");
  expectVersion(invoice, match.invoiceVersion, "invoice");
  expectVersion(receipt, match.receiptVersion, "receipt");
  if (company.version !== match.bankLedgerVersion) {
    throw new AppError(409, "VERSION_CONFLICT", "The bank ledger changed. Run matching again before approval.", {
      currentVersion: company.version, entityType: "company", entityId: company.id,
    });
  }
  expectVersion(credit, match.eligibleCreditVersion, "bankCredit");
  collectible(invoice);
  const payments = ctx.store.list<Payment>("payments", companyId);
  if (credit.allocatedPaymentId !== null || payments.some(payment =>
    payment.bankCreditId === credit.id || payment.receiptId === receipt.id || payment.matchResultId === match.id)) {
    throw new AppError(409, "CREDIT_ALREADY_ALLOCATED", "This credit or evidence already belongs to an approved payment.");
  }

  const decision = matchReceipt({
    asOf: ctx.now, companyId, bankLedgerVersion: company.version, invoice, customer, receipt,
    bankCredits: ctx.store.list<BankCredit>("bankCredits", companyId),
    existingReceipts: ctx.store.list<Receipt>("receipts", companyId), payments,
  });
  if (!["confirmed", "partial"].includes(decision.verdict) || decision.verdict !== match.verdict ||
      decision.eligibleCreditId !== credit.id || decision.proposedPaymentAmountSen !== match.proposedPaymentAmountSen ||
      decision.proposedOutstandingAmountSen !== match.proposedOutstandingAmountSen ||
      match.candidateCreditIds.length !== 1 || match.candidateCreditIds[0] !== credit.id) {
    review("The stored proposal no longer agrees with the current evidence. Review and run matching again.", decision.reasons);
  }

  money(credit.amountSen, true, "amountSen");
  const paidAmountSen = invoice.paidAmountSen + credit.amountSen;
  const outstandingAmountSen = invoice.outstandingAmountSen - credit.amountSen;
  money(paidAmountSen, true, "paidAmountSen");
  money(outstandingAmountSen, false, "outstandingAmountSen");
  if (!Number.isSafeInteger(company.version + 1)) throw new AppError(409, "INVALID_STATE", "Bank ledger version limit reached.");
  const promise = activePromise(ctx, invoice);
  const payment: Payment = {
    ...stamp(ctx, "payment"), invoiceId: invoice.id, bankCreditId: credit.id,
    receiptId: receipt.id, matchResultId: match.id, amountSen: credit.amountSen,
    effectiveDate: today(ctx), bankPostedDate: credit.postedDate, confirmedAt: ctx.now, confirmedBy: ctx.actor.id,
  };
  const settled = outstandingAmountSen === 0;
  const nextInvoice = changed(ctx, invoice, {
    paidAmountSen, outstandingAmountSen, status: settled ? "paid" : "partially_paid",
    collectionStatus: settled ? "stopped" : "active",
  });
  const nextCredit = changed(ctx, credit, { allocatedPaymentId: payment.id });
  const nextMatch = changed(ctx, match, { status: "applied" });
  const nextCompany = { ...company, version: company.version + 1 };

  ctx.store.insert("payments", payment);
  ctx.store.put("invoices", nextInvoice);
  ctx.store.put("bankCredits", nextCredit);
  ctx.store.put("matches", nextMatch);
  ctx.store.updateCompany(nextCompany);
  if (settled && promise) ctx.store.put("promises", changed(ctx, promise, { status: "fulfilled" }));
  audit(ctx, "payment.approved", "payment", payment.id,
    `Finance approved a demo payment of ${credit.amountSen} sen; invoice outstanding is ${outstandingAmountSen} sen.`,
    settled ? "invoice_settled" : "partial_payment");
  return { payment, invoice: nextInvoice, bankCredit: nextCredit, match: nextMatch, companyVersion: nextCompany.version };
}

/** A promise changes expected timing only; no payment or invoice due date is changed. */
export function confirmPromise(ctx: Context, id: string, body: unknown): PromiseConfirmedResult {
  const data = command(body, ["expectedVersion", "expectedInvoiceVersion", "promisedDate", "amountSen"]);
  versionNumber(data.expectedInvoiceVersion, "expectedInvoiceVersion");
  if (typeof data.promisedDate !== "string") invalid("promisedDate", "Expected a valid MYT date.");
  assertDate(data.promisedDate, "promisedDate");
  if (typeof data.amountSen !== "number") invalid("amountSen", "Expected a positive integer in sen.");
  money(data.amountSen, true, "amountSen");
  const reply = requireEntity(ctx.store.get<Reply>("replies", id, ctx.actor.companyId));
  expectVersion(reply, data.expectedVersion, "reply");
  const invoice = requireEntity(ctx.store.get<Invoice>("invoices", reply.invoiceId, ctx.actor.companyId));
  expectVersion(invoice, data.expectedInvoiceVersion, "invoice");
  collectible(invoice);
  if (reply.confirmedPromiseId !== null) throw new AppError(409, "INVALID_STATE", "This reply already has a confirmed promise.");
  reviewedPromise(ctx, reply);
  if (data.promisedDate !== reply.extraction!.promisedDate || data.amountSen !== reply.extraction!.amountSen ||
      data.amountSen !== invoice.outstandingAmountSen) {
    review("The date and whole outstanding amount must agree with the reviewed reply. Correct the extraction first if necessary.");
  }

  const previous = activePromise(ctx, invoice);
  const promise: PaymentPromise = {
    ...stamp(ctx, "promise"), invoiceId: invoice.id, replyId: reply.id,
    promisedDate: data.promisedDate, amountSen: data.amountSen, status: "active",
    confirmedBy: ctx.actor.id, confirmedAt: ctx.now,
  };
  const nextInvoice = changed(ctx, invoice, { confirmedPromiseId: promise.id });
  const nextReply = changed(ctx, reply, { confirmedPromiseId: promise.id });
  if (previous) ctx.store.put("promises", changed(ctx, previous, { status: "superseded" }));
  ctx.store.insert("promises", promise);
  ctx.store.put("invoices", nextInvoice);
  ctx.store.put("replies", nextReply);
  audit(ctx, "promise.confirmed", "promise", promise.id,
    `Finance confirmed the ${data.amountSen} sen outstanding balance is expected on ${data.promisedDate}; no payment was recorded.`);
  return { promise, invoice: nextInvoice, reply: nextReply };
}
