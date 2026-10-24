import { describe, expect, it } from "vitest";
import fixtures from "../../contracts/fixtures.json";
import type { Workspace } from "../src/lib/contract";
import { invoiceTasks, taskTab } from "../src/lib/tasks";

const t = (text: string) => text;
const state = (name: keyof typeof fixtures.states) => structuredClone(fixtures.states[name]) as unknown as Workspace;

describe("pending invoice tasks", () => {
  it("counts four replies on one invoice, then removes reviewed replies", () => {
    const ws = state("aiUnavailable");
    ws.invoices[0].dueDate = "2026-12-01";
    ws.replies = Array.from({ length: 4 }, (_, n) => ({ ...ws.replies[0], id: `reply-${n}` }));
    expect(invoiceTasks(ws, t).map(taskTab)).toEqual(["messages", "messages", "messages", "messages"]);
    ws.replies[0].processingStatus = "ready";
    expect(invoiceTasks(ws, t)).toHaveLength(3);
    ws.invoices[0].status = "paid";
    expect(invoiceTasks(ws, t)).toHaveLength(0);
  });

  it("uses the current receipt check once and clears it after payment", () => {
    const ws = state("matchedPartial");
    ws.matches.push({ ...ws.matches[0], id: "recheck" });
    expect(invoiceTasks(ws, t).filter(task => taskTab(task) === "payment")).toHaveLength(1);
    ws.matches[1].status = "applied";
    expect(invoiceTasks(ws, t).filter(task => taskTab(task) === "payment")).toHaveLength(0);
  });

  it("keeps unconfirmed promises pending and respects the current role", () => {
    const ws = state("promiseReady");
    expect(invoiceTasks(ws, t).some(task => task.id.startsWith("promise-"))).toBe(true);
    ws.actor.role = "pm";
    expect(invoiceTasks(ws, t)).toHaveLength(0);
    expect(invoiceTasks(state("afterPromise"), t).some(task => task.id.startsWith("promise-"))).toBe(false);
  });
});
