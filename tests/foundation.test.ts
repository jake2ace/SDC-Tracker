import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app.ts";
import type { ApiError, ApiSuccess, InvoiceDraftResult, Workspace } from "../contracts/api.ts";
import type { AiInput, DemoUser, Invoice, Milestone, Reminder } from "../contracts/domain.ts";
import type { ReminderProvider } from "../src/reminder-provider.ts";

const COMPANY = "co_lumen";
const PM = "u_lumen_pm";
const OWNER = "u_lumen_owner";
const FINANCE = "u_lumen_finance";
const CLOCK = "2026-10-23T04:00:00Z";
const fallbackProvider: ReminderProvider = async () => { throw new Error("Deliberately unavailable test provider"); };
type App = Awaited<ReturnType<typeof createApp>>;
type Result<T> = { status: number; body: ApiSuccess<T> | ApiError };

async function listen(app: App): Promise<string> {
  app.server.listen(0, "127.0.0.1");
  await once(app.server, "listening");
  const address = app.server.address();
  assert.ok(address && typeof address !== "string");
  return `http://127.0.0.1:${address.port}`;
}

async function fixture(t: TestContext, provider: ReminderProvider = fallbackProvider) {
  const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-foundation-"));
  const dbPath = join(directory, "demo.sqlite");
  let app = await createApp({ dbPath, clock: CLOCK, reminderProvider: provider });
  let base = await listen(app);
  t.after(async () => {
    await app.close();
    await rm(directory, { recursive: true, force: true });
  });
  return {
    get app() { return app; },
    get base() { return base; },
    dbPath,
    async restart() {
      await app.close();
      app = await createApp({ dbPath, clock: CLOCK, reminderProvider: provider });
      base = await listen(app);
    },
  };
}

