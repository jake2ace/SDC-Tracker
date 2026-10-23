import { test as base, expect, type Page, type TestInfo } from "@playwright/test";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../../../src/app.ts";
import type { Workspace } from "../../../contracts/api.ts";

// Browser checks exercise the real HTTP API and database. Only external OCR/model
// providers are deliberately unavailable so manual recovery remains deterministic.
for (const name of Object.keys(process.env)) if (name.startsWith("DEEPSEEK_")) delete process.env[name];
const unavailable = async (): Promise<never> => { throw new Error("Intentional browser-test provider outage."); };
type App = Awaited<ReturnType<typeof createApp>>;
interface Demo { url: string; api: string; app: App; workspace(actor?: string): Promise<Workspace> }

export const test = base.extend<{ demo: Demo }>({
  demo: async ({}, use) => {
    const directory = await mkdtemp(join(tmpdir(), "proof-to-cash-browser-"));
    const app = await createApp({ dbPath: join(directory, "test.sqlite"), clock: "2026-10-23T04:00:00Z",
      extractionProvider: unavailable, reminderProvider: unavailable, ocrProvider: unavailable });
    app.server.listen(0, "127.0.0.1");
    await once(app.server, "listening");
    const address = app.server.address();
    if (!address || typeof address === "string") throw new Error("No test API address.");
    const api = `http://127.0.0.1:${address.port}`;
    const { createServer } = await import("../../../web/node_modules/vite/dist/node/index.js");
    const vite = await createServer({ root: resolve("web"), configFile: resolve("web/vite.config.ts"), mode: "api",
      server: { host: "127.0.0.1", port: 0, proxy: { "/api": { target: api }, "/health": { target: api } } } });
    await vite.listen();
    const url = vite.resolvedUrls?.local[0];
    if (!url) throw new Error("No test frontend address.");
    try {
      await use({ url, api, app, async workspace(actor = "u_lumen_finance") {
        const response = await fetch(`${api}/api/workspace`, { headers: { "X-Demo-User": actor } });
        expect(response.ok).toBeTruthy();
        return (await response.json()).data as Workspace;
      } });
    } finally { await vite.close(); await app.close(); await rm(directory, { recursive: true, force: true }); }
  },
});
export { expect };

export async function signIn(page: Page, url: string) {
  await page.goto(`${url}?source=api`);
  await page.getByRole("button", { name: /Open demo|Try the demo|Enter demo|Sign in/i }).first().click();
  await expect(page.getByLabel("Demo identity")).toBeVisible();
  await expect(page.getByText("Connected demo workspace", { exact: true })).toBeVisible();
}

export async function actor(page: Page, id: string) {
  const loaded = page.waitForResponse(response => response.url().endsWith("/api/workspace") && response.request().headers()["x-demo-user"] === id);
  await page.getByLabel("Demo identity").selectOption(id);
  await loaded;
}

export async function visit(page: Page, path: string) {
  await page.evaluate(hash => { window.location.hash = hash; }, `#/${path}`);
}

export async function write(page: Page, suffix: string, action: () => Promise<unknown>, status = 200) {
  const response = page.waitForResponse(r => new URL(r.url()).pathname.endsWith(suffix) && r.request().method() !== "GET");
  await action();
  const result = await response;
  expect(result.status(), `${result.request().method()} ${suffix}`).toBe(status);
  return (await result.json()).data;
}

export async function screenshot(page: Page, info: TestInfo, name: string) {
  const path = info.outputPath(`${name}.png`);
  const dismiss = page.locator(".toasts").getByRole("button", { name: "Dismiss", exact: true });
  while (await dismiss.count()) await dismiss.first().click();
  await page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: "instant" }));
  await page.screenshot({ path, fullPage: true, animations: "disabled" });
  await info.attach(name, { path, contentType: "image/png" });
}
