import { describe, expect, it } from "vitest";
import { MockClient } from "../src/lib/client/mock";
import { ClientError } from "../src/lib/client/types";

const finance = "u_lumen_finance";

async function make() {
  const m = new MockClient();
  m.options.latencyMs = 0;
  return m;
}

describe("fixture mock", () => {
  it("walks the main demo story through approved fixtures", async () => {
    const m = await make();
    await m.request("createReply", { actorId: finance, id: "inv_lumen_001", idempotencyKey: "k-reply-1",
      body: { expectedVersion: 1, text: "Dah bayar boss, RM9,000.", receivedAt: "2026-10-23T03:30:00Z", language: "ms" } });
    expect(m.currentState("co_lumen")).toBe("replyReady");
    await m.request("uploadReceipt", { actorId: finance, id: "inv_lumen_001", idempotencyKey: "k-receipt-1",
      multipart: { fields: { expectedVersion: "1", replyId: "reply_lumen_001", expectedReplyVersion: "1" }, file: new File(["x"], "s.png", { type: "image/png" }) } });
    await m.request("runMatch", { actorId: finance, id: "receipt_lumen_001", idempotencyKey: "k-match-1", body: { expectedVersion: 1, expectedInvoiceVersion: 1 } });
    const res = await m.request("approvePayment", { actorId: finance, id: "match_lumen_001", idempotencyKey: "k-pay-1", body: { expectedVersion: 1 } });
    expect(res.data.invoice.status).toBe("partially_paid");
    expect(res.data.invoice.outstandingAmountSen).toBe(900000);
    expect(res.data.invoice.collectionStatus).toBe("active");

    // Same key, same request: replayed, no second payment.
    const again = await m.request("approvePayment", { actorId: finance, id: "match_lumen_001", idempotencyKey: "k-pay-1", body: { expectedVersion: 1 } });
    expect(again.meta.idempotencyReplayed).toBe(true);
    const ws = await m.request("getWorkspace", { actorId: finance });
    expect(ws.data.payments).toHaveLength(1);
  });

  it("rejects the wrong role without changing state", async () => {
    const m = await make();
    m.setState("co_lumen", "matchedPartial");
    await expect(m.request("approvePayment", { actorId: "u_lumen_owner", id: "match_lumen_001", idempotencyKey: "k-owner-1", body: { expectedVersion: 1 } }))
      .rejects.toMatchObject({ status: 403, code: "FORBIDDEN" });
    expect(m.currentState("co_lumen")).toBe("matchedPartial");
  });

  it("hides other companies' records as not found", async () => {
    const m = await make();
    m.setState("co_lumen", "proofReady");
    await expect(m.request("runMatch", { actorId: "u_rantau_finance", id: "receipt_lumen_001", idempotencyKey: "k-cross-1", body: { expectedVersion: 1, expectedInvoiceVersion: 1 } }))
      .rejects.toMatchObject({ status: 404, code: "NOT_FOUND" });
  });

  it("loads a separate full workspace per company", async () => {
    const m = await make();
    const a = await m.request("getWorkspace", { actorId: finance });
    const b = await m.request("getWorkspace", { actorId: "u_rantau_finance" });
    expect(a.data.company.id).toBe("co_lumen");
    expect(b.data.company.id).toBe("co_rantau");
    expect(b.data.invoices.every((i) => i.companyId === "co_rantau")).toBe(true);
  });

  it("reports a gap instead of inventing a result", async () => {
    const m = await make();
    const err = await m.request("runMatch", { actorId: finance, id: "inv_lumen_001", idempotencyKey: "k-gap-1", body: { expectedVersion: 1, expectedInvoiceVersion: 1 } }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ClientError);
    expect((err as ClientError).kind).toBe("mock_gap");
  });

  it("simulated network failure saves nothing and the retry succeeds", async () => {
    const m = await make();
    m.options.failNextRequest = true;
    const body = { expectedVersion: 1, language: "ms" };
    await expect(m.request("generateReminder", { actorId: finance, id: "inv_lumen_001", idempotencyKey: "k-rem-1", body })).rejects.toMatchObject({ kind: "network" });
    expect(m.currentState("co_lumen")).toBe("before");
    await m.request("generateReminder", { actorId: finance, id: "inv_lumen_001", idempotencyKey: "k-rem-1", body });
    expect(m.currentState("co_lumen")).toBe("reminderDraft");
  });
});
