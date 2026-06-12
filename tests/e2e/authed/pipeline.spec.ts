import { test, expect } from "@playwright/test";

/**
 * 7. Pipeline board renders with columns (BLUEPRINT §4.5).
 * The seeded application makes the 12-stage kanban board render.
 */
test("pipeline board renders with columns", async ({ page }) => {
  await page.goto("/applications");

  await expect(
    page.getByRole("heading", { level: 1, name: "Applications" }),
  ).toBeVisible();

  // A representative set of the 12 pipeline_stage columns.
  for (const column of [
    "Discovered",
    "Eligibility Review",
    "Qualified",
    "Drafting",
    "Submitted",
    "Awarded",
  ]) {
    await expect(page.getByText(column, { exact: true }).first()).toBeVisible();
  }
});
