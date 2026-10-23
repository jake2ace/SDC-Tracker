import { randomUUID } from "node:crypto";
import type { ActivityEvent, DemoUser, Invoice, Language, Milestone, Reminder, TenantEntity } from "../contracts/domain.ts";
import type { InvoiceDraftResult } from "../contracts/api.ts";
import { AppError } from "./errors.ts";
import type { Store } from "./store.ts";
import { ReminderProviderError, validateReminderOutput, type ReminderProvider } from "./reminder-provider.ts";

export type Context = { store: Store; actor: DemoUser; now: string; requestId: string };
export type Operation = "completeMilestone" | "createInvoiceDraft" | "decideInvoice" | "generateReminder" | "sendReminder";
export type PreparedReminder = { draftText: string; generationMode: "ai" | "fallback_template"; fallbackReason?: string };
type Command = Record<string, unknown>;
interface ReminderSnapshot extends TenantEntity { invoiceVersion: number; outstandingAmountSen: number }

function invalid(field: string, message: string): never {
  throw new AppError(422, "VALIDATION_ERROR", message, {
    fieldErrors: [{ field, code: "invalid", message }],
  });
}

function command(value: unknown, fields: readonly string[]): Command {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("body", "Expected a JSON object.");
  const data = value as Command;
  for (const key of Object.keys(data)) {
    if (!fields.includes(key)) invalid(key, "Unexpected field.");
  }
  for (const field of fields) {
    if (!Object.hasOwn(data, field)) invalid(field, "Required field is missing.");
  }
  versionNumber(data.expectedVersion, "expectedVersion");
  return data;
}

function versionNumber(value: unknown, field: string): asserts value is number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalid(field, "Version must be a positive safe integer.");
  }
}

function expectVersion(entity: TenantEntity, value: unknown, entityType: string): void {
  if (entity.version !== value) {
    throw new AppError(409, "VERSION_CONFLICT", "The record changed. Refresh before continuing.", {
      currentVersion: entity.version, entityType, entityId: entity.id,
    });
  }
}

function assertDate(date: string, field: string): void {
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(date)) invalid(field, "Expected a real YYYY-MM-DD date.");
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    invalid(field, "Expected a real YYYY-MM-DD date.");
  }
}

function today(ctx: Context): string {
  const parsed = new Date(ctx.now);
  if (!Number.isFinite(parsed.getTime())) throw new AppError(500, "INTERNAL_ERROR", "Invalid server clock.");
  return new Date(parsed.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function money(value: number, positive: boolean, field: string): void {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) invalid(field, "Invalid money amount in sen.");
}

function assertInvoice(invoice: Invoice): void {
  money(invoice.totalAmountSen, true, "totalAmountSen");
  money(invoice.paidAmountSen, false, "paidAmountSen");
  money(invoice.outstandingAmountSen, false, "outstandingAmountSen");
  if (invoice.totalAmountSen - invoice.paidAmountSen !== invoice.outstandingAmountSen) {
    invalid("outstandingAmountSen", "Invoice amounts do not balance.");
  }
  assertDate(invoice.dueDate, "dueDate");
}

function collectible(ctx: Context, invoice: Invoice): void {
  assertInvoice(invoice);
  if (!["issued", "partially_paid"].includes(invoice.status) ||
      invoice.collectionStatus !== "active" || invoice.outstandingAmountSen <= 0 ||
      invoice.dueDate >= today(ctx)) {
    throw new AppError(409, "INVALID_STATE", "Only overdue issued invoices with an outstanding balance can be reminded.");
  }
}

function requireEntity<T>(entity: T | undefined | null): T {
  if (!entity) throw new AppError(404, "NOT_FOUND", "Record not found.");
  return entity;
}

function changed<T extends TenantEntity>(ctx: Context, entity: T, updates: Partial<T>): T {
  if (!Number.isSafeInteger(entity.version + 1)) throw new AppError(409, "INVALID_STATE", "Record version limit reached.");
  return { ...entity, ...updates, version: entity.version + 1, updatedAt: ctx.now };
}

function stamp(ctx: Context, prefix: string): TenantEntity {
  return { id: `${prefix}_${randomUUID()}`, companyId: ctx.actor.companyId, version: 1, createdAt: ctx.now, updatedAt: ctx.now };
}

function audit(ctx: Context, action: string, entityType: string, entityId: string, summary: string, reasonCode: string | null = null): void {
  const event: ActivityEvent = {
    id: `evt_${randomUUID()}`, companyId: ctx.actor.companyId, actorId: ctx.actor.id,
    action, entityType, entityId, occurredAt: ctx.now, outcome: "succeeded", reasonCode,
    requestId: ctx.requestId, summary,
  };
  ctx.store.insert("activityLog", event);
}

function text(value: unknown, field: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max ||
      /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(value)) {
    invalid(field, `Expected non-empty text of at most ${max} characters.`);
  }
  return value.trim();
}

