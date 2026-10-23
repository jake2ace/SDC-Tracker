import { resolve } from "node:path";
import type { Page } from "@playwright/test";
import { test, expect, signIn, actor, visit, write, screenshot } from "./fixture.ts";

const INVOICE = "inv_lumen_001";
const paymentPage = `invoices/${INVOICE}/payment`;
const messagesPage = `invoices/${INVOICE}/messages`;

async function correctedReceipt(page: Page, image: number, reference: string) {
  await page.getByLabel("Screenshot (PNG, JPEG or WebP, up to 5 MiB)").setInputFiles(resolve(`data/eval/images/receipt_eval_00${image}.png`));
  if (await page.getByLabel("Link to reply (optional)").count()) await page.getByLabel("Link to reply (optional)").selectOption("");
  await write(page, "/receipts", () => page.getByRole("button", { name: /Upload/ }).click());
  await expect(page.getByRole("img", { name: "Original screenshot", exact: true })).toBeVisible();
  await expect(page.getByLabel("Amount (RM)", { exact: true })).toBeVisible();
  const fields = { "Amount (RM)": "9000", "Reference": reference, "Payer name": "KOPI TIGA TEST",
    "Transferred at (MYT)": "2026-10-23T10:30", "Sending bank": "DEMO SENDER BANK A",
    "Reason for correction": "Finance checked the synthetic screenshot after the deliberate OCR outage." };
  for (const [label, value] of Object.entries(fields)) await page.getByLabel(label, { exact: true }).fill(value);
  await write(page, "/evidence", () => page.getByRole("button", { name: "Save correction", exact: true }).click());
}

async function bankCheck(page: Page) {
  return write(page, "/match", () => page.getByRole("button", { name: "Run bank check", exact: true }).click());
}

test("real API: invoice roles, manual recovery, partial collection, promise and full settlement", async ({ page, demo }, info) => {
  await signIn(page, demo.url);

  await test.step("PM creates the invoice; only the Owner issues it", async () => {
    await expect(page.getByRole("button", { name: "Mark complete", exact: true })).toBeDisabled();
    await actor(page, "u_lumen_pm");
    await write(page, "/complete", () => page.getByRole("button", { name: "Mark complete", exact: true }).click());
    const draft = await write(page, "/invoice-draft", () => page.getByRole("button", { name: "Create invoice draft", exact: true }).click());
    await visit(page, `invoices/${draft.invoice.id}`);
    await expect(page.getByRole("button", { name: "Approve and issue", exact: true })).toBeDisabled();
    await actor(page, "u_lumen_owner");
    await write(page, "/decision", () => page.getByRole("button", { name: "Approve and issue", exact: true }).click());
    await actor(page, "u_lumen_finance");
  });

  await test.step("A reminder is a draft until Finance explicitly sends it", async () => {
    await visit(page, messagesPage);
    await page.getByRole("button", { name: "Draft a reminder", exact: true }).click();
    const reminder = await write(page, "/reminders", () => page.getByRole("button", { name: "Write draft", exact: true }).click(), 201);
    expect([reminder.generationMode, reminder.status]).toEqual(["fallback_template", "draft"]);
    await write(page, "/send", () => page.getByRole("button", { name: "Send (simulated)", exact: true }).click());
    await expect(page.getByText("Sent (simulated)", { exact: true })).toBeVisible();
  });

  await test.step("An unavailable OCR provider preserves the upload for audited manual review", async () => {
    await visit(page, paymentPage);
    await correctedReceipt(page, 1, "LMN-231026-001");
    const match = await bankCheck(page);
    expect([match.verdict, match.status, (await demo.workspace()).payments.length]).toEqual(["partial", "pending", 0]);
    await expect(page.getByRole("button", { name: /Record partial payment/ })).toBeDisabled();
    await page.getByLabel("I checked the bank credit, the screenshot and the amounts above.").check();
    await write(page, "/approve-payment", () => page.getByRole("button", { name: /Record partial payment/ }).click());
    await expect(page.getByText("RM 9,000.00 still due.", { exact: true })).toBeVisible();
    await screenshot(page, info, "partial-payment-desktop");
  });

  await test.step("The remaining balance can be reminded and promised without becoming received cash", async () => {
    await visit(page, messagesPage);
    await page.getByRole("button", { name: "Draft a reminder", exact: true }).click();
    const reminder = await write(page, "/reminders", () => page.getByRole("button", { name: "Write draft", exact: true }).click(), 201);
    expect(reminder.draftText).toMatch(/9,?000\.00/);
    await page.getByRole("button", { name: "Add customer reply", exact: true }).click();
    await page.getByLabel("Message text (pasted from WhatsApp or email)").fill("UI integration promise: I will pay the remaining RM9,000 on 28 October 2026.");
    await write(page, "/replies", () => page.getByRole("button", { name: "Save reply", exact: true }).click(), 201);
    const reply = page.locator(".bubble.in").filter({ hasText: "UI integration promise:" });
    await reply.getByLabel("Intent", { exact: true }).selectOption("promise");
    await reply.getByLabel("Amount (RM)", { exact: true }).fill("9000");
    await reply.getByLabel("Promised date (MYT)", { exact: true }).fill("2026-10-28");
    await reply.getByLabel("Reason for correction", { exact: true }).fill("Finance reviewed the complete remaining balance and date in the message.");
    await write(page, "/extraction", () => reply.getByRole("button", { name: "Save correction", exact: true }).click());
    await write(page, "/confirm-promise", () => reply.getByRole("button", { name: /^Confirm .*9,000/ }).click());
    await visit(page, "cash");
    await expect(page.getByRole("img", { name: /Balance at the end of each day/ })).toBeVisible();
    await page.getByLabel(/^Late payment scenario/).selectOption("7");
    await expect(page.getByRole("img", { name: /Balance at the end of each day/ })).toBeVisible();
    const rows = page.locator(".rows > li").filter({ has: page.getByRole("link", { name: "LUMEN-DEMO-001", exact: true }) });
    await expect(rows).toHaveCount(2);
    await page.getByLabel("Scenario", { exact: true }).selectOption("delayed");
    await expect(rows.filter({ hasText: "Expected, not received" })).toContainText("4 Nov 2026");
    await screenshot(page, info, "forecast-desktop");
    await page.getByRole("button", { name: "Day by day", exact: true }).click();
    await expect(page.locator("tbody tr")).toHaveCount(30);
  });

  await test.step("CSV import is evidence only; Finance records the final amount and collections stop", async () => {
    await visit(page, "bank");
    await page.getByRole("button", { name: "Import bank statement", exact: true }).click();
    await page.getByLabel("CSV file").setInputFiles({ name: "remaining.csv", mimeType: "text/csv", buffer: Buffer.from(
      "externalId,postedDate,amountSen,reference,payer,bank\nFINAL-002,2026-10-23,900000,LMN-REMAIN-002,KOPI TIGA TEST,DEMO RECEIVING BANK\n") });
    await write(page, "/bank-statements", () => page.getByRole("button", { name: "Import", exact: true }).click());
    await expect(page.getByRole("status")).toContainText("1 new, 0 already imported. No payment was recorded.");
    await visit(page, paymentPage);
    await page.getByRole("button", { name: "Check another payment", exact: true }).click();
    await correctedReceipt(page, 2, "LMN-REMAIN-002");
    const match = await bankCheck(page);
    expect(match.verdict).toBe("confirmed");
    await page.getByLabel("I checked the bank credit, the screenshot and the amounts above.").check();
    await write(page, "/approve-payment", () => page.getByRole("button", { name: /^Record payment of/ }).click());
    await expect(page.getByText("Fully paid.", { exact: true })).toBeVisible();
    await visit(page, messagesPage);
    await expect(page.getByRole("button", { name: "Draft a reminder", exact: true })).toHaveCount(0);
    const ws = await demo.workspace(), invoice = ws.invoices.find(i => i.id === INVOICE)!;
    expect([invoice.paidAmountSen, invoice.outstandingAmountSen, invoice.collectionStatus, ws.payments.length]).toEqual([1800000, 0, "stopped", 2]);
    await page.reload();
    await visit(page, "cash");
    const settled = page.locator(".rows > li").filter({ has: page.getByRole("link", { name: "LUMEN-DEMO-001", exact: true }) });
    await expect(settled).toHaveCount(2);
    await expect(settled.filter({ hasText: "Expected, not received" })).toHaveCount(0);
    await screenshot(page, info, "settled-forecast-desktop");
  });
});

