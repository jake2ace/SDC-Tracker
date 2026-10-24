import { readFile } from "node:fs/promises";
import { test, expect, signIn, visit, screenshot } from "./fixture.ts";

test("pending counts agree across navigation, invoice card and invoice tabs", async ({ page, demo }, info) => {
  const fixtures = JSON.parse(await readFile("contracts/fixtures.json", "utf8"));
  const workspace = fixtures.states.aiUnavailable;
  workspace.invoices[0].dueDate = "2026-12-01";
  workspace.replies = Array.from({ length: 4 }, (_, n) => ({ ...workspace.replies[0], id: `reply-${n}`, text: `Customer reply ${n + 1} needs review.` }));
  // This rendering check controls the workspace response; API workflows are tested separately.
  await page.route("**/api/workspace", async route => {
    const response = await route.fetch();
    const body = await response.json();
    await route.fulfill({ response, json: { ...body, data: workspace } });
  });
  await signIn(page, demo.url);
  await visit(page, "invoices");
  await expect(page.getByRole("status")).toContainText("1 of 1 invoices");
  await page.locator(".inv-list a").click();
  await expect(page).toHaveURL(/\/messages$/);

  const counts = () => [page.locator(".sidenav .count"), page.locator(".inv-pending"), page.locator(".tabs .count")];
  for (const badge of counts()) await expect(badge).toContainText("4");
  await expect(page.locator("kbd")).toHaveCount(0);
  await page.keyboard.press("5");
  await expect(page).toHaveURL(/\/messages$/);
  await screenshot(page, info, "pending-tasks-desktop");

  workspace.replies[0].processingStatus = "ready";
  await page.reload();
  for (const badge of counts()) await expect(badge).toContainText("3");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator(".tabs .count")).toBeVisible();
  await screenshot(page, info, "pending-tasks-mobile");

  workspace.replies.forEach((reply: { processingStatus: string }) => { reply.processingStatus = "ready"; });
  await page.reload();
  for (const badge of counts()) await expect(badge).toHaveCount(0);
});