function reminderCommand(ctx: Context, id: string, body: unknown): { invoice: Invoice; language: Language } {
  const data = command(body, ["expectedVersion", "language"]);
  if (!["en", "ms", "zh"].includes(data.language as string)) invalid("language", "Language must be en, ms or zh.");
  const invoice = requireEntity(ctx.store.get<Invoice>("invoices", id, ctx.actor.companyId));
  expectVersion(invoice, data.expectedVersion, "invoice");
  collectible(ctx, invoice);
  return { invoice, language: data.language as Language };
}

function amountText(sen: number): string {
  // Integer formatting avoids losing cents near the safe-integer boundary.
  return `RM${Math.floor(sen / 100).toLocaleString("en-MY")}.${String(sen % 100).padStart(2, "0")}`;
}

function fallbackReminder(invoice: Invoice, language: Language): string {
  const amount = amountText(invoice.outstandingAmountSen);
  if (language === "ms") return `Salam, invois ${invoice.number} masih berbaki ${amount}. Sila maklumkan tarikh bayaran atau hubungi kami jika ada pertanyaan. Terima kasih.`;
  if (language === "zh") return `您好，发票 ${invoice.number} 尚有 ${amount} 未结清。请告知预计付款日期，如有疑问请与我们联系。谢谢。`;
  return `Hello, invoice ${invoice.number} has an outstanding balance of ${amount}. Please let us know your expected payment date or contact us with any questions. Thank you.`;
}

/** No database writes or financial side effects happen while the external model runs. */
export async function prepareReminder(ctx: Context, id: string, body: unknown, provider: ReminderProvider): Promise<PreparedReminder> {
  const { invoice, language } = reminderCommand(ctx, id, body);
  try {
    const output = validateReminderOutput(await provider({
      task: "draft_reminder", language, timezone: "Asia/Kuala_Lumpur",
      outstandingAmountSen: invoice.outstandingAmountSen,
      redactedText: "Overdue invoice INVOICE_TOKEN has outstanding balance AMOUNT_TOKEN. Ask politely for an expected payment date. Preserve both literal tokens exactly once.",
    }), language);
    // Only local substitution can insert the invoice identity and balance.
    if (output.draftText.split("INVOICE_TOKEN").length !== 2 || output.draftText.split("AMOUNT_TOKEN").length !== 2 ||
        /https?:\/\/|www\.|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\d{5,}/iu.test(output.draftText)) {
      throw new ReminderProviderError("unsafe_model_output");
    }
    const draftText = output.draftText.replace("INVOICE_TOKEN", invoice.number).replace("AMOUNT_TOKEN", amountText(invoice.outstandingAmountSen));
    if (draftText.length > 2000) throw new ReminderProviderError("invalid_model_output");
    return { draftText, generationMode: "ai" };
  } catch (error) {
    return {
      draftText: fallbackReminder(invoice, language), generationMode: "fallback_template",
      fallbackReason: error instanceof ReminderProviderError ? error.reason : "provider_unavailable",
    };
  }
}