async function request<T>(base: string, path: string, actor?: string, body?: unknown, key?: string): Promise<Result<T>> {
  const headers: Record<string, string> = {};
  if (actor) headers["X-Demo-User"] = actor;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (key) headers["Idempotency-Key"] = key;
  const response = await fetch(`${base}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() as ApiSuccess<T> | ApiError };
}

function success<T>(result: Result<T>, status = 200): T {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.ok("data" in result.body, JSON.stringify(result.body));
  assert.equal(result.body.meta.contractVersion, "1.0.0");
  assert.equal(result.body.meta.mode, "demo");
  assert.equal(result.body.meta.asOf, CLOCK);
  return result.body.data;
}

function failure(result: Result<unknown>, status: number, code: ApiError["error"]["code"]): ApiError {
  assert.equal(result.status, status, JSON.stringify(result.body));
  assert.ok("error" in result.body, JSON.stringify(result.body));
  assert.equal(result.body.error.code, code);
  assert.ok(!("data" in result.body));
  return result.body;
}

function overdueMilestone(app: App): Milestone {
  const milestone = app.store.get<Milestone>("milestones", "ms_lumen_002", COMPANY);
  assert.ok(milestone);
  const overdue = { ...milestone, dueDate: "2026-10-20" };
  app.store.put("milestones", overdue);
  return overdue;
}

async function draftInvoice(base: string, milestone: Milestone, prefix: string) {
  const completed = success(await request<Milestone>(base, `/api/milestones/${milestone.id}/complete`, PM,
    { expectedVersion: milestone.version }, `${prefix}:complete`));
  const drafted = success(await request<InvoiceDraftResult>(base, `/api/milestones/${milestone.id}/invoice-draft`, PM,
    { expectedVersion: completed.version }, `${prefix}:draft`));
  return { completed, drafted };
}

test("health, synthetic users and workspace reads preserve company boundaries", async (t) => {
  const f = await fixture(t);
  assert.equal(success(await request<{ status: string }>(f.base, "/health")).status, "ok");
  const users = success(await request<{ users: DemoUser[] }>(f.base, "/api/demo-users")).users;
  assert.equal(users.length, 6);
  failure(await request(f.base, "/api/workspace"), 401, "UNAUTHENTICATED");
  failure(await request(f.base, "/api/workspace", "missing_user"), 401, "UNAUTHENTICATED");
  for (const actor of users) {
    const workspace = success(await request<Workspace>(f.base, "/api/workspace", actor.id));
    assert.equal(workspace.actor.id, actor.id);
    assert.equal(workspace.company.id, actor.companyId);
    for (const entities of [workspace.customers, workspace.projects, workspace.milestones, workspace.invoices,
      workspace.reminders, workspace.replies, workspace.receipts, workspace.bankCredits, workspace.matches,
      workspace.payments, workspace.promises, workspace.expenses, workspace.activityLog]) {
      assert.ok(entities.every((entity) => entity.companyId === actor.companyId));
    }
    assert.equal(workspace.payments.length, 0, "bank evidence must not pre-create payments");
  }
});

test("one connected workflow completes, drafts, approves and manually sends an edited reminder", async (t) => {
  const f = await fixture(t);
  const milestone = overdueMilestone(f.app);
  const { completed, drafted } = await draftInvoice(f.base, milestone, "connected");
  assert.equal(completed.status, "completed");
  assert.equal(completed.completedAt, CLOCK);
  assert.equal(drafted.existing, false);
  assert.equal(drafted.invoice.status, "draft");
  assert.equal(drafted.invoice.totalAmountSen, milestone.amountSen);
  assert.equal(drafted.invoice.dueDate, milestone.dueDate);
  assert.equal(drafted.invoice.paidAmountSen, 0);
  assert.equal(drafted.invoice.outstandingAmountSen, milestone.amountSen);
  failure(await request(f.base, `/api/invoices/${drafted.invoice.id}/reminders`, FINANCE,
    { expectedVersion: drafted.invoice.version, language: "en" }, "connected:unapproved"), 409, "INVALID_STATE");
  const approved = success(await request<Invoice>(f.base, `/api/invoices/${drafted.invoice.id}/decision`, OWNER,
    { expectedVersion: drafted.invoice.version, decision: "approve", reason: null }, "connected:approve"));
  assert.equal(approved.status, "issued");
  assert.equal(approved.approvedBy, OWNER);
  assert.equal(approved.issuedAt, CLOCK);
  assert.equal(approved.collectionStatus, "active");
  const reminder = success(await request<Reminder>(f.base, `/api/invoices/${approved.id}/reminders`, FINANCE,
    { expectedVersion: approved.version, language: "en" }, "connected:reminder"), 201);
  assert.equal(reminder.status, "draft");
  assert.equal(reminder.generationMode, "fallback_template");
  assert.equal(reminder.sentAt, null);
  assert.equal(reminder.approvedBy, null);
  const edited = "Please arrange payment for the completed handover. Thank you.";
  const sent = success(await request<Reminder>(f.base, `/api/reminders/${reminder.id}/send`, FINANCE,
    { expectedVersion: reminder.version, expectedInvoiceVersion: approved.version, text: edited }, "connected:send"));
  assert.equal(sent.status, "sent_simulated");
  assert.equal(sent.draftText, edited);
  assert.equal(sent.approvedBy, FINANCE);
  assert.equal(sent.sentAt, CLOCK);
  const workspace = success(await request<Workspace>(f.base, "/api/workspace", FINANCE));
  assert.equal(workspace.payments.length, 0);
  assert.equal(workspace.invoices.find((invoice) => invoice.id === approved.id)?.outstandingAmountSen, milestone.amountSen);
  assert.ok(workspace.activityLog.some((event) => event.entityId === approved.id && event.actorId === OWNER && event.outcome === "succeeded"));
  assert.ok(workspace.activityLog.some((event) => event.entityId === sent.id && event.actorId === FINANCE && event.outcome === "succeeded"));
});

test("role checks, hidden foreign resources and strict payloads reject without advancing business state", async (t) => {
  const f = await fixture(t);
  const path = "/api/milestones/ms_lumen_002/complete";
  const before = f.app.store.get<Milestone>("milestones", "ms_lumen_002", COMPANY);
  failure(await request(f.base, path, FINANCE, { expectedVersion: 1 }, "validation:role"), 403, "FORBIDDEN");
  const foreign = failure(await request(f.base, "/api/milestones/ms_rantau_001/complete", PM,
    { expectedVersion: 1 }, "validation:foreign"), 404, "NOT_FOUND");
  assert.deepEqual(foreign.error.details, {});
  assert.ok(!JSON.stringify(foreign).includes("ms_rantau_001"));
  failure(await request(f.base, path, PM, { expectedVersion: 1 }), 422, "IDEMPOTENCY_KEY_REQUIRED");
  failure(await request(f.base, path, PM, { expectedVersion: 1, companyId: "co_rantau" }, "validation:extra"), 422, "VALIDATION_ERROR");
  failure(await request(f.base, path, PM, { expectedVersion: "1" }, "validation:type"), 422, "VALIDATION_ERROR");
  assert.deepEqual(f.app.store.get<Milestone>("milestones", "ms_lumen_002", COMPANY), before);
  const workspace = success(await request<Workspace>(f.base, "/api/workspace", PM));
  const rejected = workspace.activityLog.filter((event) => event.outcome === "rejected");
  assert.ok(rejected.some((event) => event.reasonCode === "FORBIDDEN"));
  assert.ok(rejected.some((event) => event.reasonCode === "VALIDATION_ERROR"));
  assert.ok(rejected.every((event) => event.companyId === COMPANY));
});

test("replays survive stale versions, changed payloads conflict and one milestone has one invoice", async (t) => {
  const f = await fixture(t);
  const milestone = overdueMilestone(f.app);
  const path = `/api/milestones/${milestone.id}/complete`;
  const body = { expectedVersion: milestone.version };
  const original = await request<Milestone>(f.base, path, PM, body, "replay:complete");
  const completed = success(original);
  const replay = await request<Milestone>(f.base, path, PM, body, "replay:complete");
  assert.deepEqual(success(replay), completed);
  assert.equal(replay.body.meta.idempotencyReplayed, true);
  failure(await request(f.base, path, PM, { expectedVersion: completed.version }, "replay:complete"), 409, "IDEMPOTENCY_CONFLICT");
  failure(await request(f.base, path, PM, body, "replay:stale-version"), 409, "VERSION_CONFLICT");
  const draftPath = `/api/milestones/${milestone.id}/invoice-draft`;
  const drafted = success(await request<InvoiceDraftResult>(f.base, draftPath, PM,
    { expectedVersion: completed.version }, "replay:first-draft"));
  const second = success(await request<InvoiceDraftResult>(f.base, draftPath, PM,
    { expectedVersion: drafted.milestone.version }, "replay:second-draft"));
  assert.equal(second.existing, true);
  assert.equal(second.invoice.id, drafted.invoice.id);
  assert.equal(f.app.store.list<Invoice>("invoices", COMPANY).filter((invoice) => invoice.milestoneId === milestone.id).length, 1);
  const workspace = success(await request<Workspace>(f.base, "/api/workspace", PM));
  assert.equal(workspace.activityLog.filter((event) => event.entityId === milestone.id && event.outcome === "succeeded" && event.action === "milestone.completed").length, 1);
});

test("collection eligibility excludes draft, rejected, not-due and paid invoices and rechecks at send", async (t) => {
  const f = await fixture(t);
  const seed = f.app.store.get<Invoice>("invoices", "inv_lumen_001", COMPANY);
  assert.ok(seed);
  const ineligible: Partial<Invoice>[] = [
    { status: "draft", collectionStatus: "not_started", issuedAt: null, approvedBy: null },
    { status: "rejected", collectionStatus: "not_started", issuedAt: null, approvedBy: null },
    { dueDate: "2026-10-23" },
    { status: "paid", collectionStatus: "stopped", paidAmountSen: seed.totalAmountSen, outstandingAmountSen: 0 },
  ];
  for (const [index, changes] of ineligible.entries()) {
    f.app.store.put("invoices", { ...seed, ...changes });
    failure(await request(f.base, `/api/invoices/${seed.id}/reminders`, FINANCE,
      { expectedVersion: seed.version, language: "en" }, `eligibility:case-${index}`), 409, "INVALID_STATE");
  }
  assert.equal(f.app.store.list("reminders", COMPANY).length, 0);
  const partial: Invoice = { ...seed, status: "partially_paid", paidAmountSen: 900000, outstandingAmountSen: 900000 };
  f.app.store.put("invoices", partial);
  const reminder = success(await request<Reminder>(f.base, `/api/invoices/${seed.id}/reminders`, FINANCE,
    { expectedVersion: partial.version, language: "en" }, "eligibility:partial"), 201);
  assert.match(reminder.draftText, /9,?000\.00/);
  f.app.store.put("invoices", { ...partial, version: partial.version + 1, status: "paid", collectionStatus: "stopped", paidAmountSen: seed.totalAmountSen, outstandingAmountSen: 0 });
  const blocked = await request(f.base, `/api/reminders/${reminder.id}/send`, FINANCE,
    { expectedVersion: reminder.version, expectedInvoiceVersion: partial.version, text: reminder.draftText }, "eligibility:paid-before-send");
  assert.ok(blocked.status === 409, JSON.stringify(blocked.body));
  assert.ok("error" in blocked.body);
  assert.ok(["VERSION_CONFLICT", "INVALID_STATE"].includes(blocked.body.error.code));
  assert.equal(f.app.store.get<Reminder>("reminders", reminder.id, COMPANY)?.status, "draft");
});

test("provider input is minimal and provider failures or invalid output use deterministic unsent templates", async (t) => {
  let captured: AiInput | undefined;
  const f = await fixture(t, async (input) => {
    captured = input;
    return { draftText: "Invoice INVOICE_TOKEN has an outstanding balance of AMOUNT_TOKEN. Please advise your payment date.", language: "en" };
  });
  const ai = success(await request<Reminder>(f.base, "/api/invoices/inv_lumen_001/reminders", FINANCE,
    { expectedVersion: 1, language: "en" }, "provider:valid"), 201);
  assert.equal(ai.generationMode, "ai");
  assert.equal(ai.status, "draft");
  assert.ok(captured);
  assert.equal(captured.task, "draft_reminder");
  assert.equal(captured.outstandingAmountSen, 1800000);
  const allowed = new Set(["task", "redactedText", "language", "outstandingAmountSen", "replyReceivedAt", "referenceDate", "timezone"]);
  assert.ok(Object.keys(captured).every((key) => allowed.has(key)));
  assert.ok(!JSON.stringify(captured).includes("Kopi Tiga"));
  assert.ok(!JSON.stringify(captured).includes("LUMEN-DEMO-001"));
  const invalid = await fixture(t, async () => ({ draftText: "", language: "en" }));
  const badOutput = success(await request<Reminder>(invalid.base, "/api/invoices/inv_lumen_001/reminders", FINANCE,
    { expectedVersion: 1, language: "en" }, "provider:invalid"), 201);
  assert.equal(badOutput.generationMode, "fallback_template");
  const unavailable = await fixture(t);
  const failed = success(await request<Reminder>(unavailable.base, "/api/invoices/inv_lumen_001/reminders", FINANCE,
    { expectedVersion: 1, language: "en" }, "provider:failure"), 201);
  assert.equal(failed.draftText, badOutput.draftText);
  assert.equal(failed.status, "draft");
  assert.equal(failed.sentAt, null);
  const originalKey = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  let noKey: App | undefined;
  try {
    noKey = await createApp({ dbPath: ":memory:", clock: CLOCK });
    const base = await listen(noKey);
    const template = success(await request<Reminder>(base, "/api/invoices/inv_lumen_001/reminders", FINANCE,
      { expectedVersion: 1, language: "en" }, "provider:no-key"), 201);
    assert.equal(template.generationMode, "fallback_template");
    assert.equal(template.draftText, failed.draftText);
  } finally {
    if (noKey) await noKey.close();
    if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = originalKey;
  }
});

test("SQLite restart preserves invoice state, customer data, audit and idempotency response", async (t) => {
  const f = await fixture(t);
  const milestone = overdueMilestone(f.app);
  const { completed, drafted } = await draftInvoice(f.base, milestone, "restart");
  const before = success(await request<Workspace>(f.base, "/api/workspace", PM));
  await f.restart();
  const after = success(await request<Workspace>(f.base, "/api/workspace", PM));
  assert.deepEqual(after.customers, before.customers);
  assert.deepEqual(after.invoices, before.invoices);
  assert.deepEqual(after.milestones, before.milestones);
  assert.deepEqual(after.activityLog, before.activityLog);
  const replay = await request<InvoiceDraftResult>(f.base, `/api/milestones/${milestone.id}/invoice-draft`, PM,
    { expectedVersion: completed.version }, "restart:draft");
  assert.deepEqual(success(replay), drafted);
  assert.equal(replay.body.meta.idempotencyReplayed, true);
  assert.equal(f.app.store.list<Invoice>("invoices", COMPANY).filter((invoice) => invoice.milestoneId === milestone.id).length, 1);
});

test("transaction failures roll back entity, audit and idempotency writes; reset restores the synthetic baseline", async (t) => {
  const f = await fixture(t);
  const store = f.app.store;
  const before = store.get<Invoice>("invoices", "inv_lumen_001", COMPANY);
  assert.ok(before);
  const count = store.list("activityLog", COMPANY).length;
  assert.throws(() => store.transaction(() => {
    store.put("invoices", { ...before, version: before.version + 1, paidAmountSen: before.totalAmountSen, outstandingAmountSen: 0, status: "paid" });
    store.insert("activityLog", { id: "event_rollback_test", companyId: COMPANY, actorId: FINANCE,
      action: "test.rollback", entityType: "invoice", entityId: before.id, occurredAt: CLOCK,
      outcome: "succeeded", reasonCode: null, requestId: "rollback-request", summary: "Must not persist." });
    store.saveIdempotency(COMPANY, FINANCE, "rollback:test", "test-fingerprint", 200, { applied: true });
    throw new Error("Injected transaction failure");
  }), /Injected transaction failure/);
  assert.deepEqual(store.get<Invoice>("invoices", before.id, COMPANY), before);
  assert.equal(store.list("activityLog", COMPANY).length, count);
  assert.equal(store.getIdempotency(COMPANY, FINANCE, "rollback:test"), undefined);
  const milestone = overdueMilestone(f.app);
  await draftInvoice(f.base, milestone, "reset-case");
  assert.equal(store.list<Invoice>("invoices", COMPANY).length, 2);
  store.reset();
  assert.equal(store.list<Invoice>("invoices", COMPANY).length, 1);
  assert.equal(store.get<Milestone>("milestones", milestone.id, COMPANY)?.status, "planned");
  assert.equal(store.getIdempotency(COMPANY, PM, "reset-case:draft"), undefined);
});
