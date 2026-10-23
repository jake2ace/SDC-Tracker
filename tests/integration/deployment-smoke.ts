import test from "node:test";
import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { chromium, expect } from "@playwright/test";

test("built frontend uses one production port and retains a no-key draft after process restart", { timeout: 60_000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-production-"));
  const portReservation = createServer().listen(0, "127.0.0.1"); await once(portReservation, "listening");
  const address = portReservation.address();
  if (!address || typeof address === "string") throw new Error("No free port.");
  const port = address.port;
  await new Promise<void>(resolve => portReservation.close(() => resolve()));
  const url = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  async function stop() {
    if (child && child.exitCode === null) { const exited = once(child, "exit"); child.kill("SIGTERM"); await exited; }
  }
  t.after(async () => { await stop(); await rm(directory, { recursive: true, force: true }); });
  async function start() {
    child = spawn(process.execPath, ["--experimental-strip-types", "src/server.ts"], {
      cwd: fileURLToPath(new URL("../../", import.meta.url)), stdio: "ignore",
      env: { ...process.env, NODE_ENV: "production", HOST: "127.0.0.1", PORT: String(port),
        DB_PATH: join(directory, "demo.sqlite"), DEEPSEEK_API_KEY: "", DEEPSEEK_MODEL: "deepseek-flash" },
    });
    for (let attempt = 0; attempt < 100; attempt++) {
      if (child.exitCode !== null) throw new Error(`Production process exited with ${child.exitCode}. Run npm run build first.`);
      try { if ((await fetch(`${url}/health`)).ok) return; } catch { /* Await listener startup. */ }
      await delay(100);
    }
    throw new Error("Production listener did not become healthy.");
  }
  await start();
  const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const browser = await chromium.launch({ ...(existsSync(chrome) ? { executablePath: chrome } : {}) });
  t.after(() => browser.close());
  const page = await browser.newPage();
  const pageErrors: string[] = [], origins = new Set<string>();
  page.on("pageerror", error => pageErrors.push(error.message));
  page.on("request", request => origins.add(new URL(request.url()).origin));
  await page.goto(`${url}/?source=api`);
  await page.getByRole("button", { name: /Open demo|Try the demo|Enter demo|Sign in/i }).first().click();
  await expect(page.getByLabel("Demo identity")).toBeVisible();
  await page.getByLabel("Demo identity").selectOption("u_lumen_finance");
  await page.evaluate(() => { location.hash = "#/invoices/inv_lumen_001/messages"; });
  await page.getByRole("button", { name: "Draft a reminder", exact: true }).click();
  const generated = page.waitForResponse(response => response.url().endsWith("/reminders") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Write draft", exact: true }).click();
  const response = await generated;
  const { data: reminder } = await response.json();
  assert.deepEqual([response.status(), reminder.generationMode, reminder.status], [201, "fallback_template", "draft"]);
  await expect(page.getByText("Reminder draft · Template · English", { exact: true })).toBeVisible();
  await stop(); await start();
  await page.reload();
  await expect(page.getByText("Reminder draft · Template · English", { exact: true })).toBeVisible();
  const workspace = await fetch(`${url}/api/workspace`, { headers: { "X-Demo-User": "u_lumen_finance" } });
  const { data } = await workspace.json();
  assert.ok(data.reminders.some((item: { id: string }) => item.id === reminder.id));
  assert.deepEqual([pageErrors, [...origins]], [[], [url]]);
});