test("real API: failed requests never show success, retries are idempotent, tenant state clears on mobile", async ({ page, demo }, info) => {
  await signIn(page, demo.url);
  await visit(page, messagesPage);
  await page.getByRole("button", { name: "Draft a reminder", exact: true }).click();
  const keys: string[] = [];
  let loseFirstResponse = true;
  await page.route("**/api/invoices/*/reminders", async route => {
    keys.push(route.request().headers()["idempotency-key"]);
    if (loseFirstResponse) {
      loseFirstResponse = false;
      await route.fetch(); // Server commits; only the browser's response is lost.
      await route.abort("failed");
    } else await route.continue();
  });
  await page.getByRole("button", { name: "Write draft", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Could not reach the service");
  await expect(page.getByRole("alert")).not.toContainText("Nothing was changed.");
  await expect(page.getByText("Reminder draft ready. Nothing was sent.", { exact: true })).toHaveCount(0);
  await write(page, "/reminders", () => page.getByRole("button", { name: /Retry/ }).click(), 201);
  expect([keys.length, new Set(keys).size, (await demo.workspace()).reminders.length]).toEqual([2, 1, 1]);

  await page.getByRole("button", { name: "Add customer reply", exact: true }).click();
  await page.getByLabel("Message text (pasted from WhatsApp or email)").fill("Private unsaved Lumen note");
  await page.setViewportSize({ width: 390, height: 844 });
  await actor(page, "u_rantau_finance");
  await expect(page.getByRole("heading", { name: "Rantau IT Demo", exact: true })).toBeVisible();
  await expect(page.getByText("Private unsaved Lumen note")).toHaveCount(0);
  await visit(page, `invoices/${INVOICE}`);
  await expect(page.getByText("Invoice not found in this company", { exact: true })).toBeVisible();
  await visit(page, "cash");
  await expect(page.getByRole("img", { name: /Balance at the end of each day/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "LUMEN-DEMO-001", exact: true })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBeTruthy();
  await screenshot(page, info, "tenant-forecast-mobile");
});

test("real API: a saved write with a failed refresh hides stale balances until reloaded", async ({ page, demo }) => {
  await signIn(page, demo.url);
  await visit(page, messagesPage);
  await page.getByRole("button", { name: "Draft a reminder", exact: true }).click();
  let failRefresh = true;
  await page.route("**/api/workspace", async route => {
    if (failRefresh) { failRefresh = false; await route.abort("failed"); }
    else await route.continue();
  });
  await write(page, "/reminders", () => page.getByRole("button", { name: "Write draft", exact: true }).click(), 201);
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(page.getByText(/Saved, but the workspace could not be refreshed/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Write draft", exact: true })).toHaveCount(0);
  await expect(page.locator(".amounts")).toHaveCount(0);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByLabel("Edit before sending")).toHaveCount(1);
  expect((await demo.workspace()).reminders.length).toBe(1);
});
