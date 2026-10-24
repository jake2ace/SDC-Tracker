import type { Invoice, Role, Workspace } from "./contract";
import { href, type InvoiceTab } from "./route";
import { byId, daysPastDue, isOpen, latestMatchForReceipt } from "./selectors";
import type { T } from "../i18n";

export type WorkKind = "evidence" | "invoice" | "followup" | "milestone";
export interface Todo { id: string; text: string; role: Role; link: string; kind: WorkKind; invoice?: Invoice; projectTitle?: string; excerpt?: string }

/** Display-only work queue. No financial decisions or approvals happen here. */
export function todos(ws: Workspace, t: T): Todo[] {
  const asOf = ws.forecastDefaults.asOfDate;
  const out: Todo[] = [];
  for (const m of ws.milestones.filter((m) => m.status === "completed" && !m.invoiceId)) out.push({ id: `milestone-${m.id}`, kind: "milestone", role: "pm", text: t("Create the invoice for \"{title}\"", { title: m.title }), link: href("home"), projectTitle: byId(ws.projects, m.projectId)?.name });
  for (const inv of ws.invoices.filter((i) => i.status === "draft")) out.push({ id: `invoice-${inv.id}`, kind: "invoice", role: "owner", text: t("Approve invoice {number}", { number: inv.number }), link: href("invoices", inv.id), invoice: inv });
  // Repeated checks produce one current task per screenshot, not stale duplicates.
  for (const receipt of ws.receipts) {
    const invoice = byId(ws.invoices, receipt.invoiceId);
    if (!invoice || !isOpen(invoice)) continue;
    const match = latestMatchForReceipt(ws, receipt.id);
    if (match?.status === "applied") continue;
    const text = receipt.processingStatus !== "ready" ? t("Check the fields read from a payment screenshot") : !match ? t("Compare this screenshot with bank records") : match.verdict === "confirmed" || match.verdict === "partial" ? t("Record a payment that matched the bank") : t("A bank check needs your review");
    out.push({ id: `receipt-${receipt.id}`, kind: "evidence", role: "finance", text, link: href("invoices", invoice.id, "payment"), invoice });
  }
  for (const inv of ws.invoices.filter((i) => isOpen(i) && daysPastDue(i, asOf) > 0 && !ws.reminders.some((r) => r.invoiceId === i.id))) out.push({ id: `overdue-${inv.id}`, kind: "followup", role: "finance", text: t("{number} is {n} days late. Send a reminder", { number: inv.number, n: daysPastDue(inv, asOf) }), link: href("invoices", inv.id, "messages"), invoice: inv });
  for (const r of ws.reminders) {
    const invoice = byId(ws.invoices, r.invoiceId);
    if (r.status !== "draft" || !invoice || !isOpen(invoice)) continue;
    out.push({ id: `reminder-${r.id}`, kind: "followup", role: "finance", text: t("Check and send the reminder for {number}", { number: invoice.number }), link: href("invoices", r.invoiceId, "messages"), invoice });
  }
  for (const r of ws.replies) {
    const invoice = byId(ws.invoices, r.invoiceId);
    if (!invoice || !isOpen(invoice)) continue;
    const replyText = r.text.replace(/\s+/g, " ").trim();
    const excerpt = replyText.length > 80 ? `${replyText.slice(0, 79)}…` : replyText;
    if (r.processingStatus !== "ready") out.push({ id: `reply-${r.id}`, kind: "followup", role: "finance", text: t("Read a customer reply that needs checking"), link: href("invoices", r.invoiceId, "messages"), invoice, excerpt });
    else if (r.extraction?.intent === "promise" && !r.confirmedPromiseId) out.push({ id: `promise-${r.id}`, kind: "followup", role: "finance", text: t("Confirm the payment date the customer promised"), link: href("invoices", r.invoiceId, "messages"), invoice, excerpt });
  }
  const priority: Record<WorkKind, number> = { evidence: 0, invoice: 1, followup: 2, milestone: 3 };
  return out.sort((a, b) => priority[a.kind] - priority[b.kind]);
}


export function invoiceTasks(ws: Workspace, t: T): Todo[] {
  return todos(ws, t).filter((task) => task.invoice && task.role === ws.actor.role);
}

export function taskTab(task: Todo): InvoiceTab {
  return task.kind === "evidence" ? "payment" : task.kind === "followup" ? "messages" : "details";
}
