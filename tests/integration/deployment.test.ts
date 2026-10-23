import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { request as httpRequest } from "node:http";
import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/app.ts";
import { createReminderProvider } from "../../src/reminder-provider.ts";
import { createExtractionProvider } from "../../src/extraction-provider.ts";
import type { Workspace } from "../../contracts/api.ts";

const shell = '<!doctype html><title>Deployment fixture</title><script src="/assets/app.js"></script>';
type App = Awaited<ReturnType<typeof createApp>>;

async function fixture(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-deployment-"));
  const frontendDirectory = join(directory, "dist");
  await mkdir(join(frontendDirectory, "assets"), { recursive: true });
  await writeFile(join(frontendDirectory, "index.html"), shell);
  await writeFile(join(frontendDirectory, "assets/app.js"), "console.log('fixture');");
  await writeFile(join(frontendDirectory, ".env"), "SECRET=not-public");
  await writeFile(join(directory, "outside.js"), "outside-must-stay-private");
  await symlink(join(directory, "outside.js"), join(frontendDirectory, "assets/linked.js"));
  const options = { dbPath: join(directory, "persistent/demo.sqlite"), frontendDirectory,
    reminderProvider: createReminderProvider({ apiKey: "", model: "deepseek-flash" }),
    extractionProvider: createExtractionProvider({ apiKey: "" }) };
  let app: App, base: string;
  async function start() {
    app = await createApp(options);
    app.server.listen(0, "127.0.0.1"); await once(app.server, "listening");
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No test address.");
    base = `http://127.0.0.1:${address.port}`;
  }
  await start();
  t.after(async () => { await app.close(); await rm(directory, { recursive: true, force: true }); });
  return { get base() { return base; }, get app() { return app; }, directory,
    async restart() { await app.close(); await start(); } };
}

// Use raw HTTP for traversal cases: fetch normalizes dot segments before transmission.
async function raw(base: string, path: string, method = "GET") {
  return new Promise<{ status: number; type: string; body: string }>((resolve, reject) => {
    const req = httpRequest(base, { path, method }, res => {
      const chunks: Buffer[] = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve({ status: res.statusCode!, type: String(res.headers["content-type"]), body: Buffer.concat(chunks).toString() }));
    });
    req.on("error", reject); req.end();
  });
}

test("one listener serves the frontend, page links and JSON API with correct content types", async t => {
  const f = await fixture(t);
  for (const path of ["/", "/invoices/inv_lumen_001", "/?source=api", "/?source=mock"]) {
    const result = await raw(f.base, path);
    assert.deepEqual([result.status, result.type, result.body], [200, "text/html; charset=utf-8", shell]);
  }
  const asset = await raw(f.base, "/assets/app.js?v=1"), head = await raw(f.base, "/", "HEAD");
  assert.deepEqual([asset.status, asset.type, head.status, head.body], [200, "text/javascript; charset=utf-8", 200, ""]);
  const health = await raw(f.base, "/health"), users = await raw(f.base, "/api/demo-users");
  assert.deepEqual([health.status, JSON.parse(health.body).data.database, users.status], [200, "ready", 200]);
});

test("missing assets, API failures and private paths never return the frontend shell", async t => {
  const f = await fixture(t);
  for (const path of ["/.env", "/assets/linked.js", "/assets/missing.js", "/assets/no-extension", "/assets/app.js.map",
    "/package.json", "/src/server.ts", "/../outside.js", "/%2e%2e/outside.js", "/assets/%2e%2e/%2e%2e/outside.js",
    "/assets%5c..%5coutside.js", "/%00.js", "/%zz"]) {
    const result = await raw(f.base, path);
    assert.deepEqual([result.status, result.type, JSON.parse(result.body).error.code], [404, "application/json; charset=utf-8", "NOT_FOUND"], path);
  }
  for (const path of ["/api", "/api/missing", "/api/workspace"]) {
    const result = await raw(f.base, path);
    assert.deepEqual([result.status, result.type, JSON.parse(result.body).error.code], [401, "application/json; charset=utf-8", "UNAUTHENTICATED"], path);
  }
  assert.equal((await raw(f.base, "/invoices", "POST")).status, 404);
});

test("a persistent database survives restart while an absent model key allows manual recovery", async t => {
  const f = await fixture(t);
  const headers = { "Content-Type": "application/json", "X-Demo-User": "u_lumen_finance" };
  async function command(path: string, body: unknown, key: string, method = "POST") {
    const response = await fetch(`${f.base}${path}`, { method, headers: { ...headers, "Idempotency-Key": key }, body: JSON.stringify(body) });
    const result = await response.json();
    assert.ok(response.ok, JSON.stringify(result));
    return result.data;
  }
  const reminder = await command("/api/invoices/inv_lumen_001/reminders", { expectedVersion: 1, language: "en" }, "deploy:reminder");
  const created = await command("/api/invoices/inv_lumen_001/replies", {
    expectedVersion: 1, text: "I will pay the remaining RM18000 on 28 October.", language: "en", receivedAt: "2026-10-23T03:00:00Z",
  }, "deploy:reply");
  assert.deepEqual([reminder.generationMode, created.reply.processingStatus, created.fallbackReason],
    ["fallback_template", "manual_required", "MODEL_NOT_CONFIGURED"]);
  const corrected = await command(`/api/replies/${created.reply.id}/extraction`, {
    expectedVersion: created.reply.version, intent: "promise", promisedDate: "2026-10-28", amountSen: 1800000,
    reason: "Checked the synthetic customer reply in the no-key deployment scenario.",
  }, "deploy:manual", "PATCH");
  await f.restart();
  const response = await fetch(`${f.base}/api/workspace`, { headers });
  const { data } = await response.json() as { data: Workspace };
  const saved = data.replies.find(reply => reply.id === corrected.id);
  assert.deepEqual([data.reminders.find(item => item.id === reminder.id)?.id, saved?.id, saved?.extraction?.source, data.payments.length],
    [reminder.id, corrected.id, "manual", 0]);
  assert.equal((await raw(f.base, "/")).body, shell);
});

test("production setup rejects a missing frontend build before opening a database", async t => {
  const f = await fixture(t);
  const empty = join(f.directory, "empty"); await mkdir(empty);
  await assert.rejects(createApp({ dbPath: ":memory:", frontendDirectory: empty }), /Run npm run build/);
});
