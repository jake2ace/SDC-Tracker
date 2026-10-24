import type { Invoice, MatchResult, Workspace } from "./contract";
import { daysBetween } from "./format";

/** Read-only lookups over the server workspace. No money or match decisions are made here. */
export const byId = <T extends { id: string }>(list: T[], id: string | null | undefined): T | undefined =>
  id ? list.find((x) => x.id === id) : undefined;

export function customerName(ws: Workspace, id: string): string {
  return byId(ws.customers, id)?.name ?? "Unknown customer";
}

export function userName(ws: Workspace, id: string | null, users?: { id: string; displayName: string }[]): string {
  if (!id) return "—";
  if (ws.actor.id === id) return ws.actor.displayName;
  return users?.find((u) => u.id === id)?.displayName ?? id;
}

export function isOpen(inv: Invoice): boolean {
  return inv.status === "issued" || inv.status === "partially_paid";
}

/** Display only: days past the original due date on the MYT calendar. */
export function daysPastDue(inv: Invoice, asOfDate: string): number {
  return daysBetween(inv.dueDate, asOfDate);
}

export function latestMatchForReceipt(ws: Workspace, receiptId: string): MatchResult | undefined {
  // The API preserves insertion order. Demo timestamps can tie; IDs are random.
  const matches = ws.matches.filter((m) => m.receiptId === receiptId);
  return matches.find((m) => m.status === "applied") ?? matches[matches.length - 1];
}