/** The caller executes this synchronous function inside its idempotency transaction. */
export function executeOperation(ctx: Context, operation: Operation, id: string, body: unknown, preparedReminder?: PreparedReminder): unknown {
  if (operation === "completeMilestone") {
    const data = command(body, ["expectedVersion"]);
    const milestone = requireEntity(ctx.store.get<Milestone>("milestones", id, ctx.actor.companyId));
    expectVersion(milestone, data.expectedVersion, "milestone");
    if (milestone.status !== "planned" || milestone.invoiceId !== null) {
      throw new AppError(409, "INVALID_STATE", "Only a planned milestone without an invoice can be completed.");
    }
    money(milestone.amountSen, true, "amountSen");
    assertDate(milestone.dueDate, "dueDate");
    const next = changed(ctx, milestone, { status: "completed", completedAt: ctx.now });
    ctx.store.put("milestones", next);
    audit(ctx, "milestone.completed", "milestone", id, "Milestone marked complete by project manager.");
    return next;
  }

  if (operation === "createInvoiceDraft") {
    const data = command(body, ["expectedVersion"]);
    const milestone = requireEntity(ctx.store.get<Milestone>("milestones", id, ctx.actor.companyId));
    expectVersion(milestone, data.expectedVersion, "milestone");
    if (milestone.status !== "completed") throw new AppError(409, "INVALID_STATE", "Complete the milestone before creating an invoice draft.");
    const existing = ctx.store.list<Invoice>("invoices", ctx.actor.companyId).find((invoice) => invoice.milestoneId === id);
    if (existing) {
      audit(ctx, "invoice.draft_reused", "invoice", existing.id, "Existing invoice returned; no duplicate was created.");
      return { invoice: existing, milestone, existing: true } satisfies InvoiceDraftResult;
    }
    if (milestone.invoiceId !== null) throw new AppError(409, "INVALID_STATE", "Milestone invoice reference is inconsistent.");
    money(milestone.amountSen, true, "amountSen");
    assertDate(milestone.dueDate, "dueDate");
    requireEntity(ctx.store.get("customers", milestone.customerId, ctx.actor.companyId));
    requireEntity(ctx.store.get("projects", milestone.projectId, ctx.actor.companyId));
    const invoice: Invoice = {
      ...stamp(ctx, "inv"), customerId: milestone.customerId, projectId: milestone.projectId, milestoneId: id,
      number: `DEMO-${randomUUID().toUpperCase()}`, currency: "MYR", totalAmountSen: milestone.amountSen,
      paidAmountSen: 0, outstandingAmountSen: milestone.amountSen, dueDate: milestone.dueDate,
      status: "draft", collectionStatus: "not_started", issuedAt: null, approvedBy: null, confirmedPromiseId: null,
    };
    const next = changed(ctx, milestone, { invoiceId: invoice.id });
    ctx.store.insert("invoices", invoice);
    ctx.store.put("milestones", next);
    audit(ctx, "invoice.draft_created", "invoice", invoice.id, "Invoice draft created from the completed milestone; owner approval is required.");
    return { invoice, milestone: next, existing: false } satisfies InvoiceDraftResult;
  }

  if (operation === "decideInvoice") {
    const data = command(body, ["expectedVersion", "decision", "reason"]);
    if (data.decision !== "approve" && data.decision !== "reject") invalid("decision", "Decision must be approve or reject.");
    const reason = data.reason === null ? null : text(data.reason, "reason", 500);
    if (data.decision === "reject" && reason === null) invalid("reason", "A rejection reason is required.");
    const invoice = requireEntity(ctx.store.get<Invoice>("invoices", id, ctx.actor.companyId));
    expectVersion(invoice, data.expectedVersion, "invoice");
    assertInvoice(invoice);
    if (invoice.status !== "draft" || invoice.paidAmountSen !== 0 || invoice.issuedAt !== null || invoice.approvedBy !== null) {
      throw new AppError(409, "INVALID_STATE", "Only an unissued invoice draft can be approved or rejected.");
    }
    const approved = data.decision === "approve";
    const next = changed(ctx, invoice, {
      status: approved ? "issued" : "rejected", collectionStatus: approved ? "active" : "not_started",
      issuedAt: approved ? ctx.now : null, approvedBy: approved ? ctx.actor.id : null,
    });
    ctx.store.put("invoices", next);
    audit(ctx, approved ? "invoice.approved" : "invoice.rejected", "invoice", id,
      approved ? "Owner approved the invoice for simulated issuance." : `Owner rejected the invoice: ${reason}`);
    return next;
  }

  if (operation === "generateReminder") {
    const { invoice, language } = reminderCommand(ctx, id, body);
    if (!preparedReminder) throw new AppError(500, "INTERNAL_ERROR", "Reminder was not prepared.");
    const draftText = text(preparedReminder.draftText, "draftText", 2000);
    const reminder: Reminder = {
      ...stamp(ctx, "reminder"), invoiceId: invoice.id, language, draftText,
      status: "draft", generationMode: preparedReminder.generationMode, sentAt: null, approvedBy: null,
    };
    ctx.store.insert("reminders", reminder);
    ctx.store.insert("reminderSnapshots", {
      id: reminder.id, companyId: ctx.actor.companyId, version: 1, createdAt: ctx.now, updatedAt: ctx.now, invoiceVersion: invoice.version,
      outstandingAmountSen: invoice.outstandingAmountSen,
    } satisfies ReminderSnapshot);
    audit(ctx, "reminder.drafted", "reminder", reminder.id, "Payment reminder drafted for finance review; nothing was sent.", preparedReminder.fallbackReason ?? null);
    return reminder;
  }

  if (operation === "sendReminder") {
    const data = command(body, ["expectedVersion", "expectedInvoiceVersion", "text"]);
    versionNumber(data.expectedInvoiceVersion, "expectedInvoiceVersion");
    const finalText = text(data.text, "text", 2000);
    const reminder = requireEntity(ctx.store.get<Reminder>("reminders", id, ctx.actor.companyId));
    expectVersion(reminder, data.expectedVersion, "reminder");
    const invoice = requireEntity(ctx.store.get<Invoice>("invoices", reminder.invoiceId, ctx.actor.companyId));
    expectVersion(invoice, data.expectedInvoiceVersion, "invoice");
    collectible(ctx, invoice);
    if (reminder.status !== "draft") throw new AppError(409, "INVALID_STATE", "Only a reminder draft can be sent.");
    const snapshot = ctx.store.get<ReminderSnapshot>("reminderSnapshots", id, ctx.actor.companyId);
    if (!snapshot || snapshot.invoiceVersion !== invoice.version || snapshot.outstandingAmountSen !== invoice.outstandingAmountSen) {
      throw new AppError(409, "VERSION_CONFLICT", "The invoice changed after this reminder was drafted. Generate and review a new reminder.", {
        currentVersion: invoice.version, entityType: "invoice", entityId: invoice.id,
      });
    }
    const next = changed(ctx, reminder, { draftText: finalText, status: "sent_simulated", sentAt: ctx.now, approvedBy: ctx.actor.id });
    ctx.store.put("reminders", next);
    audit(ctx, "reminder.sent_simulated", "reminder", id, "Finance reviewed and confirmed a simulated reminder send. No external message was delivered.");
    return next;
  }
  throw new AppError(404, "NOT_FOUND", "Operation not found.");
}
