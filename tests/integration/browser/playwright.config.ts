import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@playwright/test";

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

export default defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  timeout: 90_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  outputDir: resolve(".local/browser-results/artifacts"),
  reporter: [["list"], ["json", { outputFile: resolve(".local/browser-results/results.json") }]],
  use: {
    actionTimeout: 10_000,
    browserName: "chromium",
    launchOptions: existsSync(chrome) ? { executablePath: chrome } : {},
    viewport: { width: 1440, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
  },
});
